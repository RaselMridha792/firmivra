// End-to-end: Company Profile & Branding (R42 contract, `api.branding`): read, save with the
// loaded version, the mapped and refused fields, brand images (upload, public address, removal),
// reset by group. Owner and Admin only; firm B never sees or changes firm A's branding.
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request, { type Response } from 'supertest';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createPrismaClient, runInScope } from '@firmivra/db';
import { TEST_CLIENT_OPTIONS, testDatabaseUrls } from '@firmivra/db/testing';
import { BrandingSettings, UploadTicket } from '@firmivra/types';
import { AppModule } from '../../src/app.module.js';
import { configureApp } from '../../src/configure-app.js';
import { loadEnv } from '../../src/config/env.js';
import { DOCUMENTS_CONFIG } from '../../src/storage/config.js';
import { DOCUMENT_STORAGE, type DocumentStorage } from '../../src/storage/document-storage.js';
import { sha256 as sha } from '../office-files.js';

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const ICO = Buffer.from([0x00, 0x00, 0x01, 0x00, 1, 0, 16, 16]);
const SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>');

class MemoryStorage implements DocumentStorage {
  readonly objects = new Map<string, Buffer>();
  presignUpload(file: { key: string; contentType: string }) {
    return Promise.resolve({
      url: `memory:${file.key}`,
      headers: { 'content-type': file.contentType },
    });
  }
  head(key: string) {
    const b = this.objects.get(key);
    return Promise.resolve(b ? { sizeBytes: b.length, sha256: null, contentEncoding: null } : null);
  }
  read(key: string) {
    return Promise.resolve(this.objects.get(key) ?? null);
  }
  remove(key: string) {
    this.objects.delete(key);
    return Promise.resolve();
  }
  presignDownload(file: { key: string }) {
    return Promise.resolve(`memory:${file.key}?download`);
  }
  put(ticket: UploadTicket, bytes: Buffer) {
    this.objects.set(ticket.url.slice('memory:'.length), bytes);
  }
}
const storage = new MemoryStorage();

const fx = inject('fixtures');
const run = randomUUID().slice(0, 8);
const person = (key: string) => ({ id: randomUUID(), email: `r55b-${key}-${run}@r55.test` });
const people = {
  ownerA: person('owner-a'),
  adminA: person('admin-a'),
  staffA: person('staff-a'),
  ownerB: person('owner-b'),
};
type Who = (typeof people)[keyof typeof people];
const firms = {} as Record<'a' | 'b', { id: string; slug: string }>;
let app: INestApplication;
const tokens = new Map<string, string>();

async function asOwner<T>(
  scope: Parameters<typeof runInScope>[1],
  work: Parameters<typeof runInScope<T>>[2],
): Promise<T> {
  const owner = createPrismaClient(testDatabaseUrls('test_api').owner, TEST_CLIENT_OPTIONS);
  try {
    return await runInScope(owner, scope, work);
  } finally {
    await owner.$disconnect();
  }
}

async function call(
  method: 'get' | 'post' | 'patch' | 'delete',
  path: string,
  who: Who | undefined,
  body?: object,
  firm: 'a' | 'b' = 'a',
): Promise<Response> {
  let req = request(app.getHttpServer())
    [method](`/api/v1/business${path}`)
    .set('x-business-id', firms[firm].id);
  if (who) {
    let token = tokens.get(who.email);
    if (!token) {
      const res = await request(app.getHttpServer())
        .post('/api/v1/dev/token')
        .send({ email: who.email })
        .expect(200);
      token = (res.body as { token: string }).token;
      tokens.set(who.email, token);
    }
    req = req.set('authorization', `Bearer ${token}`);
  }
  return body === undefined ? req : req.send(body);
}
const codeOf = (res: Response) => (res.body as { error?: { code: string } }).error?.code;
const expectError = (res: Response, status: number, code: string) =>
  expect([res.status, codeOf(res)], JSON.stringify(res.body)).toEqual([status, code]);
