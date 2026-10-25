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

async function summary(
  who: Person,
  firm: 'a' | 'b',
  pool: 'STAFF' | 'CLIENT' = 'STAFF',
  query = '',
) {
  const { token } = await app.get(TokenService).signLocal(who.id, pool);
  return request(app.getHttpServer())
    .get(`/api/v1/business/dashboard/summary${query}`)
    .set('x-business-id', firms[firm].id)
    .set('authorization', `Bearer ${token}`);
}
const read = async (who: Person, firm: 'a' | 'b', query = '') => {
  const res = await summary(who, firm, 'STAFF', query);
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
    // Accepted this month (K5): the database keeps the client status and the history with it.
    await tx.taxReturn.update({
      where: { id: filed.id },
      data: { workflowStatus: 'ACCEPTED', filedOn: day(0) },
    });
    const service = await tx.service.create({
      data: { businessId, kind: 'BOOKKEEPING', name: 'Bookkeeping' },
    });
    bookkeeping = service.id;
    // New Leads (K3): still at New Lead and in this month; a later stage and an archived lead are
    // left out. (The database sets created_at, so no lead of last month can be seeded here.)
    const lead = (key: string, extra: object) =>
      tx.lead.create({
        data: {
          businessId,
          serviceId: service.id,
          firstName: 'Dash',
          lastName: `Lead ${key} (fake)`,
          email: `dash-${key}-${firms.a.id.slice(0, 8)}@lead.test`,
          ...extra,
        },
      });
    const sent = { submittedAt: new Date() };
    await lead('new', { status: 'SUBMITTED', ...sent });
    await lead('review', { status: 'IN_REVIEW', ...sent });
    await lead('archived', {
      status: 'SUBMITTED',
      ...sent,
      archivedAt: new Date(),
      archivedByUserId: people.ownerA.id,
    });
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
        { businessId, clientId: c2, title: 'Fake task today', dueOn: day(0), priority: 'HIGH' },
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
      newLeads: { value: 1, previous: 0 },
      // The return made 10 days ago did not exist on the same day last month.
      returnsInProgress: { value: 2, previous: 0 },
      acceptedReturns: { value: 1, previous: 0 },
      outstandingInvoicesCents: { value: 36_000, previous: null },
      appointmentsToday: { value: 1, previous: null },
    });
    expect(s.range).toEqual({
      period: 'THIS_MONTH',
      from: `${s.today.slice(0, 8)}01`,
      to: s.today,
      previousFrom: expect.stringMatching(/-01$/) as string,
      previousTo: expect.any(String) as string,
    });
    expect(s.pipeline).toEqual({
      // The New Lead and In Review leads; an archived one is not in the pipeline.
      leads: 2,
      consultation: null,
      intake: 0,
      inProgress: 2,
      completed: 1,
      period: 'THIS_MONTH',
      from: s.range.from,
      to: s.today,
    });
  });

  it("adds up this year's money by month and by service", async () => {
    const { revenue, today } = await read(people.ownerA, 'a');
    const month = Number(today.slice(5, 7)) - 1;
    expect(revenue).toMatchObject({
      period: 'YEAR',
      from: `${today.slice(0, 4)}-01-01`,
      to: today,
    });
    expect(revenue.totalCents).toBe(24_000);
    expect(revenue.buckets).toHaveLength(12);
    expect(revenue.buckets[month]?.cents).toBe(24_000);
    expect(revenue.buckets.filter((b) => b.cents !== 0)).toHaveLength(1);
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
    expect(s.kpis.acceptedReturns.value).toBe(0);
    expect(s.kpis.newLeads).toEqual({ value: 0, previous: 0 });
    expect(s.kpis.outstandingInvoicesCents.value).toBe(6_000);
    expect(s.kpis.appointmentsToday.value).toBe(1);
    expect(s.revenue.totalCents).toBe(4_000);
    expect(s.tasksDue.map((t) => t.title)).toEqual(['Fake task tomorrow']);
  });

  it("a firm only ever sees its own numbers; another firm's id is 404", async () => {
    const b = await read(people.ownerB, 'b');
    expect(b.kpis.totalClients.value).toBe(1);
    expect(b.kpis.returnsInProgress.value).toBe(1);
    expect(b.kpis.acceptedReturns.value).toBe(0);
    expect(b.kpis.newLeads.value).toBe(0);
    expect(b.kpis.outstandingInvoicesCents.value).toBe(100_100);
    expect(b.kpis.appointmentsToday.value).toBe(0);
    expect(b.revenue.totalCents).toBe(99_900);
    expect(b.revenue.byService).toEqual([{ serviceId: null, name: null, cents: 99_900 }]);
    expect(b.tasksDue).toEqual([]);
    expect((await summary(people.ownerB, 'a')).status).toBe(404);
    expect((await summary(people.ownerA, 'b')).status).toBe(404);
  });

  // R1: the design's selectors, task priority, last year and the tax season.
  it("counts the pipeline's Completed for the chosen period", async () => {
    const year = await read(people.ownerA, 'a', '?pipelinePeriod=THIS_YEAR');
    expect(year.pipeline).toMatchObject({ completed: 1, period: 'THIS_YEAR' });
    const last = await read(people.ownerA, 'a', '?pipelinePeriod=LAST_MONTH');
    expect(last.pipeline).toMatchObject({ completed: 0, period: 'LAST_MONTH' });
    const today = await read(people.ownerA, 'a', '?pipelinePeriod=TODAY');
    expect(today.pipeline).toMatchObject({ completed: 1, from: today.today, to: today.today });
    const custom = await read(
      people.ownerA,
      'a',
      `?pipelinePeriod=CUSTOM&pipelineFrom=${nyDay(-3)}&pipelineTo=${nyDay(-1)}`,
    );
    expect(custom.pipeline).toMatchObject({ completed: 0, from: nyDay(-3), to: nyDay(-1) });
    expect((await summary(people.ownerA, 'a', 'STAFF', '?pipelinePeriod=NEXT_YEAR')).status).toBe(
      400,
    );
  });

  // Octavia's review of Oct 25: C1 (the global period) and K8 (each card's period before).
  it('counts the cards for the global period and its equivalent period before', async () => {
    const today = await read(people.ownerA, 'a', '?period=TODAY');
    expect(today.range).toMatchObject({
      from: today.today,
      to: today.today,
      previousTo: nyDay(-1),
    });
    expect(today.kpis.acceptedReturns).toEqual({ value: 1, previous: 0 });
    expect(today.kpis.newLeads).toEqual({ value: 1, previous: 0 });
    expect(today.kpis.totalClients).toEqual({ value: 3, previous: 1 });
    const lastMonth = await read(people.ownerA, 'a', '?period=LAST_MONTH');
    // Nothing was accepted last month; the cards that never follow the period stay as they are.
    expect(lastMonth.kpis.acceptedReturns.value).toBe(0);
    expect(lastMonth.kpis.newLeads.value).toBe(0);
    expect(lastMonth.kpis.totalClients.value).toBe(1);
    expect(lastMonth.kpis.outstandingInvoicesCents).toEqual({ value: 36_000, previous: null });
    expect(lastMonth.kpis.appointmentsToday).toEqual({ value: 1, previous: null });
    const custom = await read(
      people.ownerA,
      'a',
      `?period=CUSTOM&from=${nyDay(-11)}&to=${nyDay(0)}`,
    );
    expect(custom.range).toMatchObject({
      period: 'CUSTOM',
      from: nyDay(-11),
      to: nyDay(0),
      previousFrom: nyDay(-23),
      previousTo: nyDay(-12),
    });
    expect(custom.kpis.returnsInProgress).toEqual({ value: 2, previous: 0 });
  });

  it('refuses a Custom period without both days, ending after today or backwards', async () => {
    for (const query of [
      '?period=CUSTOM',
      `?period=CUSTOM&from=${nyDay(-2)}`,
      `?period=CUSTOM&from=${nyDay(-1)}&to=${nyDay(1)}`,
      `?period=CUSTOM&from=${nyDay(-1)}&to=${nyDay(-3)}`,
      `?period=THIS_MONTH&from=${nyDay(-1)}`,
      `?revenuePeriod=CUSTOM&revenueFrom=${nyDay(-1)}&revenueTo=${nyDay(2)}`,
      '?revenuePeriod=MONTH&revenueYear=2024',
    ]) {
      const res = await summary(people.ownerA, 'a', 'STAFF', query);
      expect([query, res.status]).toEqual([query, 400]);
      expect((res.body as { error: { code: string } }).error.code).toBe('VALIDATION_FAILED');
    }
  });

  it('gives Revenue Overview by month, quarter, year or Custom days, with the span before', async () => {
    const now = await read(people.ownerA, 'a');
    // No money before this year: nothing to compare with.
    expect(now.revenue.previousCents).toBeNull();
    const month = await read(people.ownerA, 'a', '?revenuePeriod=MONTH');
    expect(month.revenue.buckets).toHaveLength(Number(now.today.slice(8)));
    expect(month.revenue.buckets.at(-1)).toEqual({ from: now.today, to: now.today, cents: 24_000 });
    expect(month.revenue.totalCents).toBe(24_000);
    const quarter = await read(people.ownerA, 'a', '?revenuePeriod=QUARTER');
    expect(quarter.revenue.buckets.length).toBeLessThanOrEqual(3);
    expect(quarter.revenue.buckets.at(-1)?.cents).toBe(24_000);
    const custom = await read(
      people.ownerA,
      'a',
      `?revenuePeriod=CUSTOM&revenueFrom=${nyDay(-2)}&revenueTo=${nyDay(-1)}`,
    );
    expect(custom.revenue).toMatchObject({ totalCents: 0, previousCents: null });
    expect(custom.revenue.buckets).toHaveLength(2);
    const lastYear = Number(now.today.slice(0, 4)) - 1;
    const past = await read(people.ownerA, 'a', `?revenueYear=${lastYear}`);
    expect(past.revenue).toMatchObject({
      from: `${lastYear}-01-01`,
      to: `${lastYear}-12-31`,
      totalCents: 0,
      previousCents: null,
    });
    expect(past.revenue.buckets.every((b) => b.cents === 0)).toBe(true);
    const future = await summary(people.ownerA, 'a', 'STAFF', `?revenueYear=${lastYear + 2}`);
    expect(future.status).toBe(400);
    expect((future.body as { error: { code: string } }).error.code).toBe('VALIDATION_FAILED');
  });

  it("gives each due task its priority, and no tax season until the firm's settings hold one", async () => {
    const s = await read(people.ownerA, 'a');
    expect(s.tasksDue.map((t) => [t.title, t.priority])).toEqual([
      ['Fake task today', 'HIGH'],
      ['Fake task tomorrow', 'MEDIUM'],
    ]);
    expect(s.taxSeason).toBeNull();
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
