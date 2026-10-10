// End-to-end: the portal's Signature center (R13 step 9) through the real guard stack. The esign
// tables come with r0_esign, so this covers what answers before the repository: 401 signed out
// and for staff (the portal takes client logins only), 404 for another firm's client, 403 MODULE_OFF while the firm's module is off
// (`status` answers `enabled: false` instead), and 400 for a bad id or query where it is on.
// Synthetic data only.
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
/** A firm of this file only, with Firm Sign on, and its client login. */
const onSlug = `r13-ctr-${randomUUID().slice(0, 8)}`;
const onClient = { id: randomUUID(), email: `r13-ctr-${randomUUID()}@on.test` };
const anyId = randomUUID();
const routes = (slug: string) =>
  [
    ['get', `/api/v1/portal/${slug}/me/signatures`],
    ['get', `/api/v1/portal/${slug}/me/signatures?tab=SIGNED`],
    ['post', `/api/v1/portal/${slug}/me/signatures/${anyId}/session`],
    ['get', `/api/v1/portal/${slug}/me/signatures/${anyId}/download?file=final`],
  ] as const;

beforeAll(async () => {
  const owner = createPrismaClient(testDatabaseUrls('test_api').owner, TEST_CLIENT_OPTIONS);
  const firm = await runInScope(owner, { kind: 'platform' }, async (tx) => {
    const u = onClient;
    await tx.user.create({
      data: { id: u.id, cognitoSub: u.id, pool: 'CLIENT', email: u.email, name: 'Fake client' },
    });
    return tx.business.create({ data: { slug: onSlug, name: onSlug, status: 'ACTIVE' } });
  });
  await runInScope(owner, { kind: 'business', businessId: firm.id }, async (tx) => {
    const businessId = firm.id;
    await tx.clientAccount.create({
      data: { businessId, userId: onClient.id, email: onClient.email, status: 'ACTIVE' },
    });
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

async function send(method: 'get' | 'post', path: string, email: string | null) {
  const headers: Record<string, string> = {};
  if (email) headers.authorization = `Bearer ${await tokenOf(email)}`;
  const req = request(app.getHttpServer())[method](path).set(headers);
  return method === 'post' ? req.send({}) : req;
}
const answer = (res: request.Response) =>
  `${res.status} ${(res.body as { error?: { code: string } }).error?.code}`;

describe('Signature center routes', () => {
  it('refuses the signed out and staff (401), at the status route too', async () => {
    const status: [string, string] = [
      'get',
      `/api/v1/portal/${fx.firmA.slug}/me/signatures/status`,
    ];
    for (const [method, path] of [...routes(fx.firmA.slug), status] as const) {
      expect((await send(method as 'get', path, null)).status).toBe(401);
      for (const who of [fx.users.ownerA, fx.users.staffA]) {
        expect((await send(method as 'get', path, who.email)).status).toBe(401);
      }
    }
  });

  it("refuses another firm's client (404) on every route", async () => {
    for (const [method, path] of routes(fx.firmA.slug)) {
      expect((await send(method, path, fx.users.clientB.email)).status).toBe(404);
    }
    for (const [method, path] of routes(onSlug)) {
      expect((await send(method, path, fx.users.clientA.email)).status).toBe(404);
    }
  });

  it('answers 403 MODULE_OFF while the module is off; status answers enabled: false', async () => {
    for (const [method, path] of routes(fx.firmA.slug)) {
      expect(answer(await send(method, path, fx.users.clientA.email))).toBe('403 MODULE_OFF');
    }
    const off = await send(
      'get',
      `/api/v1/portal/${fx.firmA.slug}/me/signatures/status`,
      fx.users.clientA.email,
    );
    expect([off.status, off.body]).toEqual([200, { enabled: false }]);
    const on = await send('get', `/api/v1/portal/${onSlug}/me/signatures/status`, onClient.email);
    expect([on.status, on.body]).toEqual([200, { enabled: true }]);
  });

  it('validates the id and the query where the module is on (400)', async () => {
    const base = `/api/v1/portal/${onSlug}/me/signatures`;
    const bad = [
      ['get', `${base}?tab=ALL`],
      ['get', `${base}?extra=1`],
      ['post', `${base}/not-a-uuid/session`],
      ['get', `${base}/not-a-uuid/download?file=final`],
      ['get', `${base}/${anyId}/download?file=`],
      ['get', `${base}/${anyId}/download?file=original`],
    ] as const;
    for (const [method, path] of bad) {
      expect(answer(await send(method, path, onClient.email))).toBe('400 VALIDATION_FAILED');
    }
  });
});