const ok = (res: Response, status = 200) => {
  expect(res.status, JSON.stringify(res.body)).toBe(status);
  return BrandingSettings.parse(res.body);
};
const auditRows = (action: string) =>
  asOwner({ kind: 'business', businessId: firms.a.id }, (tx) =>
    tx.auditLog.findMany({ where: { businessId: firms.a.id, action } }),
  );
const { ownerA, adminA, staffA, ownerB } = people;

beforeAll(async () => {
  await asOwner({ kind: 'platform' }, async (tx) => {
    for (const [key, p] of Object.entries(people)) {
      await tx.user.create({
        data: { id: p.id, cognitoSub: p.id, pool: 'STAFF', email: p.email, name: `Fake ${key}` },
      });
    }
    for (const key of ['a', 'b'] as const) {
      const slug = `r55b-${key}-${run}`;
      const b = await tx.business.create({
        data: { slug, name: `Firm ${slug}`, status: 'ACTIVE', legalName: `Firm ${key} LLC` },
        select: { id: true },
      });
      firms[key] = { id: b.id, slug };
    }
  });
  for (const [firm, userId, role] of [
    ['a', ownerA.id, 'OWNER'],
    ['a', adminA.id, 'ADMIN'],
    ['a', staffA.id, 'STAFF'],
    ['b', ownerB.id, 'OWNER'],
  ] as const) {
    await asOwner({ kind: 'business', businessId: firms[firm].id }, (tx) =>
      tx.membership.create({
        data: { businessId: firms[firm].id, userId, role, status: 'ACTIVE' },
      }),
    );
  }
  const env = loadEnv({
    ...process.env,
    NODE_ENV: 'test',
    AUTH_MODE: 'local',
    LOG_LEVEL: 'silent',
    DATABASE_URL_APP: fx.appUrl,
  });
  const moduleRef = await Test.createTestingModule({ imports: [AppModule.forRoot(env)] })
    .overrideProvider(DOCUMENT_STORAGE)
    .useValue(storage)
    .overrideProvider(DOCUMENTS_CONFIG)
    .useValue({ bucket: 'test', region: 'us-east-1', forcePathStyle: true, scanMode: 'local' })
    .compile();
  const nest = moduleRef.createNestApplication<NestExpressApplication>({ logger: false });
  configureApp(nest, env);
  await nest.listen(0, '127.0.0.1');
  app = nest;
});

afterAll(async () => {
  await app.close();
});

