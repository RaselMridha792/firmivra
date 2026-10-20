// End-to-end: R0, the Business Advisory Reports tab (GET /business/advisory/reports; contract in
// packages/types/src/advisory): live counts over the advisory clients the caller reaches, by
// status, services, action items, meetings and each advisor's workload, and the yearly trend of
// the current figures for whoever may view them. Archived clients are left out; Staff count only
// their own clients; firm B sees none of firm A's. A read: it writes no audit row.
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request, { type Response } from 'supertest';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createPrismaClient, runInScope } from '@firmivra/db';
import { TEST_CLIENT_OPTIONS, testDatabaseUrls } from '@firmivra/db/testing';
import { AdvisoryClientDetail, AdvisoryPlanDetail, AdvisoryReports } from '@firmivra/types';
import { AppModule } from '../../src/app.module.js';
import { configureApp } from '../../src/configure-app.js';
import { loadEnv } from '../../src/config/env.js';

const fx = inject('fixtures');
const run = randomUUID().slice(0, 8);
const person = (key: string) => ({ id: randomUUID(), email: `r0rep-${key}-${run}@r0.test` });
const people = {
  ownerA: person('owner-a'),
  staffA: person('staff-a'),
  preparerA: person('preparer-a'),
  ownerB: person('owner-b'),
};
type Who = (typeof people)[keyof typeof people];
const { ownerA, staffA, preparerA, ownerB } = people;
const firms = {} as Record<'a' | 'b', string>;
const clients = {} as Record<'c1' | 'c2' | 'c3' | 'cB', string>;
const services = {} as Record<'s1' | 's2' | 'sB', string>;
const adv = {} as Record<'a1' | 'a2' | 'a3' | 'aB', string>;

let app: INestApplication;
const tokens = new Map<string, string>();
let viewers = 0;
const viewer = () => `198.59.${100 + Math.floor(++viewers / 250)}.${viewers % 250}, 10.0.0.6`;

const DAY = 86_400_000;
const day = (offset: number) => new Date(Date.now() + offset * DAY).toISOString().slice(0, 10);
/** The firm's year (the firm has no time zone set: New York). */
const YEAR = Number(
  new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric' }).format(
    new Date(),
  ),
);

async function asOwner<T>(
  scope: Parameters<typeof runInScope>[1],
  work: Parameters<typeof runInScope<T>>[2],
): Promise<T> {
  const owner = createPrismaClient(testDatabaseUrls('test_api').owner, TEST_CLIENT_OPTIONS);
  try {
    return await runInScope(owner, scope, work);
  } finally {
    await owner.$disconnect();
  }
}
const inFirm = <T>(firm: 'a' | 'b', work: Parameters<typeof runInScope<T>>[2]) =>
  asOwner({ kind: 'business', businessId: firms[firm] }, work);

async function tokenFor(email: string): Promise<string> {
  const cached = tokens.get(email);
  if (cached) return cached;
  const res = await request(app.getHttpServer())
    .post('/api/v1/dev/token')
    .set('x-forwarded-for', viewer())
    .send({ email })
    .expect(200);
  const token = (res.body as { token: string }).token;
  tokens.set(email, token);
  return token;
}
async function call(
  method: 'get' | 'post' | 'patch',
  path: string,
  who: Who | undefined,
  body?: object,
  firm: 'a' | 'b' = 'a',
): Promise<Response> {
  let req = request(app.getHttpServer())
    [method](`/api/v1/business/advisory${path}`)
    .set('x-business-id', firms[firm])
    .set('x-forwarded-for', viewer());
  if (who) req = req.set('authorization', `Bearer ${await tokenFor(who.email)}`);
  return body === undefined ? req : req.send(body);
}
const ok = (res: Response, status = 200) => {
  expect(res.status, JSON.stringify(res.body)).toBe(status);
  return res.body as unknown;
};
const reports = async (who: Who, query = '', firm: 'a' | 'b' = 'a') =>
  AdvisoryReports.parse(ok(await call('get', `/reports${query}`, who, undefined, firm)));
const count = <T extends { status: string; count: number }>(rows: T[], status: string) =>
  rows.find((r) => r.status === status)?.count ?? 0;

