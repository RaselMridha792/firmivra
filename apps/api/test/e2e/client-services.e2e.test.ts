// End-to-end: Octavia's E4 (Clients review, Oct 25), GET /business/clients/{id}/services: the
// client's services, newest first, each with the module record that opens it (the engagement's
// newest tax return, its bookkeeping client, its payroll client, the client's newest tax plan, the
// advisory client), only where the member's grid has VIEW in that module. An advisory
// enrollment without an engagement counts. Staff reach their own clients; firm B sees nothing.
// Synthetic data only.
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createPrismaClient, runInScope, type TxClient } from '@firmivra/db';
import { TEST_CLIENT_OPTIONS, testDatabaseUrls } from '@firmivra/db/testing';
import { ClientServiceList, type ServiceKind } from '@firmivra/types';
import { AppModule } from '../../src/app.module.js';
import { TokenService } from '../../src/auth/token.service.js';
import { configureApp } from '../../src/configure-app.js';
import { loadEnv } from '../../src/config/env.js';

const fx = inject('fixtures');
const run = randomUUID().slice(0, 8);
const person = (key: string) => ({ id: randomUUID(), email: `r60s-${key}-${run}@r60s.test` });
const people = {
  ownerA: person('owner-a'),
  staffA: person('staff-a'),
  staffA2: person('staff-a2'),
  ownerB: person('owner-b'),
};
type Person = (typeof people)[keyof typeof people];
const firms = {} as Record<'a' | 'b', string>;
const ids = {} as Record<string, string>;
const DAY = 86_400_000;

let app: INestApplication;
const db = createPrismaClient(testDatabaseUrls('test_api').owner, TEST_CLIENT_OPTIONS);
const inFirm = <T>(k: 'a' | 'b', work: (tx: TxClient) => Promise<T>) =>
  runInScope(db, { kind: 'business', businessId: firms[k] }, work);

async function services(clientId: string, who: Person, firm: 'a' | 'b' = 'a') {
  const { token } = await app.get(TokenService).signLocal(who.id, 'STAFF');
  return request(app.getHttpServer())
    .get(`/api/v1/business/clients/${clientId}/services`)
    .set('x-business-id', firms[firm])
    .set('authorization', `Bearer ${token}`);
}
const ok = async (clientId: string, who: Person) => {
  const res = await services(clientId, who);
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return ClientServiceList.parse(res.body).items;
};

