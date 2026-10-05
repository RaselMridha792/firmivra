// End-to-end: GET /me and GET /admin/me (R2 step 4). Firms and roles always come from our
// database, and nobody ever sees another person's memberships.
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createPrismaClient, runInScope } from '@firmivra/db';
import { testDatabaseUrls } from '@firmivra/db/testing';
import type { MeResponse } from '@firmivra/types';
import { AppModule } from '../../src/app.module.js';
import { configureApp } from '../../src/configure-app.js';
import { loadEnv } from '../../src/config/env.js';

const fx = inject('fixtures');
let app: INestApplication;

/** People of this file only, so the shared fixtures other tests rely on stay as they are. */
const multiFirmStaff = { id: randomUUID(), email: `r2-me-staff-${randomUUID()}@a.test` };
const invitedClient = { id: randomUUID(), email: `r2-me-client-${randomUUID()}@b.test` };

async function tokenFor(email: string): Promise<string> {
  const res = await request(app.getHttpServer())
    .post('/api/v1/dev/token')
    .send({ email })
    .expect(200);
  return (res.body as { token: string }).token;
}

async function me(path: string, email: string) {
  const token = await tokenFor(email);
  return request(app.getHttpServer()).get(path).set('authorization', `Bearer ${token}`);
}

beforeAll(async () => {
  const owner = createPrismaClient(testDatabaseUrls('test_api').owner);
  await runInScope(owner, { kind: 'platform' }, async (tx) => {
    for (const [u, pool] of [
      [multiFirmStaff, 'STAFF'],
      [invitedClient, 'CLIENT'],
    ] as const) {
      await tx.user.create({
        data: { id: u.id, cognitoSub: u.id, pool, email: u.email, name: 'Fake R2 person' },
      });
    }
  });
  const memberships = [
    [fx.firmA.id, 'STAFF', 'ACTIVE'],
    [fx.firmB.id, 'ADMIN', 'DEACTIVATED'],
    [fx.suspended.id, 'STAFF', 'INVITED'],
  ] as const;
  for (const [businessId, role, status] of memberships) {
    await runInScope(owner, { kind: 'business', businessId }, (tx) =>
      tx.membership.create({ data: { businessId, userId: multiFirmStaff.id, role, status } }),
    );
  }
  await runInScope(owner, { kind: 'business', businessId: fx.firmB.id }, (tx) =>
    tx.clientAccount.create({
      data: {
        businessId: fx.firmB.id,
        userId: invitedClient.id,
        email: invitedClient.email,
        status: 'INVITED',
      },
    }),
  );
  await owner.$disconnect();

  const env = loadEnv({
    ...process.env,
    NODE_ENV: 'test',
    AUTH_MODE: 'local',
    LOG_LEVEL: 'silent',
    DATABASE_URL_APP: fx.appUrl,
  });
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule.forRoot(env)],
  }).compile();
  const nest = moduleRef.createNestApplication<NestExpressApplication>({ logger: false });
  configureApp(nest, env);
  await nest.init();
  app = nest;
});

afterAll(async () => {
  await app.close();
});

describe('GET /me', () => {
  it('lists every firm of a staff member with the role and status from the database', async () => {
    const res = await me('/api/v1/me', multiFirmStaff.email);
    expect(res.status).toBe(200);
    const body = res.body as MeResponse;
    expect(body.user).toEqual({
      id: multiFirmStaff.id,
      email: multiFirmStaff.email,
      name: 'Fake R2 person',
      pool: 'STAFF',
    });
    // Oldest first; nothing from anyone else's memberships.
    expect(body.memberships.map((m) => [m.business.id, m.role, m.status])).toEqual([
      [fx.firmA.id, 'STAFF', 'ACTIVE'],
      [fx.firmB.id, 'ADMIN', 'DEACTIVATED'],
      [fx.suspended.id, 'STAFF', 'INVITED'],
    ]);
    expect(body.memberships[2]?.business).toEqual({
      id: fx.suspended.id,
      slug: fx.suspended.slug,
      name: fx.suspended.slug,
      status: 'SUSPENDED',
    });
    expect(body.clientAccounts).toEqual([]);
    expect(body.platformAdmin).toBe(false);
  });

  it('shows a client their own firm only, including an invited account', async () => {
    const res = await me('/api/v1/me', invitedClient.email);
    expect(res.status).toBe(200);
    const body = res.body as MeResponse;
    expect(body.memberships).toEqual([]);
    expect(body.clientAccounts).toEqual([
      {
        status: 'INVITED',
        business: { id: fx.firmB.id, slug: fx.firmB.slug, name: fx.firmB.slug, status: 'ACTIVE' },
      },
    ]);
  });

  it('a role change shows on the next call, without signing in again', async () => {
    const token = await tokenFor(multiFirmStaff.email);
    const call = () =>
      request(app.getHttpServer()).get('/api/v1/me').set('authorization', `Bearer ${token}`);
    const before = (await call().expect(200)).body as MeResponse;
    expect(before.memberships[0]?.role).toBe('STAFF');

    const owner = createPrismaClient(testDatabaseUrls('test_api').owner);
    const setRole = (role: 'STAFF' | 'ADMIN') =>
      runInScope(owner, { kind: 'business', businessId: fx.firmA.id }, (tx) =>
        tx.membership.updateMany({ where: { userId: multiFirmStaff.id }, data: { role } }),
      );
    try {
      await setRole('ADMIN');
      const after = (await call().expect(200)).body as MeResponse;
      expect(after.memberships[0]?.role).toBe('ADMIN');
    } finally {
      await setRole('STAFF');
      await owner.$disconnect();
    }
  });
});

describe('GET /admin/me', () => {
  it('answers a Super Admin and nobody else', async () => {
    const admin = await me('/api/v1/admin/me', fx.users.admin.email);
    expect(admin.status).toBe(200);
    expect((admin.body as MeResponse).platformAdmin).toBe(true);
    expect((admin.body as MeResponse).user.pool).toBe('ADMIN');

    for (const email of [fx.users.ownerA.email, fx.users.clientA.email]) {
      expect((await me('/api/v1/admin/me', email)).status).toBe(401);
    }
  });
});
