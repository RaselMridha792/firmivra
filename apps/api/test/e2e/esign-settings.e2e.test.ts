// End-to-end: Signing Settings (R13 step 9) through the real guard stack. The esign tables come
// with r0_esign, so this covers what answers before the repository: 401 signed out, 403 for
// clients, 403 MODULE_OFF while the firm's module is off, 403 FORBIDDEN for Staff changing a
// setting, and 400 for a bad body where it is on. Synthetic data only.
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
/** A firm of this file only, with Firm Sign on: its Owner and a Staff member. */
const onOwner = { id: randomUUID(), email: `r13-set-o-${randomUUID()}@on.test` };
const onStaff = { id: randomUUID(), email: `r13-set-s-${randomUUID()}@on.test` };
const TEXT = 'I agree to sign electronically. (Fake consent text for tests.)';
const ROUTES = [
  ['get', '/api/v1/esign/settings', undefined],
  ['put', '/api/v1/esign/settings', { expiryDays: 10 }],
  ['get', '/api/v1/esign/settings/consent-versions', undefined],
  ['post', '/api/v1/esign/settings/consent-versions', { bodyMarkdown: TEXT }],
  ['put', '/api/v1/esign/me/profile', { jobTitle: 'Fake Preparer' }],
] as const;

beforeAll(async () => {
  const owner = createPrismaClient(testDatabaseUrls('test_api').owner, TEST_CLIENT_OPTIONS);
  const slug = `r13-set-${randomUUID().slice(0, 8)}`;
  const firm = await runInScope(owner, { kind: 'platform' }, async (tx) => {
    for (const [u, name] of [
      [onOwner, 'Fake R13 owner'],
      [onStaff, 'Fake R13 staff'],
    ] as const) {
      await tx.user.create({
        data: { id: u.id, cognitoSub: u.id, pool: 'STAFF', email: u.email, name },
      });
    }
    return tx.business.create({ data: { slug, name: slug, status: 'ACTIVE' } });
  });
  await runInScope(owner, { kind: 'business', businessId: firm.id }, async (tx) => {
    const businessId = firm.id;
    for (const [u, role] of [
      [onOwner, 'OWNER'],
      [onStaff, 'STAFF'],
    ] as const) {
      await tx.membership.create({ data: { businessId, userId: u.id, role, status: 'ACTIVE' } });
    }
    // The module switch (r0_esign): only app_set_business_module changes enabled_modules.
    await tx.$queryRaw`SELECT app_set_business_module(${businessId}::uuid, 'esign', true, 'e2e test')`;
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
  method: 'get' | 'post' | 'put',
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

describe('Signing Settings routes', () => {
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

  it('refuses Staff changing a setting or publishing consent (403 FORBIDDEN)', async () => {
    for (const [method, path, body] of ROUTES.filter(([, p, b]) => b && !p.includes('/me/'))) {
      expect(answer(await send(method, path, onStaff.email, body))).toBe('403 FORBIDDEN');
    }
  });

  it('validates the body where the module is on (400)', async () => {
    const bad = [
      ['put', '/api/v1/esign/settings', {}],
      ['put', '/api/v1/esign/settings', { expiryDays: 0 }],
      ['put', '/api/v1/esign/settings', { expiryDays: 5, extra: true }],
      ['post', '/api/v1/esign/settings/consent-versions', { bodyMarkdown: '' }],
      ['put', '/api/v1/esign/me/profile', { jobTitle: 'x'.repeat(101) }],
    ] as const;
    for (const [method, path, body] of bad) {
      for (const who of [onOwner, onStaff]) {
        expect(answer(await send(method, path, who.email, body))).toBe('400 VALIDATION_FAILED');
      }
    }
  });
});
