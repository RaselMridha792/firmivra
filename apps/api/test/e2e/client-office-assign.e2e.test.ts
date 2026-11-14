// End-to-end: a client's local office on their profile (PRT-1 part 2; Client Portal guide 2, 7.4
// and 9.1). GET /business/clients/{id}/office shows it, the office chosen at sign-up and the
// firm's active locations; PUT changes it (Owner and Admin only, audited with the old and new
// office) to an active location of this firm, or none. Staff see only their own clients.
// Synthetic data only.
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createPrismaClient, runInScope } from '@firmivra/db';
import { TEST_CLIENT_OPTIONS, testDatabaseUrls } from '@firmivra/db/testing';
import { ClientOffice } from '@firmivra/types';
import { AppModule } from '../../src/app.module.js';
import { configureApp } from '../../src/configure-app.js';
import { loadEnv } from '../../src/config/env.js';

const fx = inject('fixtures');
let app: INestApplication;
const run = randomUUID().slice(0, 8);
const firms = { a: '', b: '' };
const offices = { auburn: '', lawrenceville: '', closed: '', ofB: '' };
const clients = { mine: '', other: '' };
const person = (key: string) => ({ id: randomUUID(), email: `r60-co-${key}-${run}@r60.test` });
const owner = person('owner');
const admin = person('admin');
const staff = person('staff');
const portalUser = person('portal');
const db = createPrismaClient(testDatabaseUrls('test_api').owner, TEST_CLIENT_OPTIONS);
const inFirm = <T>(firm: 'a' | 'b', work: Parameters<typeof runInScope<T>>[2]) =>
  runInScope(db, { kind: 'business', businessId: firms[firm] }, work);

beforeAll(async () => {
  await runInScope(db, { kind: 'platform' }, async (tx) => {
    for (const [key, slug] of [
      ['a', `r60-co-a-${run}`],
      ['b', `r60-co-b-${run}`],
    ] as const) {
      firms[key] = (await tx.business.create({ data: { slug, name: slug, status: 'ACTIVE' } })).id;
    }
    for (const [u, pool] of [
      [owner, 'STAFF'],
      [admin, 'STAFF'],
      [staff, 'STAFF'],
      [portalUser, 'CLIENT'],
    ] as const) {
      await tx.user.create({
        data: { id: u.id, cognitoSub: u.id, pool, email: u.email, name: 'Fake R60 office' },
      });
    }
  });
  await inFirm('a', async (tx) => {
    const businessId = firms.a;
    for (const [u, role] of [
      [owner, 'OWNER'],
      [admin, 'ADMIN'],
      [staff, 'STAFF'],
    ] as const) {
      await tx.membership.create({ data: { businessId, userId: u.id, role, status: 'ACTIVE' } });
    }
    const office = async (name: string, extra: object = {}) =>
      (await tx.firmOffice.create({ data: { businessId, name, ...extra }, select: { id: true } }))
        .id;
    offices.lawrenceville = await office('Lawrenceville Office', {
      addressLine1: '456 Fake Pine Rd',
      city: 'Lawrenceville',
      state: 'GA',
      postalCode: '30046',
    });
    offices.auburn = await office('Auburn Office', { isMain: true, city: 'Auburn', state: 'GA' });
    offices.closed = await office('Closed Office');
    clients.mine = (
      await tx.client.create({
        data: {
          businessId,
          displayName: 'Fake Office Client',
          assignedUserId: staff.id,
          officeId: offices.closed,
        },
        select: { id: true },
      })
    ).id;
    clients.other = (
      await tx.client.create({
        data: { businessId, displayName: 'Fake Other Client' },
        select: { id: true },
      })
    ).id;
    await tx.clientAccount.create({
      data: {
        businessId,
        userId: portalUser.id,
        email: portalUser.email,
        clientId: clients.mine,
        portalRole: 'PRIMARY',
        status: 'ACTIVE',
        selectedOfficeId: offices.lawrenceville,
      },
    });
    // Closed after it was assigned: kept on the record, never offered again.
    await tx.firmOffice.update({ where: { id: offices.closed }, data: { status: 'INACTIVE' } });
  });
  offices.ofB = await inFirm(
    'b',
    async (tx) =>
      (
        await tx.firmOffice.create({
          data: { businessId: firms.b, name: 'B Office' },
          select: { id: true },
        })
      ).id,
  );
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
  await db.$disconnect();
});

