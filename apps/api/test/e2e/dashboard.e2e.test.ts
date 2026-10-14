// End-to-end: R30, GET /api/v1/business/dashboard/summary (contract in
// packages/types/src/dashboard). Every number comes from the firm's own rows: firm B's clients,
// returns and money never reach firm A's numbers, and firm A's never reach firm B's. Staff get
// the numbers of the clients assigned to them. Clients are 403. Synthetic data only.
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createPrismaClient, runInScope, type TxClient } from '@firmivra/db';
import { TEST_CLIENT_OPTIONS, testDatabaseUrls } from '@firmivra/db/testing';
import { DashboardSummary } from '@firmivra/types';
import { AppModule } from '../../src/app.module.js';
import { TokenService } from '../../src/auth/token.service.js';
import { configureApp } from '../../src/configure-app.js';
import { loadEnv } from '../../src/config/env.js';

const fx = inject('fixtures');
const run = randomUUID().slice(0, 8);
const person = (key: string) => ({ id: randomUUID(), email: `r30-${key}-${run}@r30.test` });
const people = {
  ownerA: person('owner-a'),
  staffA: person('staff-a'),
  clientA: person('client-a'),
  ownerB: person('owner-b'),
};
type Person = (typeof people)[keyof typeof people];
const firms = {} as Record<'a' | 'b', { id: string; slug: string }>;
const DAY = 86_400_000;
const ago = (days: number) => new Date(Date.now() - days * DAY);
/** The firm's today and tomorrow (no settings row: America/New_York). */
const nyDay = (offset: number) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(
    new Date(Date.now() + offset * DAY),
  );

let app: INestApplication;
const db = createPrismaClient(testDatabaseUrls('test_api').owner, TEST_CLIENT_OPTIONS);
const inFirm = <T>(k: 'a' | 'b', actor: Person, work: (tx: TxClient) => Promise<T>) =>
  runInScope(db, { kind: 'business', businessId: firms[k].id, actorUserId: actor.id }, work);

async function summary(who: Person, firm: 'a' | 'b', pool: 'STAFF' | 'CLIENT' = 'STAFF') {
  const { token } = await app.get(TokenService).signLocal(who.id, pool);
  return request(app.getHttpServer())
    .get('/api/v1/business/dashboard/summary')
    .set('x-business-id', firms[firm].id)
    .set('authorization', `Bearer ${token}`);
}
const read = async (who: Person, firm: 'a' | 'b') => {
  const res = await summary(who, firm);
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return DashboardSummary.parse(res.body);
};
const day = (offset: number) => new Date(`${nyDay(offset)}T00:00:00.000Z`);

/** An OPEN invoice of `cents` for the client, with `paid` cents in cash received today. */
const billed = (
  k: 'a' | 'b',
  owner: Person,
  clientId: string,
  cents: number,
  paid: number,
  engagementId?: string,
) =>
  inFirm(k, owner, async (tx) => {
    const businessId = firms[k].id;
    const { id } = await tx.invoice.create({
      data: { businessId, clientId, engagementId, number: `INV-${randomUUID()}` },
    });
    await tx.invoiceLine.create({
      data: { businessId, invoiceId: id, description: 'Fake', unitAmountCents: cents },
    });
    await tx.invoice.update({ where: { id }, data: { status: 'OPEN', issuedAt: new Date() } });
    const cash = {
      method: 'CASH',
      amountCents: paid,
      receivedOn: day(0),
      idempotencyKey: randomUUID(),
    } as const;
    await tx.offlinePayment.create({
      data: { businessId, invoiceId: id, recordedByUserId: owner.id, ...cash },
    });
  });

let bookkeeping: string;

