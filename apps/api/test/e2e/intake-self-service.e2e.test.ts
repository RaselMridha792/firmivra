// End-to-end: R55, Intake Forms Review Two INTAKE-ACCESS-02 part B (decisions 1a and 3, Nov 15). A
// form the firm publishes in the client portal is listed for every client; the primary login
// starts it: their open one, or a new one on their service of it that has none live, or on a new
// PENDING service for the firm to review. A signed-in client starts a form by its share link the
// same way, published in the portal or not. Files go into the form on a PENDING service.
// Synthetic data only.
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request, { type Response } from 'supertest';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createPrismaClient, runInScope, type TxClient } from '@firmivra/db';
import { TEST_CLIENT_OPTIONS, testDatabaseUrls } from '@firmivra/db/testing';
import { INTAKE_FORMS, IntakeUpload, MyIntake, PortalIntakeFormList } from '@firmivra/types';
import { AppModule } from '../../src/app.module.js';
import { configureApp } from '../../src/configure-app.js';
import { loadEnv } from '../../src/config/env.js';
import { DOCUMENTS_CONFIG } from '../../src/storage/config.js';
import { DOCUMENT_STORAGE, type DocumentStorage } from '../../src/storage/document-storage.js';
import { MemoryUploads } from '../memory-uploads.js';
import { pdf, sha256 as shaOf } from '../office-files.js';

const objects = new Map<string, Buffer>();
const uploads = new MemoryUploads(objects);
const storage: DocumentStorage = {
  presignUpload: (f) => uploads.presign(f),
  completeUpload: (key, id, size) => uploads.complete(key, id, size),
  abortUpload: (key, id) => uploads.abort(key, id),
  head: (key) => {
    const b = objects.get(key);
    return Promise.resolve(b ? { sizeBytes: b.length, sha256: null, contentEncoding: null } : null);
  },
  read: (key) => Promise.resolve(objects.get(key) ?? null),
  remove: (key) => {
    objects.delete(key);
    return Promise.resolve();
  },
  presignDownload: (f) => Promise.resolve(`memory:${f.key}?download`),
} as DocumentStorage;

const fx = inject('fixtures');
const run = randomUUID().slice(0, 8);
const person = (key: string) => ({ id: randomUUID(), email: `r55ss-${key}-${run}@r55.test` });
const people = {
  owner: person('owner'),
  one: person('one'),
  spouse: person('spouse'),
  ownerB: person('owner-b'),
  clientB: person('client-b'),
};
const ids = {} as Record<string, string>;
const slugs = { a: `r55ss-a-${run}`, b: `r55ss-b-${run}` };
/** The hidden form's share link token (its hash is what the template keeps). */
const SHARE_TOKEN = randomBytes(32).toString('base64url');
const FORM = INTAKE_FORMS.QUARTERLY_TAX!;
let app: INestApplication;
const tokens = new Map<string, string>();
const codeOf = (res: Response) => (res.body as { error?: { code: string } }).error?.code;
const expectError = (res: Response, status: number, code: string) =>
  expect([res.status, codeOf(res)], JSON.stringify(res.body)).toEqual([status, code]);
const ok = (res: Response) => {
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body as unknown;
};
const owner = () => createPrismaClient(testDatabaseUrls('test_api').owner, TEST_CLIENT_OPTIONS);
async function inFirmA<T>(work: (tx: TxClient) => Promise<T>): Promise<T> {
  const o = owner();
  try {
    return await runInScope(o, { kind: 'business', businessId: ids.firmA! }, work);
  } finally {
    await o.$disconnect();
  }
}

async function tokenFor(email: string): Promise<string> {
  const cached = tokens.get(email);
  if (cached) return cached;
  const res = await request(app.getHttpServer())
    .post('/api/v1/dev/token')
    .send({ email })
    .expect(200);
  const token = (res.body as { token: string }).token;
  tokens.set(email, token);
  return token;
}
async function portal(
  method: 'get' | 'post' | 'put',
  path: string,
  who: { email: string },
  body?: object,
  slug = slugs.a,
): Promise<Response> {
  // The token first: a request built before it would lose its server to the token's request.
  const token = await tokenFor(who.email);
  const req = request(app.getHttpServer())
    [method](`/api/v1/portal/${slug}/me${path}`)
    .set('authorization', `Bearer ${token}`);
  return body === undefined ? req : req.send(body);
}
const forms = async (who: { email: string }, slug = slugs.a) =>
  PortalIntakeFormList.parse(ok(await portal('get', '/intake-forms', who, undefined, slug))).items;