describe('GET and PATCH /business/branding', () => {
  it('reads the defaults, saves with the loaded version and refuses a stale save', async () => {
    const first = ok(await call('get', '/branding', ownerA));
    expect(first).toMatchObject({
      legalName: 'Firm a LLC',
      themeMode: 'LIGHT',
      sidebarStyle: 'SOLID',
      showLogoText: true,
      faviconUrl: null,
      email: { fromName: null, logoUrl: null },
      documents: { showLetterhead: false },
      preferences: { locale: 'en-US', currency: 'USD', dateFormat: 'MM/DD/YYYY' },
    });
    const saved = ok(
      await call('patch', '/branding', adminA, {
        version: first.version,
        businessCategory: 'Accounting & Tax Services',
        adminEmail: 'Office@Example.Test',
        secondaryColor: '#C9A227',
        backgroundColor: '#F8FAFC',
        themeMode: 'DARK',
        sidebarPosition: 'RIGHT',
        loginMessage: 'Welcome back',
        email: { fromName: 'Firm A', replyToEmail: 'Help@Example.Test', footer: 'Fake footer' },
        portal: { primaryColor: '#123456' },
        documents: { header: 'Fake letterhead', showLetterhead: true },
        preferences: { currency: 'CAD', dateFormat: 'YYYY-MM-DD' },
      }),
    );
    expect(saved).toMatchObject({
      businessCategory: 'Accounting & Tax Services',
      adminEmail: 'office@example.test',
      secondaryColor: '#c9a227',
      themeMode: 'DARK',
      sidebarPosition: 'RIGHT',
      email: { fromName: 'Firm A', replyToEmail: 'help@example.test', footer: 'Fake footer' },
      portal: { primaryColor: '#123456', accentColor: null },
      documents: { header: 'Fake letterhead', showLetterhead: true },
      preferences: { currency: 'CAD', dateFormat: 'YYYY-MM-DD' },
    });
    expect(saved.version).not.toBe(first.version);
    expectError(
      await call('patch', '/branding', ownerA, { version: first.version, loginMessage: 'x' }),
      409,
      'SAVE_CONFLICT',
    );
    const versions = await asOwner({ kind: 'business', businessId: firms.a.id }, (tx) =>
      tx.businessBrandVersion.count({ where: { businessId: firms.a.id } }),
    );
    expect(versions).toBe(1);
    const audits = await auditRows('branding.updated');
    expect(audits).toHaveLength(1);
    expect(JSON.stringify(audits)).not.toContain('Fake footer');
  });

  it('refuses the locked legal name, low contrast, other number formats and a stray letterhead switch', async () => {
    const v = ok(await call('get', '/branding', ownerA)).version;
    expectError(
      await call('patch', '/branding', ownerA, { version: v, legalName: 'New LLC' }),
      403,
      'FORBIDDEN',
    );
    expectError(
      await call('patch', '/branding', ownerA, { version: v, backgroundColor: '#333333' }),
      400,
      'LOW_CONTRAST',
    );
    expectError(
      await call('patch', '/branding', ownerA, {
        version: v,
        preferences: { numberFormat: '1.234,56' },
      }),
      400,
      'VALIDATION_FAILED',
    );
    expectError(
      await call('patch', '/branding', ownerA, {
        version: v,
        documents: { showLetterhead: false },
      }),
      400,
      'VALIDATION_FAILED',
    );
    expect(
      (await call('patch', '/branding', ownerA, { version: v, secondaryColor: 'red' })).status,
    ).toBe(400);
  });

  it('is for Owner and Admin of the firm only', async () => {
    expectError(await call('get', '/branding', staffA), 403, 'FORBIDDEN');
    expectError(await call('get', '/branding', ownerB), 404, 'NOT_FOUND');
    expectError(await call('get', '/branding', undefined), 401, 'UNAUTHENTICATED');
    const own = ok(await call('get', '/branding', ownerB, undefined, 'b'));
    expect(own.email.fromName).toBeNull();
    expect(own.themeMode).toBe('LIGHT');
  });
});

