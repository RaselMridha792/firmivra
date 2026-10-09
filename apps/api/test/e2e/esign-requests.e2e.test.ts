// End-to-end: the Firm Sign request routes (R13 step 6, parts 1b to 2b, step 7's send, step 8's
// lifecycle and step 9's templates)
// through the real guard stack. The esign tables come with r0_esign, so this covers what answers
// before the repository: 401 signed out, 403 for clients, 403 MODULE_OFF while the firm's module
// is off, and 400 for a bad id or body where it is on. Synthetic data only.
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createPrismaClient, runInScope } from '@firmivra/db';
import { TEST_CLIENT_OPTIONS, testDatabaseUrls } from '@firmivra/db/testing';
import { AppModule } from '../../src/app.module.js';
import { configureApp } from '../../src/configure-app.js';
import { loadEnv } from '../../src/config/env.js';

const fx = inject('fixtures');
let app: INestApplication;
/** A firm of this file only, with Firm Sign on. */
const onOwner = { id: randomUUID(), email: `r13-req-${randomUUID()}@on.test` };
const anyId = randomUUID();
const base = (id: string) => `/api/v1/esign/requests/${id}`;
type Method = 'get' | 'post' | 'put' | 'patch' | 'delete';
type Route = readonly [Method, string, object | undefined];
const upload = {
  fileName: 'Fake letter.pdf',
  contentType: 'application/pdf',
  sizeBytes: 1000,
  sha256: 'a'.repeat(64),
};
const pages = { pages: [{ documentId: randomUUID(), page: 0, rotation: 0 }] };
/** Every route with a request id, with a valid body: only the id or the guards can refuse it. */
const withId = (id: string): Route[] => [
  ['get', base(id), undefined],
  ['patch', base(id), { title: 'Fake letter' }],
  ['delete', base(id), undefined],
  ['put', `${base(id)}/page-plan`, pages],
  ['put', `${base(id)}/recipients`, { recipients: [] }],
  ['post', `${base(id)}/documents/uploads`, upload],
  ['post', `${base(id)}/documents/uploads/confirm`, { uploadToken: 'fake-token' }],
  ['post', `${base(id)}/documents/from-vault`, { documentId: randomUUID() }],
  ['delete', `${base(id)}/documents/${randomUUID()}`, undefined],
  ['get', `${base(id)}/documents/${randomUUID()}/content`, undefined],
  ['put', `${base(id)}/fields`, { fields: [] }],
  ['get', `${base(id)}/merge-values`, undefined],
  ['get', `${base(id)}/readiness`, undefined],
  ['get', `${base(id)}/events`, undefined],
  ['post', `${base(id)}/send`, { confirm: true }],
  ['post', `${base(id)}/remind`, {}],
  ['post', `${base(id)}/void`, { reason: 'Fake reason' }],
  ['post', `${base(id)}/recipients/${randomUUID()}/correct`, { name: 'Fake Name' }],
  ['post', `${base(id)}/replace`, { reason: 'Fake reason' }],
  ['post', `${base(id)}/save-as-template`, { name: 'Fake template' }],
];
const template = (id: string) => `/api/v1/esign/templates/${id}`;
/** Every template route with a template id, with a valid body. */
const withTemplateId = (id: string): Route[] => [
  ['get', template(id), undefined],
  ['patch', template(id), { name: 'Fake template' }],
  ['post', `${template(id)}/archive`, {}],
  ['get', `${template(id)}/packet`, undefined],
  ['post', `${template(id)}/duplicate`, { name: 'Fake copy' }],
];
const ROUTES: Route[] = [
  ['post', '/api/v1/esign/requests', { title: 'Fake letter' }],
  ['get', '/api/v1/esign/requests', undefined],
  ['get', '/api/v1/esign/requests/summary', undefined],
  ...withId(anyId),
  ['get', '/api/v1/esign/templates', undefined],
  ...withTemplateId(anyId),
];

beforeAll(async () => {
  const owner = createPrismaClient(testDatabaseUrls('test_api').owner, TEST_CLIENT_OPTIONS);
  const slug = `r13-req-${randomUUID().slice(0, 8)}`;
  const firm = await runInScope(owner, { kind: 'platform' }, async (tx) => {
    const u = onOwner;
    await tx.user.create({
      data: { id: u.id, cognitoSub: u.id, pool: 'STAFF', email: u.email, name: 'Fake R13 owner' },
    });
    return tx.business.create({ data: { slug, name: slug, status: 'ACTIVE' } });
  });
  await runInScope(owner, { kind: 'business', businessId: firm.id }, async (tx) => {
    const businessId = firm.id;
    await tx.membership.create({
      data: { businessId, userId: onOwner.id, role: 'OWNER', status: 'ACTIVE' },
    });
    await tx.businessSettings.create({ data: { businessId, enabledModules: ['esign'] } });
  });
  await owner.$disconnect();
  const env = loadEnv({
    ...process.env,
    NODE_ENV: 'test',
    AUTH_MODE: 'local',
    LOG_LEVEL: 'silent',
    DATABASE_URL_APP: fx.appUrl,
  });
  const moduleRef = await Test.createTestingModule({ imports: [AppModule.forRoot(env)] }).compile();
  const nest = moduleRef.createNestApplication<NestExpressApplication>({ logger: false });
  configureApp(nest, env);
  await nest.init();
  app = nest;
});

