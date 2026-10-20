// End-to-end: R55, Business Advisory & Development (contract in packages/types/src/advisory): the
// program's clients and their services, business plans in five stages with immutable versions and
// delivery, financial snapshots with overrides, the explainable Business Health Score, goals and
// milestones, recommendations and action items, meetings, the resource library and the settings.
// Staff reach only the clients assigned to them; firm B sees none of firm A's. Nothing in an audit
// row holds a figure or a note.
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request, { type Response } from 'supertest';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createPrismaClient, runInScope } from '@firmivra/db';
import { TEST_CLIENT_OPTIONS, testDatabaseUrls } from '@firmivra/db/testing';
import {
  AdvisoryActionItemPage,
  AdvisoryActionItemRow,
  AdvisoryActivityPage,
  AdvisoryClientDetail,
  AdvisoryClientPage,
  AdvisoryClientRow,
  AdvisoryFinancialPage,
  AdvisoryFinancialRow,
  AdvisoryGoalDetail,
  AdvisoryGoalPage,
  AdvisoryMeetingPage,
  AdvisoryMilestone,
  AdvisoryOverview,
  AdvisoryPlanDetail,
  AdvisoryPlanPage,
  AdvisoryRecommendationPage,
  AdvisoryRecommendationRow,
  AdvisoryResourceList,
  AdvisoryServiceOptionList,
  AdvisorySettingsView,
  AdvisoryVersionDetail,
  AdvisoryVersionList,
  AdvisoryWorkstream,
  OkResponse,
} from '@firmivra/types';
import { AppModule } from '../../src/app.module.js';
import { configureApp } from '../../src/configure-app.js';
import { loadEnv } from '../../src/config/env.js';

const fx = inject('fixtures');
const run = randomUUID().slice(0, 8);
const person = (key: string) => ({ id: randomUUID(), email: `r55a-${key}-${run}@r55.test` });
const people = {
  ownerA: person('owner-a'),
  adminA: person('admin-a'),
  staffA: person('staff-a'),
  preparerA: person('preparer-a'),
  ownerB: person('owner-b'),
};
type Who = (typeof people)[keyof typeof people];
const firms = {} as Record<'a' | 'b', string>;
const clients = {} as Record<'c1' | 'c2' | 'c3' | 'c4' | 'cB', string>;
const services = {} as Record<'s1' | 's2' | 's3' | 'books' | 'sB', string>;

let app: INestApplication;
const tokens = new Map<string, string>();
let viewers = 0;
const viewer = () => `198.58.${100 + Math.floor(++viewers / 250)}.${viewers % 250}, 10.0.0.5`;

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

