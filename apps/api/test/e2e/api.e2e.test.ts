// End-to-end: the real app (guards, filters, middleware) against the API's test database.
import { Controller, Get, type INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createPrismaClient, runInScope } from '@firmivra/db';
import { testDatabaseUrls } from '@firmivra/db/testing';
import { AppModule } from '../../src/app.module.js';
import { configureApp } from '../../src/configure-app.js';
import { loadEnv } from '../../src/config/env.js';

/** A route someone forgot to protect: default deny must refuse it. */
@Controller('probe-without-roles')
class NoRolesController {
  @Get()
  open() {
    return { leaked: true };
  }
}

const fx = inject('fixtures');
let app: INestApplication;

async function tokenFor(email: string): Promise<string> {
  const res = await request(app.getHttpServer())
    .post('/api/v1/dev/token')
    .send({ email })
    .expect(200);
  return (res.body as { token: string }).token;
}

const get = (path: string, token: string, headers: Record<string, string> = {}) =>
  request(app.getHttpServer()).get(path).set('authorization', `Bearer ${token}`).set(headers);

beforeAll(async () => {
  const env = loadEnv({
    ...process.env,
    NODE_ENV: 'test',
    AUTH_MODE: 'local',
    LOG_LEVEL: 'silent',
    DATABASE_URL_APP: fx.appUrl,
  });
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule.forRoot(env)],
    controllers: [NoRolesController],
  }).compile();
  const nest = moduleRef.createNestApplication<NestExpressApplication>({ logger: false });
  configureApp(nest, env);
  await nest.init();
  app = nest;
});

afterAll(async () => {
  await app.close();
});

describe('health and errors', () => {
  it('reports the database as up', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/health').expect(200);
    expect(res.body).toEqual({ status: 'ok', db: 'ok' });
    expect(res.headers['x-request-id']).toBeTruthy();
  });

  it('keeps a valid incoming request id', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/health')
      .set('x-request-id', 'trace-123');
    expect(res.headers['x-request-id']).toBe('trace-123');
  });

  it('returns the standard error shape without a token', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/me').expect(401);
    expect(res.body).toEqual({
      error: {
        code: 'UNAUTHENTICATED',
        message: 'Sign in required',
        requestId: expect.any(String),
      },
    });
  });

  it('rejects a forged token', async () => {
    await get('/api/v1/me', 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ4In0.bad').expect(401);
  });

  it('validates the dev sign-in body', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/dev/token')
      .send({ email: 'not-an-email' })
      .expect(400);
    expect((res.body as { error: { code: string } }).error.code).toBe('VALIDATION_FAILED');
  });
});

describe('dev sign-in and /me', () => {
  it('sets an HttpOnly cookie and /me works with it', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/dev/token')
      .send({ email: fx.users.ownerA.email })
      .expect(200);
    const cookie = String(res.headers['set-cookie']);
    expect(cookie).toMatch(/fv_access=/);
    expect(cookie).toMatch(/HttpOnly/i);

    const me = await request(app.getHttpServer())
      .get('/api/v1/me')
      .set('cookie', cookie)
      .expect(200);
    const body = me.body as {
      user: { email: string };
      memberships: { business: { id: string }; role: string }[];
    };
    expect(body.user.email).toBe(fx.users.ownerA.email);
    expect(body.memberships).toEqual([
      expect.objectContaining({
        role: 'OWNER',
        business: expect.objectContaining({ id: fx.firmA.id }),
      }),
    ]);
  });

  it('records an audit entry for the sign-in', async () => {
    const urls = testDatabaseUrls('test_api');
    const owner = createPrismaClient(urls.owner);
    const rows = await runInScope(owner, { kind: 'platform' }, (tx) =>
      tx.auditLog.findMany({
        where: { action: 'auth.dev_token_issued', entityId: fx.users.ownerA.id },
      }),
    );
    await owner.$disconnect();
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0]?.requestId).toBeTruthy();
  });
});

describe('tenant isolation', () => {
  it('staff of firm A see firm A', async () => {
    const t = await tokenFor(fx.users.ownerA.email);
    const res = await get('/api/v1/business', t).expect(200);
    expect((res.body as { id: string }).id).toBe(fx.firmA.id);
  });

  it('staff of firm A get 404 for firm B', async () => {
    for (const email of [fx.users.ownerA.email, fx.users.staffA.email]) {
      const t = await tokenFor(email);
      const res = await get('/api/v1/business', t, { 'x-business-id': fx.firmB.id }).expect(404);
      expect((res.body as { error: { code: string } }).error.code).toBe('NOT_FOUND');
    }
  });

  it('an unknown or malformed firm id is also 404', async () => {
    const t = await tokenFor(fx.users.ownerA.email);
    await get('/api/v1/business', t, {
      'x-business-id': '00000000-0000-4000-a000-00000000dead',
    }).expect(404);
    await get('/api/v1/business', t, { 'x-business-id': "x' OR 1=1" }).expect(404);
  });

  it("a client of firm A sees firm A's portal and gets 404 on firm B's", async () => {
    const t = await tokenFor(fx.users.clientA.email);
    await get(`/api/v1/portal/${fx.firmA.slug}/business`, t).expect(200);
    await get(`/api/v1/portal/${fx.firmB.slug}/business`, t).expect(404);
  });

  it('a client cannot use staff routes, even in their own firm (403: the firm is theirs, the action is not)', async () => {
    const t = await tokenFor(fx.users.clientA.email);
    const res = await get('/api/v1/business', t, { 'x-business-id': fx.firmA.id }).expect(403);
    expect((res.body as { error: { code: string } }).error.code).toBe('FORBIDDEN');
    // In a firm they have no account in, the same call is 404.
    await get('/api/v1/business', t, { 'x-business-id': fx.firmB.id }).expect(404);
  });

  it('a client waiting for approval has no firm access yet', async () => {
    const t = await tokenFor(fx.users.pendingClientA.email);
    await get(`/api/v1/portal/${fx.firmA.slug}/business`, t).expect(404);
    const me = await get('/api/v1/me', t).expect(200);
    expect((me.body as { clientAccounts: { status: string }[] }).clientAccounts).toEqual([
      expect.objectContaining({ status: 'PENDING_APPROVAL' }),
    ]);
  });

  it('staff of a suspended firm get 403 BUSINESS_INACTIVE', async () => {
    const t = await tokenFor(fx.users.ownerSuspended.email);
    const res = await get('/api/v1/business', t, { 'x-business-id': fx.suspended.id }).expect(403);
    expect((res.body as { error: { code: string } }).error.code).toBe('BUSINESS_INACTIVE');
  });

  it('a Super Admin sees no firm data without a support grant', async () => {
    const t = await tokenFor(fx.users.admin.email);
    await get('/api/v1/business', t, { 'x-business-id': fx.firmA.id }).expect(404);
    const me = await get('/api/v1/me', t).expect(200);
    expect((me.body as { platformAdmin: boolean }).platformAdmin).toBe(true);
  });
});

describe('default deny', () => {
  it('refuses a route that has no @Roles()', async () => {
    const t = await tokenFor(fx.users.ownerA.email);
    const res = await get('/api/v1/probe-without-roles', t).expect(403);
    expect(res.body).not.toHaveProperty('leaked');
  });
});