beforeAll(async () => {
  const o = owner();
  await runInScope(o, { kind: 'platform' }, async (tx) => {
    for (const [key, p] of Object.entries(people)) {
      const pool = key === 'owner' || key === 'ownerB' ? 'STAFF' : 'CLIENT';
      await tx.user.create({
        data: { id: p.id, cognitoSub: p.id, pool, email: p.email, name: `Fake ${key}` },
      });
    }
    ids.firmA = (
      await tx.business.create({ data: { slug: slugs.a, name: 'A', status: 'ACTIVE' } })
    ).id;
    ids.firmB = (
      await tx.business.create({ data: { slug: slugs.b, name: 'B', status: 'ACTIVE' } })
    ).id;
  });
  await runInScope(o, { kind: 'business', businessId: ids.firmA! }, async (tx) => {
    const A = { businessId: ids.firmA! };
    await tx.membership.create({
      data: { ...A, userId: people.owner.id, role: 'OWNER', status: 'ACTIVE' },
    });
    ids.client = (await tx.client.create({ data: { ...A, displayName: 'One (fake)' } })).id;
    for (const [p, portalRole] of [
      [people.one, 'PRIMARY'],
      [people.spouse, 'SPOUSE'],
    ] as const) {
      await tx.clientAccount.create({
        data: {
          ...A,
          userId: p.id,
          clientId: ids.client,
          email: p.email,
          portalRole,
          status: 'ACTIVE',
        },
      });
    }
    ids.service = (
      await tx.service.create({
        data: { ...A, kind: 'QUARTERLY_TAX', name: `Quarterly ${run}`, status: 'ACTIVE' },
      })
    ).id;
    // The client's ACTIVE service of it, with no form yet: the first start goes there.
    ids.active = (
      await tx.engagement.create({
        data: { ...A, clientId: ids.client, serviceId: ids.service, title: 'Quarterly 2026' },
      })
    ).id;
    const template = async (
      title: string,
      extra: { portalPublished?: boolean; shareTokenHash?: string; archivedAt?: Date } = {},
    ) => {
      const { archivedAt, ...rest } = extra;
      const t = await tx.intakeTemplate.create({
        data: { ...A, serviceId: ids.service!, ...rest },
      });
      await tx.intakeForm.create({
        data: {
          ...A,
          serviceId: ids.service!,
          templateId: t.id,
          version: 1,
          title,
          definition: { ...FORM, title } as object,
          status: 'PUBLISHED',
          publishedAt: new Date(),
        },
      });
      // Archived after its version (an archived template takes no new version).
      if (archivedAt) await tx.intakeTemplate.update({ where: { id: t.id }, data: { archivedAt } });
      return t.id;
    };
    ids.published = await template('Quarterly Check-In', { portalPublished: true });
    ids.hidden = await template('Quarterly Special', {
      shareTokenHash: createHash('sha256').update(SHARE_TOKEN).digest('hex'),
    });
    ids.archived = await template('Old Form', { portalPublished: true, archivedAt: new Date() });
  });
  await runInScope(o, { kind: 'business', businessId: ids.firmB! }, async (tx) => {
    const B = { businessId: ids.firmB! };
    await tx.membership.create({
      data: { ...B, userId: people.ownerB.id, role: 'OWNER', status: 'ACTIVE' },
    });
    const client = await tx.client.create({ data: { ...B, displayName: 'B (fake)' } });
    await tx.clientAccount.create({
      data: {
        ...B,
        userId: people.clientB.id,
        clientId: client.id,
        email: people.clientB.email,
        portalRole: 'PRIMARY',
        status: 'ACTIVE',
      },
    });
  });
  await o.$disconnect();
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
    .useValue({ bucket: 'unused', region: 'us-east-1', forcePathStyle: true, scanMode: 'local' })
    .compile();
  const nest = moduleRef.createNestApplication<NestExpressApplication>({ logger: false });
  configureApp(nest, env);
  await nest.init();
  app = nest;
});

afterAll(async () => {
  await app.close();
});

