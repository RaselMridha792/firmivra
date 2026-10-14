// End-to-end: the firm's logo (R28). Owner and Admin upload, replace and remove it in R5's three
// steps; it is served at one public address; one firm's logo is never served for or changed by
// another firm.
import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request, { type Response } from 'supertest';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createPrismaClient, runInScope } from '@firmivra/db';
import { TEST_CLIENT_OPTIONS, testDatabaseUrls } from '@firmivra/db/testing';
import { FirmSettings, LOGO_LIMITS, PortalInfo, UploadTicket } from '@firmivra/types';
import { AppModule } from '../../src/app.module.js';
import { configureApp } from '../../src/configure-app.js';
import { type Env, loadEnv } from '../../src/config/env.js';
import { DOCUMENTS_CONFIG } from '../../src/storage/config.js';
import { DOCUMENT_STORAGE, type DocumentStorage } from '../../src/storage/document-storage.js';
import { sha256 as sha } from '../office-files.js';

const fx = inject('fixtures');
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const WEBP = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBPVP8 ')]);
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 4, 5, 6]);
const SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script/></svg>');

/** Storage in memory: `put(ticket, bytes)` is the browser's PUT. */
class MemoryStorage implements DocumentStorage {
  readonly objects = new Map<string, Buffer>();
  presignUpload(file: { key: string; contentType: string }) {
    const headers = { 'content-type': file.contentType };
    return Promise.resolve({ url: `memory:${file.key}`, headers });
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
  keysOf(businessId: string) {
    return [...this.objects.keys()].filter((k) => k.startsWith(`tenant/${businessId}/logo/`));
  }
}

const storage = new MemoryStorage();
let app: INestApplication;
let env: Env;
const { ownerA, staffA, ownerB } = fx.users;

const tokens = new Map<string, string>();
async function login(email: string): Promise<string> {
  const res = await request(app.getHttpServer()).post('/api/v1/dev/token').send({ email });
  const token = (res.body as { token: string }).token;
  tokens.set(email, token);
  return token;
}

async function call(
  method: 'get' | 'post' | 'delete' | 'patch',
  path: string,
  who?: { email: string },
  firm?: string,
  body: object = {},
) {
  let req = request(app.getHttpServer())[method](`/api/v1${path}`);
  if (who) {
    const token = tokens.get(who.email) ?? (await login(who.email));
    req = req.set('authorization', `Bearer ${token}`);
  }
  if (firm) req = req.set('x-business-id', firm);
  return method === 'get' ? req : req.send(body);
}
const ticketFor = (
  who: { email: string },
  firm: string,
  file: Buffer,
  contentType = 'image/png',
  variant = 'dark',
) =>
  call('post', '/business/logo/uploads', who, firm, {
    contentType,
    variant,
    sizeBytes: file.length,
    sha256: sha(file),
  });
const confirm = (who: { email: string }, firm: string, uploadToken: string) =>
  call('post', '/business/logo/uploads/confirm', who, firm, { uploadToken });

/** The three steps; the bytes stored may differ from what the ticket describes. */
async function upload(
  who: { email: string },
  firm: string,
  described: Buffer,
  stored = described,
  type = 'image/png',
  variant = 'dark',
) {
  const ticket = UploadTicket.parse((await ticketFor(who, firm, described, type, variant)).body);
  storage.put(ticket, stored);
  return confirm(who, firm, ticket.uploadToken);
}
const served = (slug: string, query = '') =>
  request(app.getHttpServer()).get(`/api/v1/portal/${slug}/logo${query}`).buffer(true);
const infoOf = async (slug: string) =>
  PortalInfo.parse((await request(app.getHttpServer()).get(`/api/v1/portal/${slug}/info`)).body);
const codeOf = (res: Response) => (res.body as { error?: { code: string } }).error?.code;

async function audit(businessId: string, action: string) {
  const owner = createPrismaClient(testDatabaseUrls('test_api').owner, TEST_CLIENT_OPTIONS);
  const rows = await runInScope(owner, { kind: 'business', businessId }, (tx) =>
    tx.auditLog.findMany({ where: { businessId, action } }),
  );
  await owner.$disconnect();
  return rows;
}

beforeAll(async () => {
  env = loadEnv({
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

describe('POST /business/logo/uploads', () => {
  it('is for Owner and Admin; refuses types and sizes the logo may not have', async () => {
    const body = { contentType: 'image/png', sizeBytes: 10, sha256: sha(PNG) };
    const post = (who: { email: string } | undefined, firm: string) =>
      call('post', '/business/logo/uploads', who, firm, body);
    expect((await post(staffA, fx.firmA.id)).status).toBe(403);
    expect((await post(undefined, fx.firmA.id)).status).toBe(401);
    expect((await post(ownerB, fx.firmA.id)).status).toBe(404);
    for (const bad of [
      { contentType: 'image/svg+xml' },
      { contentType: 'image/gif' },
      { sizeBytes: 0 },
      { sizeBytes: LOGO_LIMITS.maxBytes + 1 },
    ]) {
      const res = await call('post', '/business/logo/uploads', ownerA, fx.firmA.id, {
        ...body,
        ...bad,
      });
      expect([res.status, codeOf(res)]).toEqual([400, 'VALIDATION_FAILED']);
    }
    const ok = await call('post', '/business/logo/uploads', ownerA, fx.firmA.id, {
      ...body,
      sizeBytes: LOGO_LIMITS.maxBytes,
    });
    expect(UploadTicket.parse(ok.body).url).toMatch(
      new RegExp(`^memory:tenant/${fx.firmA.id}/logo/[0-9a-f-]{36}\\.png$`),
    );
  });
});

describe('a logo from upload to removal', () => {
  it('is served at one public address, replaced, removed and audited', async () => {
    expect(
      FirmSettings.parse((await call('get', '/business/settings', ownerA, fx.firmA.id)).body)
        .logoUrl,
    ).toBeNull();
    expect((await served(fx.firmA.slug)).status).toBe(404);

    const first = await upload(ownerA, fx.firmA.id, PNG);
    expect(first.status).toBe(200);
    const { logoUrl } = FirmSettings.parse(first.body);
    const base = `${env.PORTAL_BASE_URL.replace(/\/+$/, '')}/api/v1/portal/${fx.firmA.slug}/logo`;
    expect(logoUrl).toMatch(new RegExp(`^${base}\\?v=[0-9a-f-]{36}$`));
    expect((await infoOf(fx.firmA.slug)).branding.logoUrl).toBe(logoUrl);

    // Public, any letter case of the slug, cacheable, and embeddable by the other sites.
    const res = await served(fx.firmA.slug.toUpperCase());
    expect(res.headers).toMatchObject({
      'content-type': 'image/png',
      'cache-control': 'public, max-age=3600',
      'cross-origin-resource-policy': 'cross-origin',
    });
    expect((res.body as Buffer).equals(PNG)).toBe(true);
    const [firstKey] = storage.keysOf(fx.firmA.id);

    // Replace: the new file shows and the old one is deleted.
    expect((await upload(ownerA, fx.firmA.id, WEBP, WEBP, 'image/webp')).status).toBe(200);
    expect((await served(fx.firmA.slug)).headers['content-type']).toBe('image/webp');
    expect(storage.objects.has(firstKey!)).toBe(false);

    // Remove: null everywhere, 404 at the address, nothing left in storage; repeating is harmless.
    const removed = await call('delete', '/business/logo', ownerA, fx.firmA.id);
    expect(FirmSettings.parse(removed.body).logoUrl).toBeNull();
    expect((await served(fx.firmA.slug)).status).toBe(404);
    expect((await infoOf(fx.firmA.slug)).branding.logoUrl).toBeNull();
    expect(storage.keysOf(fx.firmA.id)).toEqual([]);
    expect((await call('delete', '/business/logo', ownerA, fx.firmA.id)).status).toBe(200);

    const rows = [
      ...(await audit(fx.firmA.id, 'business.logo_uploaded')),
      ...(await audit(fx.firmA.id, 'business.logo_removed')),
    ];
    expect(rows).toHaveLength(3); // two uploads and one removal: the repeat is not audited
    for (const row of rows)
      expect(JSON.stringify(row.metadata)).toMatch(
        /^\{"logoId":"[0-9a-f-]{36}","variant":"dark"\}$/,
      );
  });
});

describe('POST /business/logo/uploads/confirm refuses', () => {
  it.each([
    ['a JPEG called PNG', JPEG, JPEG],
    ['an SVG called PNG', SVG, SVG],
    ['a stored file that is not the one described', PNG, JPEG],
  ])(
    '%s: 409 UPLOAD_MISMATCH, the file deleted, the logo unchanged',
    async (_name, described, stored) => {
      const res = await upload(ownerA, fx.firmA.id, described, stored);
      expect([res.status, codeOf(res)]).toEqual([409, 'UPLOAD_MISMATCH']);
      expect(storage.keysOf(fx.firmA.id)).toEqual([]);
      expect((await served(fx.firmA.slug)).status).toBe(404);
    },
  );

  it('a ticket never uploaded (409) and a token that is not one (410)', async () => {
    const ticket = UploadTicket.parse((await ticketFor(ownerA, fx.firmA.id, PNG)).body);
    expect((await confirm(ownerA, fx.firmA.id, ticket.uploadToken)).status).toBe(409);
    const res = await confirm(ownerA, fx.firmA.id, 'not-a-token');
    expect([res.status, codeOf(res)]).toEqual([410, 'UPLOAD_EXPIRED']);
  });
});

describe('one firm never sees or changes another firm logo', () => {
  it("serves A's logo only for A's slug; B's staff cannot confirm, replace or remove it", async () => {
    expect((await upload(ownerA, fx.firmA.id, PNG)).status).toBe(200);
    expect((await served(fx.firmB.slug)).status).toBe(404);
    expect((await infoOf(fx.firmB.slug)).branding.logoUrl).toBeNull();

    // A's sealed ticket is no use to B, and B's owner is nobody at A.
    const ticket = UploadTicket.parse((await ticketFor(ownerA, fx.firmA.id, JPEG)).body);
    storage.put(ticket, JPEG);
    expect((await confirm(ownerB, fx.firmB.id, ticket.uploadToken)).status).toBe(410);
    expect((await confirm(ownerB, fx.firmA.id, ticket.uploadToken)).status).toBe(404);
    expect((await call('delete', '/business/logo', ownerB, fx.firmA.id)).status).toBe(404);

    // B's own upload and removal leave A's logo alone, and each file sits under its own prefix.
    expect((await upload(ownerB, fx.firmB.id, JPEG, JPEG, 'image/jpeg')).status).toBe(200);
    expect((await served(fx.firmB.slug)).headers['content-type']).toBe('image/jpeg');
    await call('delete', '/business/logo', ownerB, fx.firmB.id);
    expect((await served(fx.firmA.slug)).body as Buffer).toEqual(PNG);
    expect(storage.keysOf(fx.firmB.id)).toEqual([]);
  });

  it('an unknown slug and a suspended firm are the same 404', async () => {
    expect((await served('no-such-firm')).status).toBe(404);
    expect((await served(fx.suspended.slug)).status).toBe(404);
  });
});

describe('the logo for light backgrounds', () => {
  const light = '?variant=light';

  it('is its own logo: uploaded, served, replaced and removed apart from the dark one', async () => {
    expect((await served(fx.firmA.slug, light)).status).toBe(404);
    const dark = await upload(ownerA, fx.firmA.id, PNG);
    const first = FirmSettings.parse(dark.body);
    expect(first.logoLightUrl).toBeNull();
    // With only a dark logo there is no light one: 404, never the dark file.
    expect((await served(fx.firmA.slug, light)).status).toBe(404);

    const res = await upload(ownerA, fx.firmA.id, JPEG, JPEG, 'image/jpeg', 'light');
    const settings = FirmSettings.parse(res.body);
    const base = `${env.PORTAL_BASE_URL.replace(/\/+$/, '')}/api/v1/portal/${fx.firmA.slug}/logo`;
    expect(settings.logoUrl).toBe(first.logoUrl);
    expect(settings.logoLightUrl).toMatch(new RegExp(`^${base}\\?variant=light&v=[0-9a-f-]{36}$`));
    const info = (await infoOf(fx.firmA.slug)).branding;
    expect([info.logoUrl, info.logoLightUrl]).toEqual([settings.logoUrl, settings.logoLightUrl]);
    const lightRes = await served(fx.firmA.slug, light);
    expect(lightRes.headers['content-type']).toBe('image/jpeg');
    expect((lightRes.body as Buffer).equals(JPEG)).toBe(true);
    expect((await served(fx.firmA.slug)).headers['content-type']).toBe('image/png');

    // Removing one leaves the other.
    const removed = await call('delete', '/business/logo?variant=light', ownerA, fx.firmA.id);
    expect(FirmSettings.parse(removed.body)).toMatchObject({ logoLightUrl: null });
    expect(FirmSettings.parse(removed.body).logoUrl).toBe(first.logoUrl);
    expect((await served(fx.firmA.slug, light)).status).toBe(404);
    expect((await served(fx.firmA.slug)).status).toBe(200);
    await call('delete', '/business/logo', ownerA, fx.firmA.id);

    const rows = await audit(fx.firmA.id, 'business.logo_uploaded');
    expect(rows.some((r) => JSON.stringify(r.metadata).includes('"variant":"light"'))).toBe(true);
  });

  it('refuses a variant that is neither dark nor light', async () => {
    const bad = await ticketFor(ownerA, fx.firmA.id, PNG, 'image/png', 'sepia');
    expect([bad.status, codeOf(bad)]).toEqual([400, 'VALIDATION_FAILED']);
    expect((await call('delete', '/business/logo?variant=sepia', ownerA, fx.firmA.id)).status).toBe(
      400,
    );
    expect((await served(fx.firmA.slug, '?variant=sepia')).status).toBe(400);
  });

  it('is never served for, or removed by, another firm', async () => {
    const before = storage.keysOf(fx.firmA.id);
    expect((await upload(ownerA, fx.firmA.id, PNG, PNG, 'image/png', 'light')).status).toBe(200);
    expect((await served(fx.firmB.slug, '?variant=light')).status).toBe(404);
    expect((await infoOf(fx.firmB.slug)).branding.logoLightUrl).toBeNull();
    expect((await call('delete', '/business/logo?variant=light', ownerB, fx.firmA.id)).status).toBe(
      404,
    );
    expect((await served(fx.firmA.slug, '?variant=light')).status).toBe(200);
    await call('delete', '/business/logo?variant=light', ownerA, fx.firmA.id);
    expect(storage.keysOf(fx.firmA.id)).toEqual(before); // the light file is deleted
  });
});

describe('PATCH /business/settings: the sidebar slogan and motto', () => {
  const patch = (who: { email: string } | undefined, firm: string, body: object) =>
    call('patch', '/business/settings', who, firm, body);

  it('are plain text up to 80 characters, for Owner and Admin, and cleared by an empty value', async () => {
    const text = {
      sidebarSlogan: 'More Than Taxes. We Build Futures.',
      sidebarMotto: 'PEOPLE | PLANS | PROSPERITY',
    };
    expect((await patch(staffA, fx.firmA.id, text)).status).toBe(403);
    const saved = FirmSettings.parse((await patch(ownerA, fx.firmA.id, text)).body);
    expect(saved).toMatchObject(text);
    expect((await infoOf(fx.firmA.slug)).branding).toMatchObject(text);
    // Another firm shows none of it.
    expect((await infoOf(fx.firmB.slug)).branding).toMatchObject({
      sidebarSlogan: null,
      sidebarMotto: null,
    });
    for (const bad of ['a'.repeat(81), 'two\nlines']) {
      const res = await patch(ownerA, fx.firmA.id, { sidebarSlogan: bad });
      expect([res.status, codeOf(res)]).toEqual([400, 'VALIDATION_FAILED']);
    }
    expect((await patch(ownerA, fx.firmA.id, { sidebarMotto: 'a'.repeat(80) })).status).toBe(200);
    const cleared = FirmSettings.parse(
      (await patch(ownerA, fx.firmA.id, { sidebarSlogan: '', sidebarMotto: '  ' })).body,
    );
    expect([cleared.sidebarSlogan, cleared.sidebarMotto]).toEqual([null, null]);
  });
});
