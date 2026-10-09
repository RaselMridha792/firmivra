// End-to-end: the Firm Sign request routes (R13 step 6, parts 1b to 2b, and step 7's send) through the real guard
// stack. The esign tables come with r0_esign, so this covers what answers before the repository:
// 401 signed out, 403 for clients, 403 MODULE_OFF while the firm's module is off, and 400 for a
// bad id or body where it is on. Synthetic data only.
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
const ROUTES = [
  ['post', '/api/v1/esign/requests', { title: 'Fake letter' }],
  ['get', `/api/v1/esign/requests/${anyId}`, undefined],
  ['patch', `/api/v1/esign/requests/${anyId}`, { title: 'Fake letter' }],
  ['delete', `/api/v1/esign/requests/${anyId}`, undefined],
  ['put', `/api/v1/esign/requests/${anyId}/fields`, { fields: [] }],
  ['get', `/api/v1/esign/requests/${anyId}/merge-values`, undefined],
  ['get', `/api/v1/esign/requests/${anyId}/readiness`, undefined],
  ['get', '/api/v1/esign/requests', undefined],
  ['get', '/api/v1/esign/requests/summary', undefined],
  ['get', `/api/v1/esign/requests/${anyId}/events`, undefined],
  ['post', `/api/v1/esign/requests/${anyId}/send`, { confirm: true }],
] as const;

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

/** One token per person: the dev token route allows 30 a minute. */
const tokens = new Map<string, string>();
async function tokenOf(email: string): Promise<string> {
  let token = tokens.get(email);
  if (!token) {
    const res = await request(app.getHttpServer()).post('/api/v1/dev/token').send({ email });
    token = (res.body as { token: string }).token;
    tokens.set(email, token);
  }
  return token;
}

async function send(
  method: 'get' | 'post' | 'patch' | 'put' | 'delete',
  path: string,
  email: string | null,
  body?: object,
) {
  const headers: Record<string, string> = {};
  if (email) headers.authorization = `Bearer ${await tokenOf(email)}`;
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

  it('validates the id and the body where the module is on (400)', async () => {
    const bad = '/api/v1/esign/requests/not-a-uuid';
    for (const method of ['get', 'patch', 'delete'] as const) {
      const body = method === 'patch' ? { title: 'Fake' } : undefined;
      expect(answer(await send(method, bad, onOwner.email, body))).toBe('400 VALIDATION_FAILED');
    }
    for (const route of ['merge-values', 'readiness', 'events']) {
      const res = await send('get', `${bad}/${route}`, onOwner.email);
      expect(answer(res)).toBe('400 VALIDATION_FAILED');
    }
    const fields = `/api/v1/esign/requests/${anyId}/fields`;
    const noFields = await send('put', fields, onOwner.email, { fields: [], extra: true });
    expect(answer(noFields)).toBe('400 VALIDATION_FAILED');
    for (const query of ['limit=0', 'status=NOPE', 'cursor=nope', 'extra=1']) {
      const res = await send('get', `/api/v1/esign/requests?${query}`, onOwner.email);
      expect(answer(res)).toBe('400 VALIDATION_FAILED');
    }
    for (const body of [{}, { confirm: false }]) {
      const res = await send('post', `/api/v1/esign/requests/${anyId}/send`, onOwner.email, body);
      expect(answer(res)).toBe('400 VALIDATION_FAILED');
    }
    const badSend = await send('post', `${bad}/send`, onOwner.email, { confirm: true });
    expect(answer(badSend)).toBe('400 VALIDATION_FAILED');
    const noTitle = await send('post', '/api/v1/esign/requests', onOwner.email, { title: '' });
    expect(answer(noTitle)).toBe('400 VALIDATION_FAILED');
  });
});