const tokens = new Map<string, string>();
async function call(
  method: 'get' | 'put',
  clientId: string,
  who: { email: string },
  body?: object,
) {
  let token = tokens.get(who.email);
  if (!token) {
    const res = await request(app.getHttpServer())
      .post('/api/v1/dev/token')
      .send({ email: who.email });
    token = (res.body as { token: string }).token;
    tokens.set(who.email, token);
  }
  const req = request(app.getHttpServer())
    [method](`/api/v1/business/clients/${clientId}/office`)
    .set('authorization', `Bearer ${token}`);
  return body ? req.send(body) : req;
}
const code = (res: request.Response) => (res.body as { error?: { code: string } }).error?.code;
const officeRows = () =>
  inFirm('a', (tx) =>
    tx.auditLog.findMany({
      where: { businessId: firms.a, action: 'client.office_changed', entityId: clients.mine },
      orderBy: { createdAt: 'asc' },
    }),
  );

describe('a client’s local office', () => {
  it('shows the office (closed since), the sign-up choice and the active locations', async () => {
    const res = await call('get', clients.mine, owner);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const o = ClientOffice.parse(res.body);
    expect(o.office).toMatchObject({ id: offices.closed, name: 'Closed Office', active: false });
    expect(o.chosenAtSignUp).toEqual({ id: offices.lawrenceville, name: 'Lawrenceville Office' });
    expect(o.choices.map((c) => c.name)).toEqual(['Auburn Office', 'Lawrenceville Office']);
    expect(o.choices[1]?.addressLines).toEqual(['456 Fake Pine Rd', 'Lawrenceville, GA 30046']);
    expect(o.canChange).toBe(true);
  });

  it('lets an Owner or Admin change it, audited, and set none; the same office writes nothing', async () => {
    const set = await call('put', clients.mine, admin, { officeId: offices.lawrenceville });
    expect(set.status, JSON.stringify(set.body)).toBe(200);
    expect(ClientOffice.parse(set.body).office).toMatchObject({
      id: offices.lawrenceville,
      active: true,
    });
    expect((await officeRows()).map((r) => r.metadata)).toEqual([
      { from: offices.closed, to: offices.lawrenceville },
    ]);
    await call('put', clients.mine, owner, { officeId: offices.lawrenceville });
    expect(await officeRows()).toHaveLength(1);
    const none = await call('put', clients.mine, owner, { officeId: null });
    expect(ClientOffice.parse(none.body).office).toBeNull();
    expect((await officeRows()).at(-1)?.metadata).toEqual({
      from: offices.lawrenceville,
      to: null,
    });
  });

  it('refuses a closed office, another firm’s office and an unknown one', async () => {
    for (const officeId of [offices.closed, offices.ofB, randomUUID()]) {
      const res = await call('put', clients.mine, owner, { officeId });
      expect([res.status, code(res)]).toEqual([400, 'OFFICE_NOT_AVAILABLE']);
    }
    expect((await call('put', clients.mine, owner, {})).status).toBe(400);
  });

  it('Staff see their own client’s office but cannot change it, and never another client’s', async () => {
    const mine = ClientOffice.parse((await call('get', clients.mine, staff)).body);
    expect(mine.canChange).toBe(false);
    expect((await call('get', clients.other, staff)).status).toBe(404);
    expect((await call('put', clients.mine, staff, { officeId: offices.auburn })).status).toBe(403);
  });
});