describe('forms published in the client portal (ACCESS-02 part B)', () => {
  it('lists only live forms published in the portal, to every login of the client', async () => {
    const listed = await forms(people.spouse);
    expect(listed.map((f) => [f.templateId, f.title, f.form, f.intakeId])).toEqual([
      [ids.published, 'Quarterly Check-In', 'QUARTERLY_TAX', null],
    ]);
  });

  it("the primary login starts one on the client's own service; again, the same one", async () => {
    expectError(
      await portal('post', `/intake-forms/${ids.published}/start`, people.spouse),
      403,
      'FORBIDDEN',
    );
    const started = MyIntake.parse(
      ok(await portal('post', `/intake-forms/${ids.published}/start`, people.one)),
    );
    expect(started).toMatchObject({ status: 'SENT', title: 'Quarterly Check-In', canEdit: true });
    const row = await inFirmA((tx) =>
      tx.intake.findUniqueOrThrow({
        where: { id: started.id },
        select: { engagementId: true, form: { select: { templateId: true } } },
      }),
    );
    // The client's ACTIVE service of it, which had no form yet.
    expect(row).toEqual({ engagementId: ids.active, form: { templateId: ids.published } });
    const again = MyIntake.parse(
      ok(await portal('post', `/intake-forms/${ids.published}/start`, people.one)),
    );
    expect(again.id).toBe(started.id);
    expect((await forms(people.one))[0]!.intakeId).toBe(started.id);
    // It is the client's like any form the firm sent.
    expect(MyIntake.parse(ok(await portal('get', `/intakes/${started.id}`, people.one))).id).toBe(
      started.id,
    );
    const audit = await inFirmA((tx) =>
      tx.auditLog.findMany({ where: { entityId: started.id, action: 'intake.self_started' } }),
    );
    expect(audit).toHaveLength(1);
    expect(audit[0]!.metadata).toMatchObject({ templateId: ids.published, via: 'portal' });
  });

  it('a form not in the portal starts only by its share link, on a new PENDING service', async () => {
    expectError(
      await portal('post', `/intake-forms/${ids.hidden}/start`, people.one),
      404,
      'NOT_FOUND',
    );
    expectError(
      await portal('post', `/intake-forms/${ids.archived}/start`, people.one),
      404,
      'NOT_FOUND',
    );
    const shared = MyIntake.parse(
      ok(await portal('post', `/intake-forms/shared/${SHARE_TOKEN}/start`, people.one)),
    );
    expect(shared.title).toBe('Quarterly Special');
    const engagement = await inFirmA((tx) =>
      tx.engagement.findFirstOrThrow({
        where: { intakes: { some: { id: shared.id } } },
        select: { id: true, status: true, clientId: true },
      }),
    );
    // The ACTIVE service already has a live form: a new PENDING one, for the firm to review.
    expect(engagement).toMatchObject({ status: 'PENDING', clientId: ids.client });
    expect(engagement.id).not.toBe(ids.active);
    ids.sharedIntake = shared.id;
    expectError(
      await portal(
        'post',
        `/intake-forms/shared/${randomBytes(32).toString('base64url')}/start`,
        people.one,
      ),
      410,
      'LINK_INVALID',
    );
    // Another firm's client, on their own firm's site, finds nothing by firm A's link.
    expectError(
      await portal(
        'post',
        `/intake-forms/shared/${SHARE_TOKEN}/start`,
        people.clientB,
        undefined,
        slugs.b,
      ),
      410,
      'LINK_INVALID',
    );
    // Firm B's portal lists none of firm A's forms.
    expect(await forms(people.clientB, slugs.b)).toEqual([]);
  });

  it('takes a file into the form on a PENDING service', async () => {
    const bytes = pdf(`income ${run}`);
    const ticket = ok(
      await portal('post', `/intakes/${ids.sharedIntake}/uploads`, people.one, {
        slot: 'incomeDocuments',
        fileName: 'income-synthetic.pdf',
        contentType: 'application/pdf',
        sizeBytes: bytes.length,
        sha256: shaOf(bytes),
      }),
    ) as { url: string; uploadToken: string };
    objects.set(ticket.url.slice('memory:'.length), bytes);
    const file = IntakeUpload.parse(
      ok(
        await portal('post', `/intakes/${ids.sharedIntake}/uploads/confirm`, people.one, {
          uploadToken: ticket.uploadToken,
        }),
      ),
    );
    expect(file).toMatchObject({ slot: 'incomeDocuments', fileName: 'income-synthetic.pdf' });
  });
});