beforeAll(async () => {
  await runInScope(db, { kind: 'platform' }, async (tx) => {
    await tx.user.createMany({
      data: Object.entries(people).map(([key, p]) => ({
        ...p,
        cognitoSub: p.id,
        pool: key === 'clientA' ? 'CLIENT' : 'STAFF',
        name: `Fake R30 ${key}`,
      })),
    });
    for (const key of ['a', 'b'] as const) {
      const slug = `r30-${key}-${run}`;
      firms[key] = await tx.business.create({
        data: { slug, name: slug, status: 'ACTIVE' },
        select: { id: true, slug: true },
      });
    }
  });
  for (const [k, userId, role] of [
    ['a', people.ownerA.id, 'OWNER'],
    ['a', people.staffA.id, 'STAFF'],
    ['b', people.ownerB.id, 'OWNER'],
  ] as const) {
    await runInScope(db, { kind: 'business', businessId: firms[k].id }, (tx) =>
      tx.membership.create({ data: { businessId: firms[k].id, userId, role, status: 'ACTIVE' } }),
    );
  }

  // Firm A: c1 is the staff member's, c2 nobody's, c3 archived, c4 from two months ago.
  const ids = await inFirm('a', people.ownerA, async (tx) => {
    const businessId = firms.a.id;
    const client = (key: string, extra: object = {}) =>
      tx.client
        .create({ data: { businessId, displayName: `Dash ${key} (fake)`, ...extra } })
        .then((c) => c.id);
    const c1 = await client('c1', { assignedUserId: people.staffA.id });
    const c2 = await client('c2');
    await client('c3', { archivedAt: new Date() });
    await client('c4', { createdAt: ago(62) });
    const { email, id: userId } = people.clientA;
    await tx.clientAccount.create({
      data: { businessId, userId, email, clientId: c1, status: 'ACTIVE' },
    });
    const ret = (clientId: string, extra: object = {}) =>
      tx.taxReturn.create({
        data: { businessId, clientId, taxYear: 2025, filingType: 'INDIVIDUAL', ...extra },
      });
    await ret(c1);
    await ret(c2, { createdAt: ago(10) });
    const filed = await ret(c2);
    await tx.taxReturn.update({
      where: { id: filed.id },
      data: { status: 'FILED', filedOn: day(0) },
    });
    const service = await tx.service.create({
      data: { businessId, kind: 'BOOKKEEPING', name: 'Bookkeeping' },
    });
    bookkeeping = service.id;
    const engagement = await tx.engagement.create({
      data: { businessId, clientId: c2, serviceId: service.id, title: 'Bookkeeping (fake)' },
    });
    await tx.appointment.create({
      data: {
        businessId,
        clientId: c1,
        staffUserId: people.ownerA.id,
        startsAt: new Date(),
        endsAt: new Date(Date.now() + 60_000),
        locationKind: 'PHONE',
      },
    });
    await tx.task.createMany({
      data: [
        { businessId, clientId: c1, title: 'Fake task tomorrow', dueOn: day(1) },
        { businessId, clientId: c2, title: 'Fake task today', dueOn: day(0) },
        { businessId, clientId: c2, title: 'Fake task undated' },
      ],
    });
    return { c1, c2, engagement: engagement.id };
  });
  await billed('a', people.ownerA, ids.c2, 50_000, 20_000, ids.engagement);
  await billed('a', people.ownerA, ids.c1, 10_000, 4_000);

  // Firm B: one client, one return in progress, and more money than firm A.
  const cB = await inFirm('b', people.ownerB, async (tx) => {
    const businessId = firms.b.id;
    const c = await tx.client.create({ data: { businessId, displayName: 'Dash B (fake)' } });
    await tx.taxReturn.create({
      data: { businessId, clientId: c.id, taxYear: 2025, filingType: 'BUSINESS' },
    });
    return c.id;
  });
  await billed('b', people.ownerB, cB, 200_000, 99_900);

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

describe('GET /business/dashboard/summary', () => {
  it("gives the Owner the firm's numbers, each with the period before where history keeps it", async () => {
    const s = await read(people.ownerA, 'a');
    expect(s.today).toBe(nyDay(0));
    expect(s.kpis).toEqual({
      totalClients: { value: 3, previous: 1 },
      newLeads: { value: 0, previous: 0 },
      returnsInProgress: { value: 2, previous: 1 },
      completedReturns: { value: 1, previous: 0 },
      outstandingInvoicesCents: { value: 36_000, previous: null },
      appointmentsToday: { value: 1, previous: null },
    });
    expect(s.pipeline).toEqual({
      leads: 0,
      consultation: null,
      intake: 0,
      inProgress: 2,
      completed: 1,
    });
  });

  it("adds up this year's money by month and by service", async () => {
    const { revenue, today } = await read(people.ownerA, 'a');
    const month = Number(today.slice(5, 7)) - 1;
    expect(revenue.year).toBe(Number(today.slice(0, 4)));
    expect(revenue.totalCents).toBe(24_000);
    expect(revenue.byMonthCents[month]).toBe(24_000);
    expect(revenue.byMonthCents.filter((c) => c !== 0)).toHaveLength(1);
    expect(revenue.byService).toEqual([
      { serviceId: bookkeeping, name: 'Bookkeeping', cents: 20_000 },
      { serviceId: null, name: null, cents: 4_000 },
    ]);
  });

  it('lists open tasks with a due date, soonest first', async () => {
    const { tasksDue } = await read(people.ownerA, 'a');
    expect(tasksDue.map((t) => [t.title, t.dueOn])).toEqual([
      ['Fake task today', nyDay(0)],
      ['Fake task tomorrow', nyDay(1)],
    ]);
  });

  it('gives Staff the numbers of the clients assigned to them only', async () => {
    const s = await read(people.staffA, 'a');
    expect(s.kpis.totalClients).toEqual({ value: 1, previous: 0 });
    expect(s.kpis.returnsInProgress).toEqual({ value: 1, previous: 0 });
    expect(s.kpis.completedReturns.value).toBe(0);
    expect(s.kpis.outstandingInvoicesCents.value).toBe(6_000);
    expect(s.kpis.appointmentsToday.value).toBe(1);
    expect(s.revenue.totalCents).toBe(4_000);
    expect(s.tasksDue.map((t) => t.title)).toEqual(['Fake task tomorrow']);
  });

  it("a firm only ever sees its own numbers; another firm's id is 404", async () => {
    const b = await read(people.ownerB, 'b');
    expect(b.kpis.totalClients.value).toBe(1);
    expect(b.kpis.returnsInProgress.value).toBe(1);
    expect(b.kpis.completedReturns.value).toBe(0);
    expect(b.kpis.outstandingInvoicesCents.value).toBe(100_100);
    expect(b.kpis.appointmentsToday.value).toBe(0);
    expect(b.revenue.totalCents).toBe(99_900);
    expect(b.revenue.byService).toEqual([{ serviceId: null, name: null, cents: 99_900 }]);
    expect(b.tasksDue).toEqual([]);
    expect((await summary(people.ownerB, 'a')).status).toBe(404);
    expect((await summary(people.ownerA, 'b')).status).toBe(404);
  });

  it('refuses a client (403) and audits each view without numbers', async () => {
    expect((await summary(people.clientA, 'a', 'CLIENT')).status).toBe(403);
    const rows = await inFirm('a', people.ownerA, (tx) =>
      tx.auditLog.findMany({ where: { businessId: firms.a.id, action: 'dashboard.viewed' } }),
    );
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.metadata === null)).toBe(true);
  });
});