beforeAll(async () => {
  await asOwner({ kind: 'platform' }, async (tx) => {
    for (const [key, p] of Object.entries(people)) {
      await tx.user.create({
        data: { id: p.id, cognitoSub: p.id, pool: 'STAFF', email: p.email, name: `Fake R0 ${key}` },
      });
    }
    for (const key of ['a', 'b'] as const) {
      const slug = `r0rep-${key}-${run}`;
      firms[key] = (
        await tx.business.create({
          data: { slug, name: `Firm ${slug}`, status: 'ACTIVE' },
          select: { id: true },
        })
      ).id;
    }
  });
  for (const [firm, userId, role] of [
    ['a', ownerA.id, 'OWNER'],
    ['a', staffA.id, 'STAFF'],
    ['a', preparerA.id, 'TAX_PREPARER'],
    ['b', ownerB.id, 'OWNER'],
  ] as const) {
    await inFirm(firm, (tx) =>
      tx.membership.create({ data: { businessId: firms[firm], userId, role, status: 'ACTIVE' } }),
    );
  }
  await inFirm('a', async (tx) => {
    const businessId = firms.a;
    for (const [key, name] of [
      ['s1', 'Business Planning'],
      ['s2', 'Funding Readiness'],
    ] as const) {
      services[key] = (
        await tx.service.create({
          data: {
            businessId,
            kind: 'BUSINESS_DEVELOPMENT',
            name: `${name} ${run}`,
            status: 'ACTIVE',
          },
          select: { id: true },
        })
      ).id;
    }
    for (const [key, name, over] of [
      ['c1', 'Jamie Sample (fake)', { assignedUserId: staffA.id }],
      ['c2', 'Riley Example (fake)', {}],
      ['c3', 'Casey Archived (fake)', {}],
    ] as const) {
      clients[key] = (
        await tx.client.create({
          data: { businessId, displayName: name, email: `${key}-${run}@client.test`, ...over },
          select: { id: true },
        })
      ).id;
    }
    // Advisory meetings: one in 3 days, one 10 days ago, one cancelled, one beyond 30 days.
    const meeting = (clientId: string, serviceId: string, offsetDays: number, extra: object = {}) =>
      tx.appointment.create({
        data: {
          businessId,
          clientId,
          serviceId,
          staffUserId: ownerA.id,
          startsAt: new Date(Date.now() + offsetDays * DAY),
          endsAt: new Date(Date.now() + offsetDays * DAY + 3_600_000),
          locationKind: 'VIDEO',
          locationDetails: 'https://meet.example.test/fake',
          ...extra,
        },
      });
    await meeting(clients.c1, services.s1, 3);
    await meeting(clients.c1, services.s1, -10);
    await meeting(clients.c2, services.s2, 5, { status: 'CANCELLED', cancelledAt: new Date() });
    await meeting(clients.c2, services.s2, 40);
  });
  await inFirm('b', async (tx) => {
    clients.cB = (
      await tx.client.create({
        data: { businessId: firms.b, displayName: 'Firm B Client (fake)' },
        select: { id: true },
      })
    ).id;
    services.sB = (
      await tx.service.create({
        data: { businessId: firms.b, kind: 'BUSINESS_DEVELOPMENT', name: `Firm B advisory ${run}` },
        select: { id: true },
      })
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

  // The program, through the API: two live clients and one archived.
  const addClient = async (clientId: string, body: object, firm: 'a' | 'b' = 'a') =>
    AdvisoryClientDetail.parse(
      ok(
        await call('post', '/clients', firm === 'a' ? ownerA : ownerB, { clientId, ...body }, firm),
        201,
      ),
    ).id;
  adv.a1 = await addClient(clients.c1, {
    primaryServiceId: services.s1,
    additionalServiceIds: [services.s2],
    advisorUserId: staffA.id,
  });
  adv.a2 = await addClient(clients.c2, {
    primaryServiceId: services.s2,
    advisorUserId: ownerA.id,
  });
  adv.a3 = await addClient(clients.c3, { primaryServiceId: services.s1 });
  ok(await call('post', `/clients/${adv.a3}/archive`, ownerA, {}));
  adv.aB = await addClient(clients.cB, { primaryServiceId: services.sB }, 'b');

  // a1: a plan with a goal and figures (corrected once), finalized and delivered.
  const plan = async (id: string) =>
    AdvisoryPlanDetail.parse(ok(await call('get', `/plans/${id}`, ownerA)));
  const p1 = AdvisoryPlanDetail.parse(
    ok(
      await call('post', '/plans', ownerA, {
        advisoryClientId: adv.a1,
        name: `Growth plan ${run}`,
        targetYear: YEAR,
        profile: { businessName: 'Jamie Sample Co (fake)' },
      }),
      201,
    ),
  );
  ok(
    await call('patch', `/plans/${p1.id}`, ownerA, {
      etag: (await plan(p1.id)).etag,
      strategy: { summary: 'Grow by referrals (fake)' },
    }),
  );
  const goal = (body: object) => call('post', '/goals', ownerA, body);
  ok(
    await goal({
      advisoryClientId: adv.a1,
      planId: p1.id,
      title: 'Grow revenue (fake)',
      status: 'ON_TRACK',
      progressPercent: 40,
      targetDate: day(90),
    }),
    201,
  );
  const figures = (revenueCents: number, expensesCents: number) =>
    call('post', `/clients/${adv.a1}/financials`, ownerA, {
      periodStart: `${YEAR - 1}-01-01`,
      periodEnd: `${YEAR - 1}-12-31`,
      revenueCents,
      expensesCents,
      asOf: day(-5),
    });
  ok(await figures(50_000_000, 40_000_000), 201);
  ok(await figures(60_000_000, 45_000_000), 201);
  ok(await call('post', `/plans/${p1.id}/finalize`, ownerA, { etag: (await plan(p1.id)).etag }));
  ok(await call('post', `/plans/${p1.id}/send`, ownerA, { channel: 'DOWNLOAD' }));

  // a2: a draft plan, an overdue goal and a completed one.
  ok(
    await call('post', '/plans', ownerA, {
      advisoryClientId: adv.a2,
      name: `Funding plan ${run}`,
      targetYear: YEAR,
    }),
    201,
  );
  ok(
    await goal({
      advisoryClientId: adv.a2,
      title: 'Apply for a loan (fake)',
      status: 'IN_PROGRESS',
      progressPercent: 20,
      targetDate: day(-10),
    }),
    201,
  );
  ok(
    await goal({
      advisoryClientId: adv.a2,
      title: 'Open an account (fake)',
      status: 'COMPLETED',
      progressPercent: 100,
    }),
    201,
  );

  // Recommendations: one implemented with its impact, one proposed.
  const rec = (await call('post', '/recommendations', ownerA, {
    advisoryClientId: adv.a1,
    title: 'Section 179 (fake)',
    impactCents: 4_500_000,
  })) as Response;
  const recId = (ok(rec, 201) as { id: string }).id;
  ok(await call('patch', `/recommendations/${recId}`, ownerA, { status: 'IMPLEMENTED' }));
  ok(
    await call('post', '/recommendations', ownerA, {
      advisoryClientId: adv.a2,
      title: 'Refinance (fake)',
    }),
    201,
  );

  // Action items: an overdue staff one, an open client one, a team one done.
  ok(
    await call('post', '/action-items', ownerA, {
      advisoryClientId: adv.a1,
      title: 'Prepare the application (fake)',
      assigneeKind: 'STAFF',
      assigneeUserId: staffA.id,
      dueOn: day(-3),
    }),
    201,
  );
  ok(
    await call('post', '/action-items', ownerA, {
      advisoryClientId: adv.a2,
      title: 'Send the quotes (fake)',
      assigneeKind: 'CLIENT',
      dueOn: day(10),
    }),
    201,
  );
  const team = ok(
    await call('post', '/action-items', ownerA, {
      advisoryClientId: adv.a1,
      title: 'Kick-off (fake)',
      assigneeKind: 'TEAM',
    }),
    201,
  ) as { id: string };
  ok(await call('patch', `/action-items/${team.id}`, ownerA, { status: 'DONE' }));
}, 120_000);

afterAll(async () => {
  await app.close();
});

describe('advisory reports', () => {
  it('counts the firm’s live advisory clients, plans, services, goals, recommendations and tasks', async () => {
    const r = await reports(ownerA);
    expect(r.clients.total).toBe(2);
    expect(r.clients.byStatus.reduce((n, x) => n + x.count, 0)).toBe(2);
    expect(r.plans.total).toBe(2);
    expect(count(r.plans.byStatus, 'SENT')).toBe(1);
    expect(count(r.plans.byStatus, 'DRAFT')).toBe(1);
    expect(r.plans.sentThisYear).toBe(1);
    // The archived client's service is not counted.
    expect(r.services).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ serviceId: services.s1, primary: 1, additional: 0 }),
        expect.objectContaining({ serviceId: services.s2, primary: 1, additional: 1 }),
      ]),
    );
    expect(r.services).toHaveLength(2);
    expect(r.goals.total).toBe(3);
    expect(count(r.goals.byStatus, 'OVERDUE')).toBe(1);
    expect(count(r.goals.byStatus, 'ON_TRACK')).toBe(1);
    expect(count(r.goals.byStatus, 'COMPLETED')).toBe(1);
    expect(r.goals.averageProgress).toBe(30);
    expect(r.recommendations.total).toBe(2);
    expect(count(r.recommendations.byStatus, 'IMPLEMENTED')).toBe(1);
    expect(r.recommendations.implementedImpactCents).toBe(4_500_000);
    expect(r.actionItems).toMatchObject({ open: 2, overdue: 1, doneLast30Days: 1 });
    expect(r.actionItems.byAssignee).toEqual([
      { kind: 'STAFF', open: 1 },
      { kind: 'CLIENT', open: 1 },
      { kind: 'TEAM', open: 0 },
    ]);
    // The cancelled meeting and the one beyond 30 days are not counted.
    expect(r.meetings).toEqual({ upcoming30Days: 1, past90Days: 1 });
    expect(r.disclaimer.length).toBeGreaterThan(0);
  });

  it('shows the trend of the current figures, and each advisor’s workload', async () => {
    const r = await reports(ownerA);
    expect(r.canViewFinancials).toBe(true);
    expect(r.financialTrend?.map((y) => y.year)).toEqual([YEAR - 3, YEAR - 2, YEAR - 1]);
    // The corrected row replaces the first one for the same period.
    expect(r.financialTrend?.[2]).toEqual({
      year: YEAR - 1,
      clients: 1,
      revenueCents: 60_000_000,
      expensesCents: 45_000_000,
      netProfitCents: 15_000_000,
    });
    expect(r.financialTrend?.[0]).toMatchObject({ clients: 0, revenueCents: null });
    expect(r.advisorWorkload).toEqual(
      expect.arrayContaining([
        {
          advisor: { userId: staffA.id, name: 'Fake R0 staffA' },
          clients: 1,
          activePlans: 1,
          openGoals: 1,
          openActionItems: 1,
          upcomingMeetings: 1,
        },
        {
          advisor: { userId: ownerA.id, name: 'Fake R0 ownerA' },
          clients: 1,
          activePlans: 1,
          openGoals: 1,
          openActionItems: 1,
          upcomingMeetings: 0,
        },
      ]),
    );
  });

  it('narrows to one advisor, and Staff count only their own clients', async () => {
    const mine = await reports(ownerA, `?advisorUserId=${staffA.id}`);
    expect(mine.clients.total).toBe(1);
    expect(mine.plans.total).toBe(1);
    expect(mine.advisorWorkload).toHaveLength(1);
    const staff = await reports(staffA);
    expect(staff.clients.total).toBe(1);
    expect(staff.actionItems.overdue).toBe(1);
    expect(staff.meetings.upcoming30Days).toBe(1);
  });

  it('leaves the figures out for a role without "View financial analysis"', async () => {
    const r = await reports(preparerA);
    expect(r.canViewFinancials).toBe(false);
    expect(r.financialTrend).toBeNull();
  });

  it('shows firm B none of firm A’s records', async () => {
    const r = await reports(ownerB, '', 'b');
    expect(r.clients.total).toBe(1);
    expect(r.services.map((s) => s.serviceId)).toEqual([services.sB]);
    const body = JSON.stringify(r);
    for (const id of [services.s1, services.s2, staffA.id, ownerA.id])
      expect(body).not.toContain(id);
    // Firm A's member cannot read firm B's report.
    expect((await call('get', '/reports', ownerA, undefined, 'b')).status).toBe(404);
  });

  it('refuses a bad advisor id and a signed-out caller, and writes no audit row', async () => {
    expect((await call('get', '/reports?advisorUserId=me', ownerA)).status).toBe(400);
    expect((await call('get', '/reports', undefined)).status).toBe(401);
    // Firm A's rows only: other suites write audit rows of their own firms at the same time.
    const audits = () => inFirm('a', (tx) => tx.auditLog.count({ where: { businessId: firms.a } }));
    const before = await audits();
    await reports(ownerA);
    expect(await audits()).toBe(before);
  });
});