afterAll(async () => {
  await app.close();
});

/** Dev tokens by email, fetched once each (the dev-token route allows 30 a minute). */
const tokens = new Map<string, string>();
async function tokenFor(email: string): Promise<string> {
  let token = tokens.get(email);
  if (!token) {
    const res = await request(app.getHttpServer()).post('/api/v1/dev/token').send({ email });
    token = (res.body as { token: string }).token;
    tokens.set(email, token);
  }
  return token;
}

async function send(method: Method, path: string, email: string | null, body?: object) {
  const headers: Record<string, string> = {};
  if (email) headers.authorization = `Bearer ${await tokenFor(email)}`;
  const req = request(app.getHttpServer())[method](path).set(headers);
  return body ? req.send(body) : req;
}
const answer = (res: request.Response) =>
  `${res.status} ${(res.body as { error?: { code: string } }).error?.code}`;

describe('Firm Sign draft routes', () => {
  it('refuses the signed out (401) and clients (403) on every route', async () => {
    for (const [method, path, body] of ROUTES) {
      expect((await send(method, path, null, body)).status).toBe(401);
      expect((await send(method, path, fx.users.clientA.email, body)).status).toBe(403);
    }
  });

  it('answers 403 MODULE_OFF to staff while the module is off', async () => {
    for (const [method, path, body] of ROUTES) {
      for (const who of [fx.users.ownerA, fx.users.staffA]) {
        expect(answer(await send(method, path, who.email, body))).toBe('403 MODULE_OFF');
      }
    }
  });

  it('validates the ids and the body where the module is on (400)', async () => {
    for (const [method, path, body] of [...withId('not-a-uuid'), ...withTemplateId('nope')]) {
      expect(answer(await send(method, path, onOwner.email, body))).toBe('400 VALIDATION_FAILED');
    }
    const badBodies: Route[] = [
      ['post', '/api/v1/esign/requests', { title: '' }],
      ['put', `${base(anyId)}/page-plan`, { pages: [] }],
      ['put', `${base(anyId)}/recipients`, { recipients: 'everyone' }],
      ['post', `${base(anyId)}/documents/uploads`, { ...upload, sizeBytes: 0 }],
      ['post', `${base(anyId)}/documents/uploads/confirm`, { uploadToken: '' }],
      ['post', `${base(anyId)}/documents/from-vault`, { documentId: 'not-a-uuid' }],
      ['delete', `${base(anyId)}/documents/not-a-uuid`, undefined],
      ['get', `${base(anyId)}/documents/not-a-uuid/content`, undefined],
      ['put', `${base(anyId)}/fields`, { fields: [], extra: true }],
      ['post', `${base(anyId)}/remind`, { recipientId: 'not-a-uuid' }],
      ['post', `${base(anyId)}/void`, { reason: '' }],
      ['post', `${base(anyId)}/recipients/${randomUUID()}/correct`, {}],
      ['post', `${base(anyId)}/recipients/not-a-uuid/correct`, { name: 'Fake Name' }],
      ['post', `${base(anyId)}/replace`, {}],
      ['patch', template(anyId), {}],
      ['patch', template(anyId), { visibility: 'EVERYONE' }],
      ['get', '/api/v1/esign/templates?archived=maybe', undefined],
      ['post', `${template(anyId)}/duplicate`, {}],
      ['post', `${base(anyId)}/save-as-template`, { name: '' }],
      ...['limit=0', 'status=NOPE', 'cursor=nope', 'extra=1'].map((query): Route => [
        'get',
        `/api/v1/esign/requests?${query}`,
        undefined,
      ]),
    ];
    for (const [method, path, body] of badBodies) {
      expect(answer(await send(method, path, onOwner.email, body))).toBe('400 VALIDATION_FAILED');
    }
    for (const body of [{}, { confirm: false }]) {
      const res = await send('post', `${base(anyId)}/send`, onOwner.email, body);
      expect(answer(res)).toBe('400 VALIDATION_FAILED');
    }
    // A type Firm Sign never takes is named as such, before anything is stored.
    const exe = { ...upload, fileName: 'Fake.exe', contentType: 'application/x-msdownload' };
    const res = await send('post', `${base(anyId)}/documents/uploads`, onOwner.email, exe);
    expect(answer(res)).toBe('400 FILE_TYPE_NOT_ALLOWED');
  });
});