type Method = 'get' | 'post' | 'patch' | 'put' | 'delete';
async function call(
  method: Method,
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
const codeOf = (res: Response) => (res.body as { error?: { code: string } }).error?.code;
const expectError = (res: Response, status: number, code: string) =>
  expect([res.status, codeOf(res)], JSON.stringify(res.body)).toEqual([status, code]);
const ok = (res: Response, status = 200) => {
  expect(res.status, JSON.stringify(res.body)).toBe(status);
  return res.body as unknown;
};
const mark = (what: string) => `${what} ${run} ${randomUUID().slice(0, 6)}`;
const { ownerA, adminA, staffA, preparerA, ownerB } = people;

const DAY = 86_400_000;
const day = (offset: number) => new Date(Date.now() + offset * DAY).toISOString().slice(0, 10);
/** The firm’s day (the firm has no time zone set: New York), for dates the server works out. */
const firmDay = (offset = 0) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(
    new Date(Date.now() + offset * DAY),
  );

const auditRows = (entityId: string) =>
  inFirm('a', (tx) =>
    tx.auditLog.findMany({
      where: { entityId },
      select: { action: true, metadata: true },
      orderBy: { createdAt: 'asc' },
    }),
  );
const auditFor = (advisoryClientId: string) =>
  inFirm('a', (tx) =>
    tx.auditLog.findMany({
      where: {
        action: { startsWith: 'advisory_' },
        metadata: { path: ['advisoryClientId'], equals: advisoryClientId },
      },
      select: { action: true, metadata: true },
      orderBy: { createdAt: 'asc' },
    }),
  );

const advClient = async (id: string, who: Who = ownerA) =>
  AdvisoryClientDetail.parse(ok(await call('get', `/clients/${id}`, who)));
const addClient = async (clientId: string, over: object = {}, who: Who = ownerA) =>
  AdvisoryClientDetail.parse(
    ok(
      await call('post', '/clients', who, {
        clientId,
        primaryServiceId: services.s1,
        ...over,
      }),
      201,
    ),
  );
const plan = async (id: string, who: Who = ownerA) =>
  AdvisoryPlanDetail.parse(ok(await call('get', `/plans/${id}`, who)));
const createPlan = async (advisoryClientId: string, over: object = {}, who: Who = ownerA) =>
  AdvisoryPlanDetail.parse(
    ok(
      await call('post', '/plans', who, {
        advisoryClientId,
        name: mark('Plan'),
        targetYear: 2026,
        ...over,
      }),
      201,
    ),
  );
const patchPlan = async (id: string, body: object, who: Who = ownerA) =>
  call('patch', `/plans/${id}`, who, { etag: (await plan(id, who)).etag, ...body });
const goal = async (id: string, who: Who = ownerA) =>
  AdvisoryGoalDetail.parse(ok(await call('get', `/goals/${id}`, who)));
const createGoal = async (advisoryClientId: string, over: object = {}, who: Who = ownerA) =>
  AdvisoryGoalDetail.parse(
    ok(await call('post', '/goals', who, { advisoryClientId, title: mark('Goal'), ...over }), 201),
  );
const patchGoal = async (id: string, body: object, who: Who = ownerA) =>
  call('patch', `/goals/${id}`, who, { etag: (await goal(id, who)).etag, ...body });
const financial = (id: string, over: object = {}, who: Who = ownerA) =>
  call('post', `/clients/${id}/financials`, who, {
    periodStart: '2025-01-01',
    periodEnd: '2025-12-31',
    revenueCents: 1_000_000,
    asOf: day(-5),
    ...over,
  });

beforeAll(async () => {
  await asOwner({ kind: 'platform' }, async (tx) => {
    for (const [key, p] of Object.entries(people)) {
      await tx.user.create({
        data: {
          id: p.id,
          cognitoSub: p.id,
          pool: 'STAFF',
          email: p.email,
          name: `Fake R55a ${key}`,
        },
      });
    }
    for (const key of ['a', 'b'] as const) {
      const slug = `r55a-${key}-${run}`;
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
    ['a', adminA.id, 'ADMIN'],
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
    const service = async (
      key: 's1' | 's2' | 's3' | 'books',
      name: string,
      kind: 'BUSINESS_DEVELOPMENT' | 'BOOKKEEPING',
    ) => {
      services[key] = (
        await tx.service.create({
          data: {
            businessId,
            kind,
            name: `${name} ${run}`,
            description: `${name} (fake)`,
            status: 'ACTIVE',
          },
          select: { id: true },
        })
      ).id;
    };
    await service('s1', 'Business Planning', 'BUSINESS_DEVELOPMENT');
    await service('s2', 'Funding Readiness', 'BUSINESS_DEVELOPMENT');
    await service('s3', 'Website Setup', 'BUSINESS_DEVELOPMENT');
    await service('books', 'Bookkeeping', 'BOOKKEEPING');
    const pack = await tx.servicePackage.create({
      data: {
        businessId,
        name: `Starter ${run}`,
        shortDescription: 'Fake package',
        status: 'ACTIVE',
        packagePriceCents: 10_000,
      },
      select: { id: true },
    });
    await tx.servicePackageItem.create({
      data: { businessId, packageId: pack.id, serviceId: services.s1 },
    });
    const client = async (key: 'c1' | 'c2' | 'c3' | 'c4', name: string, over: object = {}) => {
      clients[key] = (
        await tx.client.create({
          data: { businessId, displayName: name, email: `${key}-${run}@client.test`, ...over },
          select: { id: true },
        })
      ).id;
    };
    await client('c1', 'Jamie Sample (fake)', { assignedUserId: staffA.id });
    await client('c2', 'Riley Example (fake)', { accountType: 'BUSINESS' });
    await client('c3', 'Casey Planner (fake)', { assignedUserId: preparerA.id });
    await client('c4', 'Nora Nobody (fake)');
    await tx.clientProfile.create({
      data: {
        clientId: clients.c2,
        businessId,
        businessName: 'Riley Bakery (fake)',
        entityType: 'LLC',
        city: 'Atlanta',
        state: 'GA',
        einLast4: '1234',
      },
    });
    // c1 has a Business Development engagement, which the program picks up.
    await tx.engagement.create({
      data: { businessId, clientId: clients.c1, serviceId: services.s1, title: 'Advisory (fake)' },
    });
    // Meetings tagged by the advisory service: one coming, one past, one cancelled; and one not advisory.
    const meeting = (clientId: string, serviceId: string, offsetDays: number, extra: object = {}) =>
      tx.appointment.create({
        data: {
          businessId,
          clientId,
          serviceId,
          staffUserId: adminA.id,
          startsAt: new Date(Date.now() + offsetDays * DAY),
          endsAt: new Date(Date.now() + offsetDays * DAY + 3_600_000),
          locationKind: 'VIDEO',
          locationDetails: 'https://meet.example.test/fake',
          ...extra,
        },
      });
    await meeting(clients.c1, services.s1, 3);
    await meeting(clients.c1, services.s1, -4);
    await meeting(clients.c1, services.s1, 5, { status: 'CANCELLED', cancelledAt: new Date() });
    await meeting(clients.c2, services.s2, 8, {
      locationKind: 'IN_PERSON',
      locationDetails: '12 Fake Street',
    });
    await meeting(clients.c1, services.books, 6);
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
        data: { businessId: firms.b, kind: 'BUSINESS_DEVELOPMENT', name: 'Firm B advisory' },
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
});

afterAll(async () => {
  await app.close();
});

const shared = {} as {
  a1: string;
  a2: string;
  a3: string;
  plan: string;
  p2: string;
  g1: string;
  late: string;
  rec: string;
  hiddenRec: string;
  act: string;
};

describe('services and advisory clients', () => {
  it('offers the firm’s advisory services, with the packages that include them', async () => {
    const list = AdvisoryServiceOptionList.parse(ok(await call('get', '/services', staffA)));
    const names = list.items.map((s) => s.serviceId);
    expect(names).toEqual(expect.arrayContaining([services.s1, services.s2, services.s3]));
    expect(names).not.toContain(services.books);
    expect(list.items.find((s) => s.serviceId === services.s1)).toMatchObject({
      packages: [`Starter ${run}`],
      referralOnly: false,
    });
    expect(list.items.find((s) => s.serviceId === services.s2)?.packages).toEqual([]);
    expect(
      AdvisoryServiceOptionList.parse(
        ok(await call('get', '/services', ownerB, undefined, 'b')),
      ).items.map((s) => s.serviceId),
    ).toEqual([services.sB]);
    expectError(await call('get', '/services', undefined), 401, 'UNAUTHENTICATED');
  });

  it('puts a client in the program with one primary service, once', async () => {
    const added = await addClient(clients.c1, {
      additionalServiceIds: [services.s2],
      packageName: 'Starter',
      advisorUserId: adminA.id,
      industry: 'Retail',
      businessStage: 'startup',
    });
    shared.a1 = added.id;
    expect(added).toMatchObject({
      status: 'IN_PROGRESS',
      client: { id: clients.c1 },
      advisor: { userId: adminA.id },
      industry: 'Retail',
      businessStage: 'startup',
      primaryService: { serviceId: services.s1 },
      additionalServiceCount: 1,
      since: firmDay(),
      archived: false,
      healthScore: null,
      canEdit: true,
      canViewFinancials: true,
    });
    expect(added.workstreams.map((w) => [w.serviceId, w.role, w.status])).toEqual([
      [services.s1, 'PRIMARY', 'ACCEPTED'],
      [services.s2, 'ADDITIONAL', 'INTERESTED'],
    ]);
    expect(added.workstreams[0]?.packageName).toBe('Starter');
    // The client’s Business Development engagement carries its meetings, notes and documents.
    expect(added.engagementId).toBeTruthy();
    expect(added.health).toMatchObject({ score: null, stale: true, computedAt: null });
    expect(added.disclaimer).toMatch(/not guarantees/);
    expect(added.kpis).toMatchObject({
      activeGoals: { count: 0, onTrack: 0, atRisk: 0 },
      openTasks: { open: 0, overdue: 0 },
    });
    expect(added.counts).toMatchObject({ plans: 0, goals: 0, recommendations: 0, actionItems: 0 });
    expect(added.counts.meetings).toBe(2);

    expectError(
      await call('post', '/clients', ownerA, {
        clientId: clients.c1,
        primaryServiceId: services.s1,
      }),
      409,
      'ALREADY_ADVISORY_CLIENT',
    );
    expectError(
      await call('post', '/clients', ownerA, {
        clientId: clients.c4,
        primaryServiceId: services.books,
      }),
      404,
      'NOT_FOUND',
    );
    expectError(
      await call('post', '/clients', ownerA, {
        clientId: clients.c4,
        primaryServiceId: services.s1,
        additionalServiceIds: [services.sB],
      }),
      404,
      'NOT_FOUND',
    );
    expectError(
      await call('post', '/clients', ownerA, {
        clientId: clients.c4,
        primaryServiceId: services.s1,
        additionalServiceIds: [services.s1],
      }),
      400,
      'VALIDATION_FAILED',
    );
    expectError(
      await call('post', '/clients', ownerA, {
        clientId: clients.c4,
        primaryServiceId: services.s1,
        advisorUserId: ownerB.id,
      }),
      409,
      'NOT_A_MEMBER',
    );
    expectError(
      await call('post', '/clients', ownerA, {
        clientId: clients.cB,
        primaryServiceId: services.s1,
      }),
      404,
      'NOT_FOUND',
    );
    expectError(
      await call('post', '/clients', ownerA, {
        clientId: clients.c4,
        primaryServiceId: services.s1,
        surprise: true,
      }),
      400,
      'VALIDATION_FAILED',
    );
    // Staff add only clients assigned to them, and a reader cannot add.
    expectError(
      await call('post', '/clients', staffA, {
        clientId: clients.c4,
        primaryServiceId: services.s1,
      }),
      404,
      'NOT_FOUND',
    );
    expectError(
      await call('post', '/clients', preparerA, {
        clientId: clients.c3,
        primaryServiceId: services.s1,
      }),
      403,
      'FORBIDDEN',
    );
    const second = await addClient(clients.c2, { primaryServiceId: services.s2 });
    shared.a2 = second.id;
    expect(second).toMatchObject({
      businessName: 'Riley Bakery (fake)',
      businessProfile: { entityType: 'LLC', einMasked: 'XX-XXX1234' },
      engagementId: null,
    });
    expect(second.businessProfile.address).toMatchObject({ city: 'Atlanta', state: 'GA' });
    const rows = await auditFor(added.id);
    expect(rows.map((r) => r.action)).toContain('advisory_client.added');
  });

  it('lists the program’s clients with filters, to Staff only for theirs', async () => {
    const all = AdvisoryClientPage.parse(ok(await call('get', '/clients', ownerA)));
    expect(all.items.map((r) => r.id)).toEqual(expect.arrayContaining([shared.a1, shared.a2]));
    expect(all.items.map((r) => r.client.name)).toEqual(
      [...all.items.map((r) => r.client.name)].sort((x, y) => x.localeCompare(y)),
    );
    expect(
      AdvisoryClientPage.parse(ok(await call('get', '/clients?search=bakery', ownerA))).items.map(
        (r) => r.id,
      ),
    ).toEqual([shared.a2]);
    expect(
      AdvisoryClientPage.parse(ok(await call('get', `/clients?serviceId=${services.s2}`, ownerA)))
        .items.map((r) => r.id)
        .sort(),
    ).toEqual([shared.a1, shared.a2].sort());
    expect(
      AdvisoryClientPage.parse(
        ok(await call('get', `/clients?advisorUserId=${adminA.id}`, ownerA)),
      ).items.map((r) => r.id),
    ).toEqual([shared.a1]);
    expect(
      AdvisoryClientPage.parse(
        ok(await call('get', '/clients?businessStage=STARTUP', ownerA)),
      ).items.map((r) => r.id),
    ).toEqual([shared.a1]);
    // The next meeting is the first coming advisory meeting, not the cancelled or non-advisory ones.
    const jamie = all.items.find((r) => r.id === shared.a1);
    expect(jamie?.nextMeetingAt).not.toBeNull();
    expect(Date.parse(jamie?.nextMeetingAt ?? '') - Date.now()).toBeLessThan(3.5 * DAY);
    const byMeeting = AdvisoryClientPage.parse(
      ok(await call('get', '/clients?sort=nextMeeting', ownerA)),
    );
    expect(byMeeting.items[0]?.id).toBe(shared.a1);
    expect(
      AdvisoryClientPage.parse(ok(await call('get', '/clients?sort=health&direction=desc', ownerA)))
        .total,
    ).toBe(2);
    expect(
      AdvisoryClientPage.parse(ok(await call('get', '/clients?pageSize=1&page=2', ownerA))),
    ).toMatchObject({ page: 2, pageSize: 1, total: 2 });

    const staff = AdvisoryClientPage.parse(ok(await call('get', '/clients', staffA)));
    expect(staff.items.map((r) => r.id)).toEqual([shared.a1]);
    expectError(await call('get', `/clients/${shared.a2}`, staffA), 404, 'NOT_FOUND');
    expect(
      AdvisoryClientPage.parse(ok(await call('get', '/clients', ownerB, undefined, 'b'))).total,
    ).toBe(0);
    expectError(
      await call('get', `/clients/${shared.a1}`, ownerB, undefined, 'b'),
      404,
      'NOT_FOUND',
    );
    expectError(await call('get', '/clients/not-a-uuid', ownerA), 400, 'VALIDATION_FAILED');
    expectError(await call('get', '/clients?status=NOPE', ownerA), 400, 'VALIDATION_FAILED');
  });

  it('changes a client with an etag, archives and restores it', async () => {
    const before = await advClient(shared.a1);
    const patched = AdvisoryClientDetail.parse(
      ok(
        await call('patch', `/clients/${shared.a1}`, ownerA, {
          etag: before.etag,
          status: 'ON_HOLD',
          industry: 'Food',
          since: '2025-06-01',
        }),
      ),
    );
    expect(patched).toMatchObject({ status: 'ON_HOLD', industry: 'Food', since: '2025-06-01' });
    expectError(
      await call('patch', `/clients/${shared.a1}`, ownerA, { etag: before.etag, industry: 'Late' }),
      409,
      'SAVE_CONFLICT',
    );
    expectError(
      await call('patch', `/clients/${shared.a1}`, ownerA, {
        etag: patched.etag,
        status: 'ARCHIVED',
      }),
      400,
      'VALIDATION_FAILED',
    );
    expectError(
      await call('patch', `/clients/${shared.a1}`, ownerA, {
        etag: patched.etag,
        advisorUserId: ownerB.id,
      }),
      409,
      'NOT_A_MEMBER',
    );
    expectError(
      await call('patch', `/clients/${shared.a1}`, ownerA, { etag: patched.etag }),
      400,
      'VALIDATION_FAILED',
    );
    const back = AdvisoryClientDetail.parse(
      ok(
        await call('patch', `/clients/${shared.a1}`, ownerA, {
          etag: patched.etag,
          status: 'IN_PROGRESS',
        }),
      ),
    );
    expect(back.status).toBe('IN_PROGRESS');

    const archived = AdvisoryClientRow.parse(
      ok(await call('post', `/clients/${shared.a2}/archive`, ownerA)),
    );
    expect(archived).toMatchObject({ archived: true, status: 'ARCHIVED' });
    expect(
      AdvisoryClientPage.parse(ok(await call('get', '/clients', ownerA))).items.map((r) => r.id),
    ).not.toContain(shared.a2);
    expect(
      AdvisoryClientPage.parse(
        ok(await call('get', '/clients?includeArchived=true', ownerA)),
      ).items.map((r) => r.id),
    ).toContain(shared.a2);
    const frozen = await advClient(shared.a2);
    expectError(
      await call('patch', `/clients/${shared.a2}`, ownerA, { etag: frozen.etag, industry: 'x' }),
      409,
      'CLIENT_ARCHIVED',
    );
    expectError(
      await call('post', `/clients/${shared.a2}/workstreams`, ownerA, { serviceId: services.s3 }),
      409,
      'CLIENT_ARCHIVED',
    );
    expectError(
      await call('post', '/goals', ownerA, { advisoryClientId: shared.a2, title: mark('Goal') }),
      409,
      'CLIENT_ARCHIVED',
    );
    expect(
      AdvisoryClientRow.parse(ok(await call('post', `/clients/${shared.a2}/restore`, ownerA))),
    ).toMatchObject({ archived: false, status: 'IN_PROGRESS' });
    expectError(await call('post', `/clients/${shared.a1}/archive`, preparerA), 403, 'FORBIDDEN');
  });

  it('adds and changes a client’s services: one primary, no duplicates, dates that fit', async () => {
    const id = shared.a1;
    const added = AdvisoryWorkstream.parse(
      ok(await call('post', `/clients/${id}/workstreams`, staffA, { serviceId: services.s3 }), 201),
    );
    expect(added).toMatchObject({
      role: 'ADDITIONAL',
      status: 'INTERESTED',
      serviceId: services.s3,
    });
    expectError(
      await call('post', `/clients/${id}/workstreams`, staffA, { serviceId: services.s3 }),
      409,
      'DUPLICATE_SERVICE',
    );
    expectError(
      await call('post', `/clients/${id}/workstreams`, ownerA, { serviceId: services.books }),
      404,
      'NOT_FOUND',
    );
    expectError(
      await call('post', `/clients/${id}/workstreams`, ownerA, { serviceId: services.sB }),
      404,
      'NOT_FOUND',
    );
    // Making one primary makes the old primary an additional service: a client has exactly one.
    const promoted = AdvisoryWorkstream.parse(
      ok(
        await call('patch', `/clients/${id}/workstreams/${added.id}`, ownerA, { role: 'PRIMARY' }),
      ),
    );
    expect(promoted.role).toBe('PRIMARY');
    const detail = await advClient(id);
    expect(detail.workstreams.filter((w) => w.role === 'PRIMARY').map((w) => w.serviceId)).toEqual([
      services.s3,
    ]);
    expect(detail.primaryService?.serviceId).toBe(services.s3);
    // Starting and finishing set their dates; a finish before the start is refused.
    const started = AdvisoryWorkstream.parse(
      ok(
        await call('patch', `/clients/${id}/workstreams/${added.id}`, ownerA, {
          status: 'IN_PROGRESS',
        }),
      ),
    );
    expect(started.startedOn).toBe(firmDay());
    expect(
      AdvisoryWorkstream.parse(
        ok(
          await call('patch', `/clients/${id}/workstreams/${added.id}`, ownerA, {
            status: 'COMPLETED',
          }),
        ),
      ).completedOn,
    ).toBe(firmDay());
    expectError(
      await call('patch', `/clients/${id}/workstreams/${added.id}`, ownerA, {
        completedOn: day(-30),
      }),
      400,
      'VALIDATION_FAILED',
    );
    expectError(
      await call('patch', `/clients/${id}/workstreams/${randomUUID()}`, ownerA, {
        status: 'ON_HOLD',
      }),
      404,
      'NOT_FOUND',
    );
    expectError(
      await call('patch', `/clients/${id}/workstreams/${added.id}`, preparerA, {
        status: 'ON_HOLD',
      }),
      403,
      'FORBIDDEN',
    );
  });
});

describe('business plans', () => {
  it('saves a draft at any stage, merging the documents at their top-level keys', async () => {
    const note = 'Internal plan note (fake)';
    const created = await createPlan(
      shared.a1,
      { planType: 'growth', profile: { businessName: 'Jamie Cafe (fake)', industry: 'Food' } },
      staffA,
    );
    expect(created).toMatchObject({
      status: 'DRAFT',
      step: 1,
      currentVersion: 0,
      finalizedAt: null,
      archived: false,
      client: { id: clients.c1 },
      planType: 'growth',
      profile: { businessName: 'Jamie Cafe (fake)', industry: 'Food' },
      assessment: {},
      strategy: {},
      canEdit: true,
      canSend: true,
    });
    expect(created.disclaimer).toMatch(/not guarantees/);
    expect(created.workstreams.length).toBeGreaterThan(0);
    const id = created.id;

    // A key sent replaces that part; a key not sent stays; null removes it.
    const merged = AdvisoryPlanDetail.parse(
      ok(
        await call('patch', `/plans/${id}`, staffA, {
          etag: created.etag,
          step: 3,
          profile: { employeeCount: 4, industry: null },
          assessment: { funding: { amountNeededCents: 5_000_000, purpose: note } },
          strategy: {
            summary: 'Grow the cafe',
            areas: [{ area: 'REVENUE_GROWTH', objective: 'More sales' }],
          },
        }),
      ),
    );
    expect(merged.step).toBe(3);
    expect(merged.profile).toEqual({ businessName: 'Jamie Cafe (fake)', employeeCount: 4 });
    expect(merged.assessment.funding?.purpose).toBe(note);
    expect(merged.strategy.areas).toHaveLength(1);
    expectError(
      await call('patch', `/plans/${id}`, staffA, { etag: created.etag, step: 4 }),
      409,
      'SAVE_CONFLICT',
    );
    for (const bad of [
      { profile: { ein: '12-3456789' } },
      { profile: { unknown: 1 } },
      { profile: { website: 'not a url' } },
      {
        strategy: {
          areas: [
            { area: 'FUNDING', objective: 'a' },
            { area: 'FUNDING', objective: 'b' },
          ],
        },
      },
      { assessment: { dataSource: 'GUESS' } },
      { step: 9 },
      { name: 'a\u0000b' },
    ])
      expectError(await patchPlan(id, bad, staffA), 400, 'VALIDATION_FAILED');
    expectError(
      await call('patch', `/plans/${id}`, staffA, { etag: merged.etag }),
      400,
      'VALIDATION_FAILED',
    );
    const rows = JSON.stringify(await auditFor(shared.a1));
    expect(rows).not.toContain('Internal plan note');
    expect(rows).not.toContain('5000000');
    expect(rows).not.toContain('Grow the cafe');

    // Create and read are the caller's own; a plan of another client or firm is not found.
    expectError(
      await call('post', '/plans', staffA, {
        advisoryClientId: shared.a2,
        name: mark('x'),
        targetYear: 2026,
      }),
      404,
      'NOT_FOUND',
    );
    expectError(await call('get', `/plans/${id}`, ownerB, undefined, 'b'), 404, 'NOT_FOUND');
    expectError(
      await call('post', '/plans', preparerA, {
        advisoryClientId: shared.a1,
        name: mark('x'),
        targetYear: 2026,
      }),
      403,
      'FORBIDDEN',
    );
    const list = AdvisoryPlanPage.parse(
      ok(
        await call(
          'get',
          `/plans?advisoryClientId=${shared.a1}&status=DRAFT&targetYear=2026`,
          ownerA,
        ),
      ),
    );
    expect(list.items.map((p) => p.id)).toContain(id);
    expect(
      AdvisoryPlanPage.parse(
        ok(await call('get', `/plans?planType=GROWTH&search=${run}`, ownerA)),
      ).items.map((p) => p.id),
    ).toContain(id);
    expect(
      AdvisoryPlanPage.parse(ok(await call('get', '/plans', staffA))).items.every(
        (p) => p.client.id === clients.c1,
      ),
    ).toBe(true);
    shared.plan = id;
  });

  it('keeps the profile’s Additional Information: where the client came from, and notes', async () => {
    const created = await createPlan(shared.a1, {
      profile: { businessName: 'Jamie Sample Co (fake)', referralSource: 'Existing Client' },
    });
    expect(created.profile).toMatchObject({ referralSource: 'Existing Client' });
    const saved = AdvisoryPlanDetail.parse(
      ok(await patchPlan(created.id, { profile: { notes: 'Wants a second shop (fake)' } })),
    );
    // Merged at the top-level key: the earlier answer stays.
    expect(saved.profile).toMatchObject({
      referralSource: 'Existing Client',
      notes: 'Wants a second shop (fake)',
    });
    const cleared = AdvisoryPlanDetail.parse(
      ok(await patchPlan(created.id, { profile: { referralSource: null } })),
    );
    expect(cleared.profile.referralSource ?? null).toBeNull();
    expectError(
      await patchPlan(created.id, { profile: { notes: 'x'.repeat(2_001) } }),
      400,
      'VALIDATION_FAILED',
    );
  });

  it('moves a plan along only in ways that fit, and archives and restores it', async () => {
    const id = shared.plan;
    const status = async (to: string, who: Who = ownerA) =>
      call('post', `/plans/${id}/status`, who, { status: to, etag: (await plan(id)).etag });
    expectError(await status('IN_PROGRESS'), 409, 'INVALID_STATUS');
    expectError(await status('COMPLETED'), 409, 'INVALID_STATUS');
    expectError(await status('DRAFT'), 409, 'INVALID_STATUS');
    expectError(
      await call('post', `/plans/${id}/status`, ownerA, { status: 'FINALIZED', etag: 'x' }),
      400,
      'VALIDATION_FAILED',
    );
    expectError(
      await call('post', `/plans/${id}/status`, ownerA, {
        status: 'IN_REVIEW',
        etag: '2000-01-01T00:00:00.000Z',
      }),
      409,
      'SAVE_CONFLICT',
    );
    expect(AdvisoryPlanDetail.parse(ok(await status('IN_REVIEW'))).status).toBe('IN_REVIEW');
    expect(AdvisoryPlanDetail.parse(ok(await status('DRAFT'))).status).toBe('DRAFT');

    // Nothing to finalize yet: no goal, no figures. The answer names what is missing.
    const missing = await call('post', `/plans/${id}/finalize`, ownerA, {
      etag: (await plan(id)).etag,
    });
    expectError(missing, 409, 'PLAN_NOT_READY');
    expect(JSON.stringify(missing.body)).toMatch(/at least one goal/);
    expect(JSON.stringify(missing.body)).toMatch(/financial figures/);
    expectError(
      await call('post', `/plans/${id}/send`, ownerA, { channel: 'DOWNLOAD' }),
      409,
      'PLAN_NOT_READY',
    );
    expectError(
      await call('post', `/plans/${id}/send`, preparerA, { channel: 'DOWNLOAD' }),
      403,
      'FORBIDDEN',
    );

    const spare = await createPlan(shared.a1, { name: mark('Spare') });
    const archived = AdvisoryPlanDetail.parse(
      ok(await call('post', `/plans/${spare.id}/archive`, ownerA)),
    );
    expect(archived).toMatchObject({ archived: true, status: 'ARCHIVED' });
    expectError(await patchPlan(spare.id, { step: 2 }), 409, 'PLAN_ARCHIVED');
    expectError(
      await call('post', `/plans/${spare.id}/status`, ownerA, {
        status: 'IN_REVIEW',
        etag: archived.etag,
      }),
      409,
      'PLAN_ARCHIVED',
    );
    expect(
      AdvisoryPlanPage.parse(
        ok(await call('get', `/plans?advisoryClientId=${shared.a1}`, ownerA)),
      ).items.map((p) => p.id),
    ).not.toContain(spare.id);
    expect(
      AdvisoryPlanDetail.parse(ok(await call('post', `/plans/${spare.id}/restore`, ownerA))),
    ).toMatchObject({ archived: false, status: 'DRAFT' });
  });
});

describe('goals and milestones', () => {
  it('keeps a goal’s status and progress together, and works out overdue when read', async () => {
    const created = await createGoal(
      shared.a1,
      {
        title: mark('Revenue goal'),
        area: 'Revenue Growth',
        description: 'Grow sales (fake)',
        targetDate: day(60),
        ownerUserId: adminA.id,
        planId: shared.plan,
        milestones: [
          { title: 'Hire a baker', targetDate: day(20) },
          { title: 'Open the second counter', ownerUserId: staffA.id },
        ],
      },
      staffA,
    );
    shared.g1 = created.id;
    expect(created).toMatchObject({
      status: 'NOT_STARTED',
      progressPercent: 0,
      area: 'revenue_growth',
      owner: { userId: adminA.id },
      planId: shared.plan,
      milestoneCount: 2,
      milestonesDone: 0,
      archived: false,
      client: { id: clients.c1 },
    });
    expect(created.milestones.map((m) => [m.title, m.sortOrder])).toEqual([
      ['Hire a baker', 0],
      ['Open the second counter', 1],
    ]);
    expectError(
      await call('post', '/goals', staffA, {
        advisoryClientId: shared.a1,
        title: mark('Bad'),
        status: 'NOT_STARTED',
        progressPercent: 50,
      }),
      400,
      'VALIDATION_FAILED',
    );
    expectError(
      await call('post', '/goals', staffA, {
        advisoryClientId: shared.a1,
        title: mark('Bad'),
        area: '!!',
      }),
      400,
      'VALIDATION_FAILED',
    );
    expectError(
      await call('post', '/goals', staffA, {
        advisoryClientId: shared.a1,
        title: mark('Bad'),
        ownerUserId: ownerB.id,
      }),
      409,
      'NOT_A_MEMBER',
    );
    expectError(
      await call('post', '/goals', staffA, {
        advisoryClientId: shared.a2,
        title: mark('Not mine'),
      }),
      404,
      'NOT_FOUND',
    );
    expectError(
      await call('post', '/goals', preparerA, {
        advisoryClientId: shared.a1,
        title: mark('Read only'),
      }),
      403,
      'FORBIDDEN',
    );

    // A plan or service of another client is refused, one of another firm is not found.
    const otherPlan = await createPlan(shared.a2, { name: mark('Riley plan') });
    shared.p2 = otherPlan.id;
    expectError(
      await call('post', '/goals', ownerA, {
        advisoryClientId: shared.a1,
        title: mark('x'),
        planId: otherPlan.id,
      }),
      409,
      'NOT_THIS_CLIENT',
    );
    expectError(
      await call('post', '/goals', ownerA, {
        advisoryClientId: shared.a1,
        title: mark('x'),
        workstreamId: (await advClient(shared.a2)).workstreams[0]?.id,
      }),
      409,
      'NOT_THIS_CLIENT',
    );
    expectError(
      await call('post', '/goals', ownerA, {
        advisoryClientId: shared.a1,
        title: mark('x'),
        planId: randomUUID(),
      }),
      404,
      'NOT_FOUND',
    );
    const foreignPlan = await inFirm('b', async (tx) => {
      const c = await tx.advisoryClient.create({
        data: { businessId: firms.b, clientId: clients.cB },
        select: { id: true },
      });
      return (
        await tx.advisoryPlan.create({
          data: {
            businessId: firms.b,
            advisoryClientId: c.id,
            name: mark('B plan'),
            targetYear: 2026,
            createdByUserId: ownerB.id,
          },
          select: { id: true },
        })
      ).id;
    });
    expectError(
      await call('post', '/goals', ownerA, {
        advisoryClientId: shared.a1,
        title: mark('x'),
        planId: foreignPlan,
      }),
      404,
      'NOT_FOUND',
    );

    // Completed is 100%; a completed goal cannot be set below it; not started is 0%.
    const done = AdvisoryGoalDetail.parse(ok(await patchGoal(created.id, { status: 'COMPLETED' })));
    expect(done).toMatchObject({ status: 'COMPLETED', progressPercent: 100 });
    expect(done.completedAt).not.toBeNull();
    expectError(await patchGoal(created.id, { progressPercent: 50 }), 400, 'VALIDATION_FAILED');
    expectError(
      await patchGoal(created.id, { status: 'COMPLETED', progressPercent: 50 }),
      400,
      'VALIDATION_FAILED',
    );
    const reopened = AdvisoryGoalDetail.parse(
      ok(await patchGoal(created.id, { status: 'IN_PROGRESS' })),
    );
    expect(reopened).toMatchObject({
      status: 'IN_PROGRESS',
      progressPercent: 100,
      completedAt: null,
    });
    const started = AdvisoryGoalDetail.parse(
      ok(await patchGoal(created.id, { progressPercent: 40, targetDate: day(90) })),
    );
    expect(started).toMatchObject({ progressPercent: 40, targetDate: day(90) });
    expectError(
      await patchGoal(created.id, { status: 'NOT_STARTED', progressPercent: 10 }),
      400,
      'VALIDATION_FAILED',
    );
    expect(
      AdvisoryGoalDetail.parse(ok(await patchGoal(created.id, { status: 'NOT_STARTED' })))
        .progressPercent,
    ).toBe(0);
    expectError(
      await call('patch', `/goals/${created.id}`, ownerA, {
        etag: '2000-01-01T00:00:00.000Z',
        title: 'Late',
      }),
      409,
      'SAVE_CONFLICT',
    );
    expectError(await patchGoal(created.id, { planId: otherPlan.id }), 409, 'NOT_THIS_CLIENT');

    // An open goal past its target date is shown as overdue, and found by that status.
    const late = await createGoal(shared.a1, {
      title: mark('Late goal'),
      targetDate: day(-3),
      status: 'IN_PROGRESS',
      progressPercent: 30,
    });
    expect(late.status).toBe('OVERDUE');
    const overdue = AdvisoryGoalPage.parse(
      ok(await call('get', `/goals?status=OVERDUE&advisoryClientId=${shared.a1}`, ownerA)),
    );
    expect(overdue.items.map((g) => g.id)).toEqual([late.id]);
    expect(
      AdvisoryGoalPage.parse(
        ok(await call('get', `/goals?status=IN_PROGRESS&advisoryClientId=${shared.a1}`, ownerA)),
      ).items.map((g) => g.id),
    ).not.toContain(late.id);
    expect(
      AdvisoryGoalPage.parse(
        ok(await call('get', '/goals?dueBefore=' + day(-1), ownerA)),
      ).items.map((g) => g.id),
    ).toContain(late.id);
    shared.late = late.id;
  });

  it('lists goals by client and area, sorted, and hides them from who cannot reach the client', async () => {
    const byArea = AdvisoryGoalPage.parse(
      ok(await call('get', '/goals?area=Revenue%20Growth', ownerA)),
    );
    expect(byArea.items.map((g) => g.id)).toContain(shared.g1);
    const sorted = AdvisoryGoalPage.parse(
      ok(
        await call('get', `/goals?advisoryClientId=${shared.a1}&sort=title&direction=desc`, ownerA),
      ),
    );
    const titles = sorted.items.map((g) => g.title);
    expect(titles).toEqual([...titles].sort((x, y) => (x < y ? 1 : x > y ? -1 : 0)));
    expect(
      AdvisoryGoalPage.parse(
        ok(await call('get', `/goals?search=${encodeURIComponent('Late goal')}`, ownerA)),
      ).total,
    ).toBe(1);
    expect(
      AdvisoryGoalPage.parse(ok(await call('get', '/goals', staffA))).items.every(
        (g) => g.client.id === clients.c1,
      ),
    ).toBe(true);
    expectError(await call('get', `/goals/${shared.g1}`, ownerB, undefined, 'b'), 404, 'NOT_FOUND');
    expect(
      AdvisoryGoalPage.parse(ok(await call('get', '/goals', ownerB, undefined, 'b'))).total,
    ).toBe(0);
    const rowAudit = await auditRows(shared.g1);
    expect(rowAudit.map((r) => r.action)).toEqual(
      expect.arrayContaining(['advisory_goal.created', 'advisory_goal.updated']),
    );
    expect(JSON.stringify(rowAudit)).not.toContain('Grow sales');
  });

  it('adds, changes and reorders milestones, and archives a goal', async () => {
    const id = shared.g1;
    const m = AdvisoryMilestone.parse(
      ok(
        await call('post', `/goals/${id}/milestones`, staffA, {
          title: 'Launch menu',
          targetDate: day(10),
        }),
        201,
      ),
    );
    expect(m).toMatchObject({ sortOrder: 2, status: 'NOT_STARTED', progressPercent: 0 });
    const done = AdvisoryMilestone.parse(
      ok(await call('patch', `/milestones/${m.id}`, staffA, { status: 'COMPLETED' })),
    );
    expect(done).toMatchObject({ status: 'COMPLETED', progressPercent: 100 });
    expect(done.completedAt).not.toBeNull();
    expectError(
      await call('patch', `/milestones/${m.id}`, staffA, { progressPercent: 20 }),
      400,
      'VALIDATION_FAILED',
    );
    expectError(
      await call('patch', `/milestones/${m.id}`, ownerA, { ownerUserId: ownerB.id }),
      409,
      'NOT_A_MEMBER',
    );
    expectError(
      await call('patch', `/milestones/${randomUUID()}`, ownerA, { title: 'x' }),
      404,
      'NOT_FOUND',
    );
    expect((await goal(id)).milestonesDone).toBe(1);

    const ids = (await goal(id)).milestones.map((x) => x.id);
    expectError(
      await call('put', `/goals/${id}/milestones/order`, ownerA, { ids: ids.slice(1) }),
      400,
      'VALIDATION_FAILED',
    );
    const reversed = AdvisoryGoalDetail.parse(
      ok(await call('put', `/goals/${id}/milestones/order`, ownerA, { ids: [...ids].reverse() })),
    );
    expect(reversed.milestones.map((x) => x.id)).toEqual([...ids].reverse());

    const archived = AdvisoryGoalDetail.parse(
      ok(await call('post', `/goals/${id}/archive`, ownerA)),
    );
    expect(archived.archived).toBe(true);
    expect(
      AdvisoryGoalPage.parse(
        ok(await call('get', `/goals?advisoryClientId=${shared.a1}`, ownerA)),
      ).items.map((g) => g.id),
    ).not.toContain(id);
    expectError(await patchGoal(id, { title: 'Nope' }), 409, 'INVALID_STATUS');
    expectError(
      await call('post', `/goals/${id}/milestones`, ownerA, { title: 'Nope' }),
      409,
      'INVALID_STATUS',
    );
    expect(
      AdvisoryGoalDetail.parse(ok(await call('post', `/goals/${id}/restore`, ownerA))).archived,
    ).toBe(false);
    expectError(await call('post', `/goals/${id}/archive`, preparerA), 403, 'FORBIDDEN');
  });
});

describe('recommendations and action items', () => {
  it('keeps recommendations with their category, impact and decision', async () => {
    const rec = AdvisoryRecommendationRow.parse(
      ok(
        await call('post', '/recommendations', staffA, {
          advisoryClientId: shared.a1,
          planId: shared.plan,
          goalId: shared.g1,
          title: mark('Apply for an SBA loan'),
          category: 'Funding',
          rationale: 'Lower rates (fake)',
          impactLabel: '+15% Profit',
          impactCents: 250_000,
          clientVisible: true,
        }),
        201,
      ),
    );
    shared.rec = rec.id;
    expect(rec).toMatchObject({
      status: 'PROPOSED',
      decidedAt: null,
      category: 'funding',
      impactLabel: '+15% Profit',
      impactCents: 250_000,
      clientVisible: true,
      planId: shared.plan,
      goalId: shared.g1,
      createdBy: { userId: staffA.id },
    });
    const hidden = AdvisoryRecommendationRow.parse(
      ok(
        await call('post', '/recommendations', staffA, {
          advisoryClientId: shared.a1,
          planId: shared.plan,
          title: mark('Internal idea'),
        }),
        201,
      ),
    );
    expect(hidden.clientVisible).toBe(false);
    shared.hiddenRec = hidden.id;
    expectError(
      await call('post', '/recommendations', staffA, {
        advisoryClientId: shared.a1,
        title: mark('x'),
        impactCents: -5,
      }),
      400,
      'VALIDATION_FAILED',
    );
    expectError(
      await call('post', '/recommendations', staffA, {
        advisoryClientId: shared.a1,
        title: mark('x'),
        category: '!!',
      }),
      400,
      'VALIDATION_FAILED',
    );
    expectError(
      await call('post', '/recommendations', ownerA, {
        advisoryClientId: shared.a1,
        title: mark('x'),
        goalId: (await createGoal(shared.a2)).id,
      }),
      409,
      'NOT_THIS_CLIENT',
    );
    expectError(
      await call('post', '/recommendations', staffA, {
        advisoryClientId: shared.a2,
        title: mark('x'),
      }),
      404,
      'NOT_FOUND',
    );
    expectError(
      await call('post', '/recommendations', preparerA, {
        advisoryClientId: shared.a1,
        title: mark('x'),
      }),
      403,
      'FORBIDDEN',
    );

    // A decision sets the time; going back to proposed clears it.
    const accepted = AdvisoryRecommendationRow.parse(
      ok(await call('patch', `/recommendations/${rec.id}`, staffA, { status: 'ACCEPTED' })),
    );
    expect(accepted.status).toBe('ACCEPTED');
    expect(accepted.decidedAt).not.toBeNull();
    const implemented = AdvisoryRecommendationRow.parse(
      ok(await call('patch', `/recommendations/${rec.id}`, staffA, { status: 'IMPLEMENTED' })),
    );
    expect(implemented.decidedAt).toBe(accepted.decidedAt);
    const back = AdvisoryRecommendationRow.parse(
      ok(
        await call('patch', `/recommendations/${rec.id}`, staffA, {
          status: 'PROPOSED',
          category: null,
        }),
      ),
    );
    expect(back).toMatchObject({ decidedAt: null, category: null });
    expectError(
      await call('patch', `/recommendations/${rec.id}`, staffA, {}),
      400,
      'VALIDATION_FAILED',
    );
    expectError(
      await call('patch', `/recommendations/${randomUUID()}`, ownerA, { title: 'x' }),
      404,
      'NOT_FOUND',
    );
    expectError(
      await call('patch', `/recommendations/${rec.id}`, ownerB, { title: 'x' }, 'b'),
      404,
      'NOT_FOUND',
    );

    const list = AdvisoryRecommendationPage.parse(
      ok(
        await call(
          'get',
          `/recommendations?advisoryClientId=${shared.a1}&clientVisible=true`,
          ownerA,
        ),
      ),
    );
    expect(list.items.map((r) => r.id)).toEqual([rec.id]);
    expect(
      AdvisoryRecommendationPage.parse(
        ok(await call('get', `/recommendations?planId=${shared.plan}`, ownerA)),
      ).total,
    ).toBe(2);
    expect(
      AdvisoryRecommendationPage.parse(
        ok(await call('get', '/recommendations', staffA)),
      ).items.every((r) => r.advisoryClientId === shared.a1),
    ).toBe(true);
    expect(JSON.stringify(await auditFor(shared.a1))).not.toMatch(/SBA loan|Lower rates|250000/);
  });

  it('keeps action items for staff, the client or the team, with due dates and overdue worked out', async () => {
    const staffItem = AdvisoryActionItemRow.parse(
      ok(
        await call('post', '/action-items', staffA, {
          advisoryClientId: shared.a1,
          planId: shared.plan,
          goalId: shared.g1,
          title: mark('Prepare the loan packet'),
          assigneeKind: 'STAFF',
          assigneeUserId: adminA.id,
          dueOn: day(-2),
          priority: 'HIGH',
          clientVisible: true,
        }),
        201,
      ),
    );
    shared.act = staffItem.id;
    expect(staffItem).toMatchObject({
      assigneeKind: 'STAFF',
      assignee: { userId: adminA.id },
      status: 'NOT_STARTED',
      overdue: true,
      priority: 'HIGH',
      clientVisible: true,
      client: { id: clients.c1 },
    });
    const clientItem = AdvisoryActionItemRow.parse(
      ok(
        await call('post', '/action-items', staffA, {
          advisoryClientId: shared.a1,
          planId: shared.plan,
          title: mark('Gather three vendor quotes'),
          assigneeKind: 'CLIENT',
          dueOn: day(14),
        }),
        201,
      ),
    );
    expect(clientItem).toMatchObject({ assignee: null, overdue: false, clientVisible: false });
    expectError(
      await call('post', '/action-items', staffA, {
        advisoryClientId: shared.a1,
        title: mark('x'),
        assigneeKind: 'CLIENT',
        assigneeUserId: adminA.id,
      }),
      400,
      'VALIDATION_FAILED',
    );
    // A staff action item with no one named is the author's own.
    const own = AdvisoryActionItemRow.parse(
      ok(
        await call('post', '/action-items', staffA, {
          advisoryClientId: shared.a1,
          title: mark('My own step'),
        }),
        201,
      ),
    );
    expect(own).toMatchObject({ assigneeKind: 'STAFF', assignee: { userId: staffA.id } });
    await call('patch', `/action-items/${own.id}`, staffA, { status: 'CANCELLED' });
    expectError(
      await call('post', '/action-items', staffA, {
        advisoryClientId: shared.a1,
        title: mark('x'),
        assigneeUserId: ownerB.id,
      }),
      409,
      'NOT_A_MEMBER',
    );
    expectError(
      await call('post', '/action-items', staffA, {
        advisoryClientId: shared.a1,
        title: mark('x'),
        assigneeKind: 'TEAM',
        milestoneId: randomUUID(),
      }),
      404,
      'NOT_FOUND',
    );
    const otherGoal = await createGoal(shared.a2, { milestones: [{ title: 'Other step' }] });
    expectError(
      await call('post', '/action-items', ownerA, {
        advisoryClientId: shared.a1,
        title: mark('x'),
        assigneeKind: 'TEAM',
        milestoneId: otherGoal.milestones[0]?.id,
      }),
      409,
      'NOT_THIS_CLIENT',
    );

    const done = AdvisoryActionItemRow.parse(
      ok(await call('patch', `/action-items/${staffItem.id}`, staffA, { status: 'DONE' })),
    );
    expect(done).toMatchObject({ status: 'DONE', overdue: false });
    expect(done.completedAt).not.toBeNull();
    const reopened = AdvisoryActionItemRow.parse(
      ok(await call('patch', `/action-items/${staffItem.id}`, staffA, { status: 'IN_PROGRESS' })),
    );
    expect(reopened).toMatchObject({ completedAt: null, overdue: true });
    const toClient = AdvisoryActionItemRow.parse(
      ok(await call('patch', `/action-items/${staffItem.id}`, staffA, { assigneeKind: 'CLIENT' })),
    );
    expect(toClient).toMatchObject({ assigneeKind: 'CLIENT', assignee: null });
    expectError(
      await call('patch', `/action-items/${staffItem.id}`, staffA, { assigneeKind: 'STAFF' }),
      400,
      'VALIDATION_FAILED',
    );
    expectError(
      await call('patch', `/action-items/${staffItem.id}`, staffA, {
        assigneeKind: 'STAFF',
        assigneeUserId: ownerB.id,
      }),
      409,
      'NOT_A_MEMBER',
    );
    expectError(
      await call('patch', `/action-items/${staffItem.id}`, preparerA, { title: 'x' }),
      403,
      'FORBIDDEN',
    );
    expectError(
      await call('patch', `/action-items/${staffItem.id}`, ownerB, { title: 'x' }, 'b'),
      404,
      'NOT_FOUND',
    );

    const overdue = AdvisoryActionItemPage.parse(
      ok(await call('get', `/action-items?overdue=true&advisoryClientId=${shared.a1}`, ownerA)),
    );
    expect(overdue.items.map((a) => a.id)).toEqual([staffItem.id]);
    expect(
      AdvisoryActionItemPage.parse(
        ok(
          await call(
            'get',
            `/action-items?overdue=false&assigneeKind=CLIENT&advisoryClientId=${shared.a1}`,
            ownerA,
          ),
        ),
      ).items.map((a) => a.id),
    ).toEqual([clientItem.id]);
    expect(
      AdvisoryActionItemPage.parse(
        ok(
          await call(
            'get',
            `/action-items?assigneeKind=CLIENT&advisoryClientId=${shared.a1}`,
            ownerA,
          ),
        ),
      ).total,
    ).toBe(2);
    expect(
      AdvisoryActionItemPage.parse(ok(await call('get', '/action-items', staffA))).items.every(
        (a) => a.client.id === clients.c1,
      ),
    ).toBe(true);
    expect((await advClient(shared.a1)).kpis.openTasks).toEqual({ open: 2, overdue: 1 });
    expect(JSON.stringify(await auditFor(shared.a1))).not.toMatch(/loan packet|vendor quotes/);
  });
});

describe('financial analysis and the Business Health Score', () => {
  it('keeps snapshots that never change, checks net profit, and shows them only to who may see them', async () => {
    const id = shared.a2;
    // Revenue 1,000,000 less expenses 800,000: net profit is worked out.
    const first = AdvisoryFinancialRow.parse(
      ok(
        await financial(id, {
          periodStart: '2024-01-01',
          periodEnd: '2024-12-31',
          revenueCents: 1_000_000,
          expensesCents: 800_000,
          asOf: day(-200),
        }),
        201,
      ),
    );
    expect(first).toMatchObject({
      netProfitCents: 200_000,
      marginPercent: 20,
      source: 'MANUAL',
      overridden: false,
      overriddenBy: null,
      stale: true,
    });
    const second = AdvisoryFinancialRow.parse(
      ok(
        await financial(id, {
          periodStart: '2025-01-01',
          periodEnd: '2025-12-31',
          revenueCents: 1_200_000,
          expensesCents: 900_000,
          netProfitCents: 300_000,
          cashFlowCents: 50_000,
          debtCents: 200_000,
          headcount: 12,
          asOf: day(-5),
        }),
        201,
      ),
    );
    expect(second).toMatchObject({ netProfitCents: 300_000, marginPercent: 25, stale: false });
    expectError(
      await financial(id, { revenueCents: 1_000, expensesCents: 400, netProfitCents: 500 }),
      409,
      'INCONSISTENT_FIGURES',
    );
    expect(
      AdvisoryFinancialRow.parse(
        ok(
          await financial(id, {
            periodStart: '2021-01-01',
            periodEnd: '2021-12-31',
            revenueCents: 100,
            expensesCents: 900,
          }),
          201,
        ),
      ).netProfitCents,
    ).toBe(-800);
    for (const bad of [
      { periodStart: '2025-12-31', periodEnd: '2025-01-01' },
      { revenueCents: null },
      { revenueCents: -1 },
      { asOf: '0000-01-01' },
    ])
      expectError(await financial(id, bad), 400, 'VALIDATION_FAILED');
    expectError(await financial(shared.a2, { planId: randomUUID() }), 404, 'NOT_FOUND');
    expectError(await financial(shared.a1, { planId: shared.p2 }), 409, 'NOT_THIS_CLIENT');
    expectError(await financial(shared.a2, {}, preparerA), 403, 'FORBIDDEN');
    expectError(await financial(shared.a2, {}, staffA), 404, 'NOT_FOUND');
    expectError(await financial(shared.a2, {}, ownerB), 404, 'NOT_FOUND');

    // Figures from a source are replaced only with the permission and a reason; the earlier row stays.
    await inFirm('a', (tx) =>
      tx.advisoryFinancialSnapshot.create({
        data: {
          businessId: firms.a,
          advisoryClientId: id,
          periodStart: new Date('2023-01-01T00:00:00Z'),
          periodEnd: new Date('2023-12-31T00:00:00Z'),
          revenueCents: 700_000,
          expensesCents: 500_000,
          netProfitCents: 200_000,
          source: 'BOOKKEEPING',
          asOf: new Date(`${day(-30)}T00:00:00Z`),
          createdByUserId: ownerA.id,
        },
      }),
    );
    const replace = {
      periodStart: '2023-01-01',
      periodEnd: '2023-12-31',
      revenueCents: 650_000,
      expensesCents: 600_000,
    };
    // Staff work on their own clients but may not override: client 1 has bookkeeping figures too.
    await inFirm('a', (tx) =>
      tx.advisoryFinancialSnapshot.create({
        data: {
          businessId: firms.a,
          advisoryClientId: shared.a1,
          periodStart: new Date('2023-01-01T00:00:00Z'),
          periodEnd: new Date('2023-12-31T00:00:00Z'),
          revenueCents: 400_000,
          source: 'BOOKKEEPING',
          asOf: new Date(`${day(-30)}T00:00:00Z`),
          createdByUserId: ownerA.id,
        },
      }),
    );
    expectError(
      await financial(
        shared.a1,
        { ...replace, override: { reason: 'Not allowed (fake)' } },
        staffA,
      ),
      403,
      'OVERRIDE_NOT_ALLOWED',
    );
    expectError(await financial(id, replace, adminA), 400, 'VALIDATION_FAILED');
    const overridden = AdvisoryFinancialRow.parse(
      ok(
        await financial(id, { ...replace, override: { reason: 'The books were wrong (fake)' } }),
        201,
      ),
    );
    expect(overridden).toMatchObject({
      overridden: true,
      overrideReason: 'The books were wrong (fake)',
      overriddenBy: { userId: ownerA.id },
      netProfitCents: 50_000,
    });
    expectError(
      await financial(id, {
        periodStart: '2020-01-01',
        periodEnd: '2020-12-31',
        override: { reason: 'x' },
      }),
      400,
      'VALIDATION_FAILED',
    );
    const latest = AdvisoryFinancialPage.parse(
      ok(
        await call(
          'get',
          `/financials?advisoryClientId=${id}&from=2023-01-01&to=2023-12-31`,
          ownerA,
        ),
      ),
    );
    expect(latest.items.map((r) => r.source)).toEqual(['MANUAL']);
    const all = AdvisoryFinancialPage.parse(
      ok(
        await call(
          'get',
          `/financials?advisoryClientId=${id}&from=2023-01-01&to=2023-12-31&includeSuperseded=true`,
          ownerA,
        ),
      ),
    );
    expect(all.items.map((r) => r.source).sort()).toEqual(['BOOKKEEPING', 'MANUAL']);
    expect(JSON.stringify(await auditFor(id))).not.toMatch(/books were wrong|650000|1200000/);
    expect(
      (await auditFor(id)).some((r) => JSON.stringify(r.metadata).includes('"overridden":true')),
    ).toBe(true);

    // The list shows the newest row of each period, with totals and the budget variance.
    await financial(id, {
      periodStart: '2022-01-01',
      periodEnd: '2022-12-31',
      revenueCents: 550_000,
      budgetRevenueCents: 500_000,
      asOf: day(-300),
    });
    const budgeted = AdvisoryFinancialPage.parse(
      ok(
        await call(
          'get',
          `/financials?advisoryClientId=${id}&from=2022-01-01&to=2022-12-31`,
          ownerA,
        ),
      ),
    );
    expect(budgeted.summary).toMatchObject({
      revenueCents: 550_000,
      budgetRevenueCents: 500_000,
      budgetVarianceCents: 50_000,
    });
    const bySource = AdvisoryFinancialPage.parse(
      ok(await call('get', '/financials?source=BANK', ownerA)),
    );
    expect(bySource.total).toBe(0);
    expect(
      AdvisoryFinancialPage.parse(ok(await call('get', '/financials', staffA))).items.every(
        (r) => r.client.id === clients.c1,
      ),
    ).toBe(true);
    expectError(await call('get', '/financials', preparerA), 403, 'FINANCIALS_RESTRICTED');
    expect(
      AdvisoryFinancialPage.parse(ok(await call('get', '/financials', ownerB, undefined, 'b')))
        .total,
    ).toBe(0);
  });

  it('explains the health score by its factors, re-weights what is missing and shows figures only to who may see them', async () => {
    const d = await advClient(shared.a2);
    // Revenue +20%, margin 25%, positive cash flow, debt under a quarter of revenue, goals at 0%.
    expect(d.healthScore).toBe(81);
    expect(d.health).toMatchObject({ score: 81, stale: false });
    expect(d.health.computedAt).not.toBeNull();
    expect(d.health.formulaVersion).toMatch(/^[0-9a-f]{8}$/);
    const value = (f: string) => d.health.factors.find((x) => x.factor === f)?.value;
    expect(
      ['revenue_trend', 'profit_margin', 'cash_flow', 'debt_ratio', 'goal_progress'].map(value),
    ).toEqual([100, 100, 100, 100, 0]);
    // No action items and no budget: those factors have no value and are left out of the score.
    expect([value('action_completion'), value('budget_variance')]).toEqual([null, null]);
    expect(d.health.factors.every((f) => f.label && f.explanation)).toBe(true);
    expect(d.health.factors.reduce((n, f) => n + f.weight, 0)).toBe(100);

    expect(d.kpis.annualRevenueCents).toMatchObject({
      value: 1_200_000,
      previous: 1_000_000,
      deltaPercent: 20,
      source: 'MANUAL',
    });
    expect(d.kpis.netProfitCents).toMatchObject({
      value: 300_000,
      previous: 200_000,
      deltaPercent: 50,
    });
    expect(d.kpis.employees.value).toBe(12);

    // A reader sees the score but not the figures.
    await addClient(clients.c3, {}, ownerA);
    const reader = await advClient(
      (
        AdvisoryClientPage.parse(ok(await call('get', '/clients', preparerA))).items[0] as {
          id: string;
        }
      ).id,
      preparerA,
    );
    expect(reader).toMatchObject({ canViewFinancials: false, canEdit: false });
    expect(reader.kpis.annualRevenueCents).toBeNull();
    expect(reader.kpis.netProfitCents).toBeNull();
    expect(reader.businessProfile.einMasked).toBeNull();
    shared.a3 = reader.id;
  });
});

describe('plans: finalize, versions and delivery', () => {
  it('finalizes a plan into a version that never changes, and delivers only what the client may see', async () => {
    const id = shared.p2;
    const status = async (to: string, who: Who = ownerA) =>
      call('post', `/plans/${id}/status`, who, { status: to, etag: (await plan(id, who)).etag });
    const finalize = async (who: Who = ownerA) =>
      call('post', `/plans/${id}/finalize`, who, { etag: (await plan(id, who)).etag });

    const notReady = await finalize();
    expectError(notReady, 409, 'PLAN_NOT_READY');
    expect(JSON.stringify(notReady.body)).toMatch(/business name/);
    expect(JSON.stringify(notReady.body)).toMatch(/strategy summary/);
    expect(JSON.stringify(notReady.body)).toMatch(/at least one goal/);
    ok(
      await patchPlan(id, {
        profile: { businessName: 'Riley Bakery (fake)' },
        strategy: { summary: 'Open a second shop' },
      }),
    );
    const goalForPlan = await createGoal(shared.a2, {
      title: mark('Second shop'),
      planId: id,
      targetDate: day(120),
    });
    await call('post', '/recommendations', ownerA, {
      advisoryClientId: shared.a2,
      planId: id,
      title: 'Visible recommendation (fake)',
      impactLabel: '+10% Revenue',
      clientVisible: true,
    });
    await call('post', '/recommendations', ownerA, {
      advisoryClientId: shared.a2,
      planId: id,
      title: 'Hidden recommendation (fake)',
    });
    await call('post', '/action-items', ownerA, {
      advisoryClientId: shared.a2,
      planId: id,
      title: 'Visible next step (fake)',
      assigneeKind: 'CLIENT',
      dueOn: day(7),
      clientVisible: true,
    });
    await call('post', '/action-items', ownerA, {
      advisoryClientId: shared.a2,
      planId: id,
      title: 'Hidden next step (fake)',
      assigneeKind: 'TEAM',
    });

    const finalized = AdvisoryPlanDetail.parse(ok(await finalize()));
    expect(finalized).toMatchObject({ status: 'FINALIZED', currentVersion: 1 });
    expect(finalized.finalizedAt).not.toBeNull();
    expect(finalized.sourceDataAsOf).toBe(day(-5));
    expect(finalized.staleFinancials).toBe(false);
    expect(finalized.financials?.length).toBeGreaterThan(0);
    expect(finalized.goals.map((g) => g.id)).toEqual([goalForPlan.id]);
    expect(finalized.recommendations).toHaveLength(2);
    expect(finalized.actionItems).toHaveLength(2);

    const versions = AdvisoryVersionList.parse(
      ok(await call('get', `/plans/${id}/versions`, ownerA)),
    );
    expect(versions.items.map((v) => [v.versionNo, v.deliveredAt])).toEqual([[1, null]]);
    const v1 = AdvisoryVersionDetail.parse(
      ok(await call('get', `/plans/${id}/versions/1`, ownerA)),
    );
    expect(v1).toMatchObject({
      planName: finalized.name,
      targetYear: 2026,
      sourceDataAsOf: day(-5),
      profile: { businessName: 'Riley Bakery (fake)' },
      strategy: { summary: 'Open a second shop' },
    });
    expect(v1.goals.map((g) => g.title)).toEqual([goalForPlan.title]);
    expect(v1.recommendations.map((r) => r.title).sort()).toEqual([
      'Hidden recommendation (fake)',
      'Visible recommendation (fake)',
    ]);
    expect(v1.workstreams.length).toBeGreaterThan(0);
    expect(v1.financials?.length).toBeGreaterThan(0);
    expect(v1.disclaimer).toMatch(/not guarantees/);

    // An edit after finalizing leaves the version as it was, and the plan has to be finalized again to send.
    ok(await patchPlan(id, { profile: { businessName: 'Riley Bakery and Cafe (fake)' } }));
    const v1After = AdvisoryVersionDetail.parse(
      ok(await call('get', `/plans/${id}/versions/1`, ownerA)),
    );
    expect(v1After).toEqual(v1);
    expectError(
      await call('post', `/plans/${id}/send`, adminA, { channel: 'DOWNLOAD' }),
      409,
      'PLAN_NOT_READY',
    );
    expect(AdvisoryPlanDetail.parse(ok(await finalize())).currentVersion).toBe(2);

    // Delivery is recorded on the version: who, when and how. Another delivery is its own record.
    const sent = AdvisoryPlanDetail.parse(
      ok(await call('post', `/plans/${id}/send`, adminA, { channel: 'DOWNLOAD' })),
    );
    expect(sent).toMatchObject({ status: 'SENT', currentVersion: 2 });
    expect(sent.sentAt).not.toBeNull();
    const delivered = AdvisoryVersionList.parse(
      ok(await call('get', `/plans/${id}/versions`, ownerA)),
    ).items;
    expect(delivered.find((v) => v.versionNo === 2)).toMatchObject({
      deliveredChannel: 'download',
      deliveredBy: { userId: adminA.id },
    });
    expect(delivered.find((v) => v.versionNo === 1)?.deliveredAt).toBeNull();
    const again = AdvisoryPlanDetail.parse(
      ok(await call('post', `/plans/${id}/send`, adminA, { channel: 'DOWNLOAD' })),
    );
    expect(again.currentVersion).toBe(3);
    // An earlier version can be delivered as it was, even after the plan changed.
    ok(await patchPlan(id, { step: 5 }));
    ok(await call('post', `/plans/${id}/send`, adminA, { channel: 'DOWNLOAD', version: 1 }));
    expect(
      AdvisoryVersionList.parse(ok(await call('get', `/plans/${id}/versions`, ownerA))).items.find(
        (v) => v.versionNo === 1,
      )?.deliveredChannel,
    ).toBe('download');
    expectError(
      await call('post', `/plans/${id}/send`, adminA, { channel: 'DOWNLOAD', version: 99 }),
      404,
      'NOT_FOUND',
    );
    expectError(await call('get', `/plans/${id}/versions/99`, ownerA), 404, 'NOT_FOUND');

    // To the portal: the client-facing plan, without the hidden recommendation or step, or any figure.
    const portal = AdvisoryPlanDetail.parse(
      ok(
        await call('post', `/plans/${id}/send`, adminA, {
          channel: 'PORTAL',
          message: 'See you soon (fake)',
        }),
      ),
    );
    expect(portal.sentAt).not.toBeNull();
    const thread = await inFirm('a', (tx) =>
      tx.messageThread.findFirstOrThrow({
        where: { clientId: clients.c2, subject: { startsWith: 'Your business plan' } },
        include: { messages: true },
      }),
    );
    const body = thread.messages[0]?.body ?? '';
    expect(body).toMatch(/Visible recommendation/);
    expect(body).toMatch(/Visible next step/);
    expect(body).toMatch(/See you soon/);
    expect(body).toMatch(/not guarantees/);
    expect(body).not.toMatch(/Hidden/);
    expect(body).not.toMatch(/1200000|1,200,000|300000|Internal/);

    // Statuses after delivery.
    expectError(await status('DRAFT'), 409, 'INVALID_STATUS');
    expect(AdvisoryPlanDetail.parse(ok(await status('IN_PROGRESS'))).status).toBe('IN_PROGRESS');
    expect(AdvisoryPlanDetail.parse(ok(await status('COMPLETED'))).status).toBe('COMPLETED');
    expect(
      AdvisoryPlanDetail.parse(
        ok(await call('post', `/plans/${id}/send`, adminA, { channel: 'DOWNLOAD' })),
      ).status,
    ).toBe('COMPLETED');
    const archived = AdvisoryPlanDetail.parse(
      ok(await call('post', `/plans/${id}/archive`, ownerA)),
    );
    expect(archived.status).toBe('ARCHIVED');
    expectError(
      await call('post', `/plans/${id}/send`, adminA, { channel: 'DOWNLOAD' }),
      409,
      'PLAN_ARCHIVED',
    );
    expect(
      AdvisoryPlanDetail.parse(ok(await call('post', `/plans/${id}/restore`, ownerA))).status,
    ).toBe('SENT');

    const actions = (await auditFor(shared.a2)).map((r) => r.action);
    expect(actions).toEqual(
      expect.arrayContaining([
        'advisory_plan.finalized',
        'advisory_plan.sent',
        'advisory_plan.archived',
      ]),
    );
    expect(JSON.stringify(await auditFor(shared.a2))).not.toMatch(
      /Visible recommendation|Second shop|See you soon|Open a second shop/,
    );
    expect(JSON.stringify(await auditRows(id))).not.toContain('Riley Bakery');

    // The reader gets neither figures in the plan nor in a version.
    const readerPlan = await createPlan(shared.a3, {});
    expect(
      AdvisoryPlanDetail.parse(ok(await call('get', `/plans/${readerPlan.id}`, preparerA)))
        .financials,
    ).toBeNull();
    expectError(await call('get', `/plans/${id}`, preparerA), 404, 'NOT_FOUND');
  });
});

describe('the overview, meetings, resources, settings and activity', () => {
  it('shows the overview, to Staff for their clients only', async () => {
    const o = AdvisoryOverview.parse(ok(await call('get', '/overview', ownerA)));
    expect(o.activeClients.value).toBeGreaterThanOrEqual(3);
    expect(o.activePlans.value).toBeGreaterThanOrEqual(2);
    expect(o.upcomingMeetings.value).toBe(2);
    expect(o.recentClients.length).toBeLessThanOrEqual(5);
    expect(o.goals.length).toBeLessThanOrEqual(5);
    expect(o.meetings.map((m) => m.client.id)).toEqual([clients.c1, clients.c2]);
    expect(o.resources).toHaveLength(5);
    expect(o.serviceOptions.length).toBeGreaterThanOrEqual(3);
    expect(o).toMatchObject({ canCreatePlan: true, canManageGoals: true, canSend: true });
    expect(o.disclaimer).toMatch(/not guarantees/);
    const staff = AdvisoryOverview.parse(ok(await call('get', '/overview', staffA)));
    expect(staff.upcomingMeetings.value).toBe(1);
    expect(staff.recentClients.every((c) => c.client.id === clients.c1)).toBe(true);
    expect(staff.meetings.every((m) => m.client.id === clients.c1)).toBe(true);
    const reader = AdvisoryOverview.parse(ok(await call('get', '/overview', preparerA)));
    expect(reader).toMatchObject({ canCreatePlan: false, canManageGoals: false, canSend: false });
    const b = AdvisoryOverview.parse(ok(await call('get', '/overview', ownerB, undefined, 'b')));
    expect(b.activeClients.value).toBe(1);
    expect(b.recentClients.map((c) => c.client.id)).toEqual([clients.cB]);
    expect(b.meetings).toEqual([]);
  });

  it('lists advisory meetings from Appointments, read-only', async () => {
    const upcoming = AdvisoryMeetingPage.parse(ok(await call('get', '/meetings', ownerA)));
    expect(upcoming.items.map((m) => m.client.id)).toEqual([clients.c1, clients.c2]);
    expect(upcoming.items[0]).toMatchObject({
      joinUrl: 'https://meet.example.test/fake',
      location: null,
      advisor: { userId: adminA.id },
    });
    expect(upcoming.items[1]).toMatchObject({
      joinUrl: null,
      location: '12 Fake Street',
      businessName: 'Riley Bakery (fake)',
    });
    expect(
      AdvisoryMeetingPage.parse(ok(await call('get', '/meetings?when=past', ownerA))).total,
    ).toBe(1);
    expect(
      AdvisoryMeetingPage.parse(ok(await call('get', '/meetings?when=all', ownerA))).total,
    ).toBe(3);
    expect(
      AdvisoryMeetingPage.parse(
        ok(await call('get', `/meetings?advisoryClientId=${shared.a2}&when=all`, ownerA)),
      ).items.map((m) => m.client.id),
    ).toEqual([clients.c2]);
    expect(
      AdvisoryMeetingPage.parse(ok(await call('get', '/meetings?when=all', staffA))).items.every(
        (m) => m.client.id === clients.c1,
      ),
    ).toBe(true);
    expectError(
      await call('get', `/meetings?advisoryClientId=${shared.a2}`, staffA),
      404,
      'NOT_FOUND',
    );
    expect(
      AdvisoryMeetingPage.parse(ok(await call('get', '/meetings?when=all', ownerB, undefined, 'b')))
        .total,
    ).toBe(0);
    expectError(await call('get', '/meetings?when=never', ownerA), 400, 'VALIDATION_FAILED');
  });

  it('lists the approved resources and sends a client-facing one', async () => {
    const all = AdvisoryResourceList.parse(ok(await call('get', '/resources', staffA))).items;
    expect(all.length).toBeGreaterThanOrEqual(10);
    expect(
      AdvisoryResourceList.parse(
        ok(await call('get', '/resources?clientFacing=false', staffA)),
      ).items.every((r) => !r.clientFacing),
    ).toBe(true);
    expect(
      AdvisoryResourceList.parse(
        ok(await call('get', '/resources?category=funding', staffA)),
      ).items.map((r) => r.key),
    ).toEqual(['funding-readiness-checklist']);
    expect(
      AdvisoryResourceList.parse(ok(await call('get', '/resources?search=banking', staffA))).items,
    ).toHaveLength(1);

    const key = 'funding-readiness-checklist';
    expect(
      OkResponse.parse(
        ok(
          await call('post', `/resources/${key}/send`, staffA, {
            advisoryClientId: shared.a1,
            channel: 'PORTAL_MESSAGE',
            message: 'For our call (fake)',
          }),
        ),
      ).ok,
    ).toBe(true);
    const thread = await inFirm('a', (tx) =>
      tx.messageThread.findFirstOrThrow({
        where: { clientId: clients.c1, subject: { startsWith: 'Funding Readiness Checklist' } },
        include: { messages: true },
      }),
    );
    expect(thread.messages[0]?.body).toMatch(/For our call/);
    expectError(
      await call('post', '/resources/advisory-health-score-reference/send', ownerA, {
        advisoryClientId: shared.a1,
        channel: 'EMAIL',
      }),
      409,
      'RESOURCE_NOT_CLIENT_FACING',
    );
    expectError(
      await call('post', '/resources/no-such-resource/send', ownerA, {
        advisoryClientId: shared.a1,
        channel: 'EMAIL',
      }),
      404,
      'NOT_FOUND',
    );
    expectError(
      await call('post', `/resources/${key}/send`, staffA, {
        advisoryClientId: shared.a2,
        channel: 'EMAIL',
      }),
      404,
      'NOT_FOUND',
    );
    expectError(
      await call('post', `/resources/${key}/send`, preparerA, {
        advisoryClientId: shared.a3,
        channel: 'EMAIL',
      }),
      403,
      'FORBIDDEN',
    );
  });

  it('shows a client’s audited activity as sentences, for Staff only on their clients', async () => {
    const feed = AdvisoryActivityPage.parse(
      ok(await call('get', `/clients/${shared.a1}/activity?pageSize=100`, staffA)),
    );
    const messages = feed.items.map((i) => i.message);
    expect(messages).toEqual(
      expect.arrayContaining([
        'Added to the advisory program',
        'Business plan created',
        'Goal added',
      ]),
    );
    expect(
      feed.items.every((i) => i.action.startsWith('advisory_') && !i.action.endsWith('.viewed')),
    ).toBe(true);
    expect(feed.items[0] && Date.parse(feed.items[0].at)).toBeGreaterThanOrEqual(
      Date.parse(feed.items[feed.items.length - 1]?.at ?? ''),
    );
    expect(JSON.stringify(feed)).not.toMatch(/Revenue goal|Grow sales|Jamie Cafe/);
    const paged = AdvisoryActivityPage.parse(
      ok(await call('get', `/clients/${shared.a1}/activity?pageSize=2&page=2`, ownerA)),
    );
    expect(paged).toMatchObject({ page: 2, pageSize: 2 });
    expect(paged.items).toHaveLength(2);
    expectError(await call('get', `/clients/${shared.a2}/activity`, staffA), 404, 'NOT_FOUND');
    expectError(
      await call('get', `/clients/${shared.a1}/activity`, ownerB, undefined, 'b'),
      404,
      'NOT_FOUND',
    );
  });

  it('configures the health formula for new calculations only, and the default advisor', async () => {
    const view = AdvisorySettingsView.parse(ok(await call('get', '/settings', ownerA)));
    expect(view.healthFormula.reduce((n, f) => n + f.weight, 0)).toBe(100);
    expect(view.healthFormula.every((f) => f.label && f.explanation)).toBe(true);
    expect(view.availableFactors.map((f) => f.factor)).toContain('profit_margin');
    expect(view).toMatchObject({ staleFinancialsDays: 120, defaultAdvisor: null, updatedAt: null });
    expectError(await call('get', '/settings', staffA), 403, 'FORBIDDEN');
    expectError(
      await call('put', '/settings', staffA, { staleFinancialsDays: 30 }),
      403,
      'FORBIDDEN',
    );

    for (const bad of [
      {},
      { healthFormula: [{ factor: 'profit_margin', weight: 60 }] },
      {
        healthFormula: [
          { factor: 'profit_margin', weight: 50 },
          { factor: 'profit_margin', weight: 50 },
        ],
      },
      { healthFormula: [{ factor: 'magic', weight: 100 }] },
      { staleFinancialsDays: 3 },
    ])
      expectError(await call('put', '/settings', ownerA, bad), 400, 'VALIDATION_FAILED');
    expectError(
      await call('put', '/settings', ownerA, { defaultAdvisorUserId: ownerB.id }),
      409,
      'NOT_A_MEMBER',
    );

    const before = (await advClient(shared.a2)).health;
    const saved = AdvisorySettingsView.parse(
      ok(
        await call('put', '/settings', ownerA, {
          healthFormula: [
            { factor: 'profit_margin', weight: 50 },
            { factor: 'goal_progress', weight: 50 },
          ],
          staleFinancialsDays: 30,
          defaultAdvisorUserId: adminA.id,
        }),
      ),
    );
    expect(saved).toMatchObject({
      staleFinancialsDays: 30,
      defaultAdvisor: { userId: adminA.id },
      healthFormula: [
        { factor: 'profit_margin', weight: 50 },
        { factor: 'goal_progress', weight: 50 },
      ],
    });
    expect(saved.updatedAt).not.toBeNull();
    // A score keeps the factors it was made from until it is worked out again.
    expect((await advClient(shared.a2)).health.factors).toEqual(before.factors);
    expect((await advClient(shared.a2)).health.formulaVersion).toBe(before.formulaVersion);
    await call('post', '/action-items', ownerA, {
      advisoryClientId: shared.a2,
      title: mark('Trigger'),
      assigneeKind: 'TEAM',
    });
    const after = (await advClient(shared.a2)).health;
    expect(after.factors.map((f) => [f.factor, f.weight])).toEqual([
      ['profit_margin', 50],
      ['goal_progress', 50],
    ]);
    expect(after.score).toBe(50);
    expect(after.formulaVersion).not.toBe(before.formulaVersion);

    // A new client gets the default advisor.
    const c4 = await addClient(clients.c4);
    expect(c4.advisor).toMatchObject({ userId: adminA.id });
    expect(
      await inFirm('a', (tx) =>
        tx.auditLog.count({ where: { action: 'advisory_settings.updated' } }),
      ),
    ).toBe(1);
  });
});