describe('brand images', () => {
  const ticket = (kind: string, file: Buffer, contentType: string, who: Who = ownerA) =>
    call('post', '/branding/assets/uploads', who, {
      kind,
      contentType,
      sizeBytes: file.length,
      sha256: sha(file),
    });

  it('uploads a favicon, serves it publicly, replaces and removes it', async () => {
    const t = UploadTicket.parse((await ticket('FAVICON', ICO, 'image/x-icon')).body);
    expect(t.url).toMatch(new RegExp(`^memory:tenant/${firms.a.id}/branding/favicon/`));
    storage.put(t, ICO);
    const saved = ok(
      await call('post', '/branding/assets/uploads/confirm', ownerA, {
        uploadToken: t.uploadToken,
      }),
    );
    expect(saved.faviconUrl).toMatch(
      new RegExp(`/api/v1/portal/${firms.a.slug}/branding/favicon\\?v=`),
    );
    const served = await request(app.getHttpServer())
      .get(`/api/v1/portal/${firms.a.slug}/branding/favicon`)
      .buffer(true);
    expect(served.status).toBe(200);
    expect(served.headers['content-type']).toBe('image/x-icon');
    expect(
      (await request(app.getHttpServer()).get(`/api/v1/portal/${firms.a.slug}/branding/nope`))
        .status,
    ).toBe(404);
    expect(
      (await request(app.getHttpServer()).get(`/api/v1/portal/${firms.b.slug}/branding/favicon`))
        .status,
    ).toBe(404);

    const t2 = UploadTicket.parse((await ticket('FAVICON', PNG, 'image/png')).body);
    storage.put(t2, PNG);
    ok(
      await call('post', '/branding/assets/uploads/confirm', ownerA, {
        uploadToken: t2.uploadToken,
      }),
    );
    expect(
      [...storage.objects.keys()].filter((k) => k.includes('/branding/favicon/')),
    ).toHaveLength(1);
    const removed = ok(await call('delete', '/branding/assets/FAVICON', ownerA));
    expect(removed.faviconUrl).toBeNull();
    expect(
      [...storage.objects.keys()].filter((k) => k.includes('/branding/favicon/')),
    ).toHaveLength(0);
    ok(await call('delete', '/branding/assets/FAVICON', ownerA));
    expect((await auditRows('branding.asset_uploaded')).length).toBe(2);
  });

  it('refuses a type the kind does not take, and bytes that are not the image', async () => {
    expectError(await ticket('EMAIL_LOGO', SVG, 'image/svg+xml'), 400, 'INVALID_ASSET');
    expectError(await ticket('FAVICON', PNG, 'image/jpeg'), 400, 'INVALID_ASSET');
    const t = UploadTicket.parse((await ticket('EMAIL_LOGO', PNG, 'image/png')).body);
    storage.put(t, SVG);
    expectError(
      await call('post', '/branding/assets/uploads/confirm', ownerA, {
        uploadToken: t.uploadToken,
      }),
      400,
      'INVALID_ASSET',
    );
    expectError(
      await call(
        'post',
        '/branding/assets/uploads/confirm',
        ownerB,
        { uploadToken: t.uploadToken },
        'b',
      ),
      410,
      'UPLOAD_EXPIRED',
    );
    expect((await call('delete', '/branding/assets/NOPE', ownerA)).status).toBe(400);
  });
});

describe('POST /business/branding/reset', () => {
  it('restores the groups asked for and keeps the rest', async () => {
    const t = UploadTicket.parse(
      (
        await call('post', '/branding/assets/uploads', ownerA, {
          kind: 'PORTAL_LOGO',
          contentType: 'image/png',
          sizeBytes: PNG.length,
          sha256: sha(PNG),
        })
      ).body,
    );
    storage.put(t, PNG);
    ok(
      await call('post', '/branding/assets/uploads/confirm', ownerA, {
        uploadToken: t.uploadToken,
      }),
    );
    expect((await call('post', '/branding/reset', ownerA, { groups: ['THEME'] })).status).toBe(400);
    const back = ok(
      await call('post', '/branding/reset', ownerA, { groups: ['THEME', 'PORTAL'], confirm: true }),
    );
    expect(back).toMatchObject({
      themeMode: 'LIGHT',
      sidebarPosition: 'LEFT',
      secondaryColor: null,
      portal: { logoUrl: null, primaryColor: null },
      // Not reset: email, documents, login and preferences.
      email: { fromName: 'Firm A' },
      documents: { header: 'Fake letterhead' },
      loginMessage: 'Welcome back',
      preferences: { currency: 'CAD' },
    });
    expect(
      [...storage.objects.keys()].filter((k) => k.includes('/branding/portal-logo/')),
    ).toHaveLength(0);
    expect((await auditRows('branding.reset'))[0]?.metadata).toEqual({
      groups: ['PORTAL', 'THEME'],
    });
    expectError(
      await call('post', '/branding/reset', ownerB, { groups: ['THEME'], confirm: true }),
      404,
      'NOT_FOUND',
    );
  });
});
