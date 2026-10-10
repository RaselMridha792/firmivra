// End-to-end: GET /esign/status (R13 step 6) through the real guard stack. It never answers
// MODULE_OFF; the switch is the firm's business_settings.enabled_modules. Synthetic data only.
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
const onOwner = { id: randomUUID(), email: `r13-status-${randomUUID()}@on.test` };

beforeAll(async () => {
  const owner = createPrismaClient(testDatabaseUrls('test_api').owner, TEST_CLIENT_OPTIONS);
  const slug = `r13-status-${randomUUID().slice(0, 8)}`;
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

async function status(email: string | null, firm?: string) {
  const headers: Record<string, string> = firm ? { 'x-business-id': firm } : {};
  if (email) {
    const res = await request(app.getHttpServer()).post('/api/v1/dev/token').send({ email });
    headers.authorization = `Bearer ${(res.body as { token: string }).token}`;
  }
  return request(app.getHttpServer()).get('/api/v1/esign/status').set(headers);
}

describe('GET /esign/status', () => {
  it('answers firm members, off with no role while the module is off', async () => {
    for (const who of [fx.users.ownerA, fx.users.staffA]) {
      const res = await status(who.email);
      expect([res.status, res.body]).toEqual([200, { enabled: false, myEsignRole: null }]);
    }
  });

  it('says on, with the role, for a firm whose enabled modules list esign', async () => {
    const res = await status(onOwner.email);
    expect([res.status, res.body]).toEqual([200, { enabled: true, myEsignRole: 'OWNER' }]);
  });

  it('refuses clients (403), the signed out (401) and another firm (404)', async () => {
    expect((await status(fx.users.clientA.email)).status).toBe(403);
    expect((await status(null)).status).toBe(401);
    expect((await status(fx.users.ownerA.email, fx.firmB.id)).status).toBe(404);
  });
});