beforeAll(async () => {
  await runInScope(db, { kind: 'platform' }, async (tx) => {
    await tx.user.createMany({
      data: Object.entries(people).map(([key, p]) => ({
        ...p,
        cognitoSub: p.id,
        pool: 'STAFF' as const,
        name: `Fake R60S ${key}`,
      })),
    });
    for (const key of ['a', 'b'] as const) {
      const slug = `r60s-${key}-${run}`;
      firms[key] = (
        await tx.business.create({
          data: { slug, name: slug, status: 'ACTIVE' },
          select: { id: true },
        })
      ).id;
    }
  });
  for (const [k, userId, role] of [
    ['a', people.ownerA.id, 'OWNER'],
    ['a', people.staffA.id, 'STAFF'],
    ['a', people.staffA2.id, 'STAFF'],
    ['b', people.ownerB.id, 'OWNER'],
  ] as const) {
    await inFirm(k, (tx) =>
      tx.membership.create({ data: { businessId: firms[k], userId, role, status: 'ACTIVE' } }),
    );
  }
  await inFirm('a', async (tx) => {
    const businessId = firms.a;
    ids.c1 = (
      await tx.client.create({
        data: { businessId, displayName: 'Services One (fake)', assignedUserId: people.staffA.id },
      })
    ).id;
    const service = async (kind: ServiceKind, name: string) =>
      (await tx.service.create({ data: { businessId, kind, name } })).id;
    let at = Date.now() - 30 * DAY;
    const engage = async (serviceId: string, title: string, status = 'ACTIVE' as const) =>
      (
        await tx.engagement.create({
          data: {
            businessId,
            clientId: ids.c1,
            serviceId,
            title,
            status,
            assignedUserId: people.ownerA.id,
            createdAt: new Date((at += DAY)),
          },
        })
      ).id;
    ids.tax = await engage(await service('ANNUAL_TAX', 'Personal Tax'), 'Fake 2025 return');
    ids.books = await engage(await service('BOOKKEEPING', 'Bookkeeping'), 'Fake books');
    ids.payroll = await engage(await service('PAYROLL', 'Payroll'), 'Fake payroll');
    ids.planning = await engage(await service('TAX_PLANNING', 'Tax Planning'), 'Fake plan');
    ids.other = await engage(await service('OTHER', 'Notary'), 'Fake notary');
    ids.oldReturn = (
      await tx.taxReturn.create({
        data: {
          businessId,
          clientId: ids.c1,
          engagementId: ids.tax,
          taxYear: 2024,
          filingType: 'INDIVIDUAL',
        },
      })
    ).id;
    ids.newReturn = (
      await tx.taxReturn.create({
        data: {
          businessId,
          clientId: ids.c1,
          engagementId: ids.tax,
          taxYear: 2025,
          filingType: 'INDIVIDUAL',
        },
      })
    ).id;
    ids.profile = (
      await tx.bookkeepingProfile.create({ data: { businessId, engagementId: ids.books } })
    ).id;
    ids.payrollClient = (
      await tx.payrollClient.create({
        data: { businessId, clientId: ids.c1, engagementId: ids.payroll },
      })
    ).id;
    ids.plan = (
      await tx.taxPlan.create({
        data: { businessId, clientId: ids.c1, name: 'Fake 2026 plan', planYear: 2026 },
      })
    ).id;
    // An advisory enrollment with no engagement (Octavia's E3).
    const advisory = await tx.advisoryClient.create({ data: { businessId, clientId: ids.c1 } });
    ids.advisory = advisory.id;
    ids.workstream = (
      await tx.advisoryWorkstream.create({
        data: {
          businessId,
          advisoryClientId: advisory.id,
          serviceId: await service('BUSINESS_DEVELOPMENT', 'Growth Plan'),
          status: 'IN_PROGRESS',
        },
      })
    ).id;
  });
  await inFirm('b', async (tx) => {
    ids.b1 = (
      await tx.client.create({ data: { businessId: firms.b, displayName: 'B (fake)' } })
    ).id;
  });

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
  await nest.listen(0, '127.0.0.1');
  app = nest;
});

afterAll(async () => {
  await app.close();
  await db.$disconnect();
});

describe('GET /business/clients/{id}/services (E4)', () => {
  it("lists the client's services, newest first, each opening its module record", async () => {
    const items = await ok(ids.c1!, people.ownerA);
    expect(items.map((s) => [s.service.name, s.status, s.workspace])).toEqual([
      ['Notary', 'ACTIVE', null],
      // The client's newest tax plan.
      ['Tax Planning', 'ACTIVE', { module: 'TAX_PLANNING', id: ids.plan }],
      ['Payroll', 'ACTIVE', { module: 'PAYROLL', id: ids.payrollClient }],
      ['Bookkeeping', 'ACTIVE', { module: 'BOOKKEEPING', id: ids.profile }],
      // The engagement's newest return.
      ['Personal Tax', 'ACTIVE', { module: 'TAX_RETURNS', id: ids.newReturn }],
      // The advisory enrollment, after the engagements.
      ['Growth Plan', 'ACTIVE', { module: 'BUSINESS_ADVISORY', id: ids.advisory }],
    ]);
    expect(items[0]).toMatchObject({
      id: ids.other,
      title: 'Fake notary',
      assignedTo: { userId: people.ownerA.id },
    });
    expect(items.at(-1)).toMatchObject({ id: ids.workstream, assignedTo: null });
  });

  it("opens only the modules the member's grid lets them view", async () => {
    // Staff's default grid views Tax Returns, not Bookkeeping, Payroll, Tax Planning or Advisory.
    const items = await ok(ids.c1!, people.staffA);
    expect(items.map((s) => s.workspace?.module ?? null)).toEqual([
      null,
      null,
      null,
      null,
      'TAX_RETURNS',
      null,
    ]);
  });

  it("is 404 for a client Staff don't have, another firm's client and an unknown one", async () => {
    expect((await services(ids.c1!, people.staffA2)).status).toBe(404);
    expect((await services(ids.b1!, people.ownerA)).status).toBe(404);
    expect((await services(ids.c1!, people.ownerB, 'b')).status).toBe(404);
    expect((await services(randomUUID(), people.ownerA)).status).toBe(404);
    expect((await services('not-a-uuid', people.ownerA)).status).toBe(400);
  });
});
