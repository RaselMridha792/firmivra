// End-to-end: the firm's Payroll tracking (R39 Payroll API; contract in packages/types/src/payroll):
// overview, payroll clients and their service actions, activities, workers, runs with lines,
// checks and approval, filings, reports, year-end, settings and the CSV exports. Owner and Admin
// manage; Staff prepare the clients assigned to them; firm B never reads or changes firm A's
// payroll, and every action writes an audit row. Synthetic data only.
import { createHash, randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request, { type Response } from 'supertest';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createPrismaClient, runInScope } from '@firmivra/db';
import { TEST_CLIENT_OPTIONS, testDatabaseUrls } from '@firmivra/db/testing';
import type { z } from 'zod';
import {
  PayrollActivity,
  PayrollActivityList,
  PayrollChangeList,
  PayrollClientPage,
  PayrollClientWorkspace,
  PayrollFilingList,
  PayrollIssue,
  PayrollIssueList,
  PayrollLineList,
  PayrollOverview,
  PayrollReport,
  PayrollReportList,
  PayrollRun,
  PayrollRunPage,
  PayrollSettings,
  PayrollSyncQueued,
  PayrollWorker,
  PayrollWorkerList,
  PayrollYearEnd,
} from '@firmivra/types';
import { AppModule } from '../../src/app.module.js';
import { configureApp } from '../../src/configure-app.js';
import { loadEnv } from '../../src/config/env.js';

const fx = inject('fixtures');
const run = randomUUID().slice(0, 8);
const person = (key: string) => ({ id: randomUUID(), email: `r39p-${key}-${run}@r39.test` });
const people = {
  ownerA: person('owner-a'),
  adminA: person('admin-a'),
  staffA: person('staff-a'),
  staff2A: person('staff2-a'),
  clientA: person('client-a'),
  ownerB: person('owner-b'),
};
type Who = { email: string };
const ids = { firmA: '', firmB: '', serviceA: '', serviceB: '' };
const clients = {
  assigned: '',
  unassigned: '',
  business: '',
  other: '',
  foreign: '',
  bare: '',
  workers: '',
  runs: '',
  records: '',
  removal: '',
};

let app: INestApplication;
const tokens = new Map<string, string>();
let viewers = 0;
/** A new viewer IP per call, so no test meets the per-IP rate limit. */
const viewer = () => {
  viewers += 1;
  return `198.53.${Math.floor(viewers / 250)}.${(viewers % 250) + 1}, 10.0.0.5`;
};

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
  method: 'get' | 'post' | 'patch' | 'put' | 'delete',
  path: string,
  who: Who | undefined,
  body?: object,
  businessId = ids.firmA,
): Promise<Response> {
  let req = request(app.getHttpServer())
    [method](`/api/v1/business/payroll${path}`)
    .set('x-business-id', businessId)
    .set('x-forwarded-for', viewer());
  if (who) req = req.set('authorization', `Bearer ${await tokenFor(who.email)}`);
  return body === undefined ? req : req.send(body);
}

const codeOf = (res: Response) => (res.body as { error?: { code: string } }).error?.code;
const expectError = (res: Response, status: number, code: string) =>
  expect([res.status, codeOf(res)], JSON.stringify(res.body)).toEqual([status, code]);

/** Parses with the contract and refuses anything the response has beyond it. */
function exact<S extends z.ZodType>(schema: S, res: Response, status = 200): z.output<S> {
  expect(res.status, JSON.stringify(res.body)).toBe(status);
  const parsed = schema.parse(res.body);
  expect(parsed).toEqual(res.body);
  return parsed;
}

async function asOwner<T>(
  businessId: string,
  work: Parameters<typeof runInScope<T>>[2],
): Promise<T> {
  const owner = createPrismaClient(testDatabaseUrls('test_api').owner, TEST_CLIENT_OPTIONS);
  try {
    return await runInScope(owner, { kind: 'business', businessId }, work);
  } finally {
    await owner.$disconnect();
  }
}

const auditActions = (entityId: string, firm = ids.firmA) =>
  asOwner(firm, async (tx) =>
    (await tx.auditLog.findMany({ where: { entityId }, orderBy: { createdAt: 'asc' } })).map(
      (r) => r.action,
    ),
  );
const auditActionsLike = (action: string) =>
  asOwner(ids.firmA, (tx) => tx.auditLog.count({ where: { businessId: ids.firmA, action } }));

const day = (offset = 0, from = new Date()) =>
  new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate() + offset))
    .toISOString()
    .slice(0, 10);

/** One more pay period, so no two runs of a payroll client share one. */
let periods = 0;
const nextRun = () => {
  periods += 1;
  const month = String((periods % 12) + 1).padStart(2, '0');
  const year = 2040 + Math.floor(periods / 12);
  return {
    periodStart: `${year}-${month}-01`,
    periodEnd: `${year}-${month}-15`,
    payDate: `${year}-${month}-19`,
  };
};

const addClient = async (clientId: string, body: object = {}, who: Who = people.ownerA) =>
  exact(PayrollClientWorkspace, await call('post', '/clients', who, { clientId, ...body }), 201);
/** The payroll client id of a client already on payroll. */
const pcOf = async (clientId: string) => {
  const page = exact(PayrollClientPage, await call('get', '/clients?pageSize=100', people.ownerA));
  const found = page.items.find((i) => i.client.id === clientId);
  if (!found) throw new Error(`client ${clientId} is not on payroll`);
  return found.id;
};
const mkWorker = async (pcId: string, body: object = {}) =>
  exact(
    PayrollWorker,
    await call('post', `/clients/${pcId}/workers`, people.staffA, {
      displayName: `Fake Worker ${(periods += 1)}`,
      workerType: 'FULL_TIME',
      payType: 'HOURLY',
      rateCents: 1_800,
      ...body,
    }),
    201,
  );
const mkRun = async (pcId: string, body: object = {}, who: Who = people.ownerA) =>
  exact(
    PayrollRun,
    await call('post', `/clients/${pcId}/runs`, who, { ...nextRun(), ...body }),
    201,
  );

/** A payroll client with a worker and a started run holding one pay line. */
async function preparedRun(pcId: string) {
  const worker = await mkWorker(pcId);
  const created = await mkRun(pcId);
  exact(
    PayrollLineList,
    await call('put', `/runs/${created.id}/lines`, people.staffA, {
      lines: [
        { workerId: worker.id, hours: 80, regularPayCents: 144_000, deductionsCents: 22_000 },
      ],
    }),
  );
  return { worker, run: created };
}

beforeAll(async () => {
  const owner = createPrismaClient(testDatabaseUrls('test_api').owner, TEST_CLIENT_OPTIONS);
  await runInScope(owner, { kind: 'platform' }, async (tx) => {
    for (const [key, p] of Object.entries(people)) {
      await tx.user.create({
        data: {
          id: p.id,
          cognitoSub: p.id,
          pool: key === 'clientA' ? 'CLIENT' : 'STAFF',
          email: p.email,
          name: `Fake R39 ${key}`,
        },
      });
    }
    for (const key of ['firmA', 'firmB'] as const) {
      const slug = `r39p-${key.toLowerCase()}-${run}`;
      ids[key] = (
        await tx.business.create({
          data: { slug, name: slug, status: 'ACTIVE' },
          select: { id: true },
        })
      ).id;
    }
  });
  const members = [
    [ids.firmA, people.ownerA.id, 'OWNER'],
    [ids.firmA, people.adminA.id, 'ADMIN'],
    [ids.firmA, people.staffA.id, 'STAFF'],
    [ids.firmA, people.staff2A.id, 'STAFF'],
    [ids.firmB, people.ownerB.id, 'OWNER'],
  ] as const;
  for (const [businessId, userId, role] of members) {
    await runInScope(owner, { kind: 'business', businessId }, (tx) =>
      tx.membership.create({ data: { businessId, userId, role, status: 'ACTIVE' } }),
    );
  }
  await runInScope(owner, { kind: 'business', businessId: ids.firmA }, async (tx) => {
    await tx.clientAccount.create({
      data: {
        businessId: ids.firmA,
        userId: people.clientA.id,
        email: people.clientA.email,
        status: 'ACTIVE',
      },
    });
    ids.serviceA = (
      await tx.service.create({
        data: {
          businessId: ids.firmA,
          kind: 'PAYROLL',
          name: `Fake payroll ${run}`,
          status: 'ACTIVE',
        },
      })
    ).id;
    const mk = async (displayName: string, extra: object = {}) =>
      (
        await tx.client.create({
          data: { businessId: ids.firmA, displayName: `${displayName} ${run}`, ...extra },
        })
      ).id;
    clients.assigned = await mk('Fake Green Leaf Cafe', { assignedUserId: people.staffA.id });
    clients.unassigned = await mk('Fake Turner Group');
    clients.business = await mk('Fake Davis Consulting', {
      accountType: 'BUSINESS',
      assignedUserId: people.staffA.id,
      email: `davis-${run}@r39.test`,
    });
    clients.other = await mk('Fake Walker Properties', { assignedUserId: people.staffA.id });
    clients.bare = await mk('Fake Bare Client');
    for (const key of ['workers', 'runs', 'records', 'removal'] as const) {
      clients[key] = await mk(`Fake ${key} client`, { assignedUserId: people.staffA.id });
    }
  });
  await runInScope(owner, { kind: 'business', businessId: ids.firmB }, async (tx) => {
    clients.foreign = (
      await tx.client.create({
        data: { businessId: ids.firmB, displayName: `Fake B client ${run}` },
      })
    ).id;
  });
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
  await nest.listen(0, '127.0.0.1');
  app = nest;
});

afterAll(async () => {
  await app.close();
});

describe('who may do what', () => {
  it('staff prepare, Owner and Admin manage, clients 403, strangers 404, signed out 401', async () => {
    expect((await call('get', '/overview', people.staffA)).status).toBe(200);
    expect((await call('get', '/clients', people.staffA)).status).toBe(200);
    expect((await call('get', '/runs', people.staffA)).status).toBe(200);
    // Owner and Admin only.
    expectError(
      await call('post', '/clients', people.staffA, { clientId: clients.bare }),
      403,
      'FORBIDDEN',
    );
    expectError(await call('get', '/settings', people.staffA), 403, 'FORBIDDEN');
    expectError(
      await call('put', '/settings', people.staffA, {
        defaultAssigneeId: null,
        reminderDaysBefore: 3,
        staleAfterHours: 48,
      }),
      403,
      'FORBIDDEN',
    );
    expect((await call('get', '/settings', people.adminA)).status).toBe(200);
    // A client login is never a firm member.
    expect((await call('get', '/overview', people.clientA)).status).toBe(403);
    // Firm B's owner has no seat in firm A.
    expect((await call('get', '/overview', people.ownerB, undefined, ids.firmA)).status).toBe(404);
    expect((await call('get', '/overview', undefined)).status).toBe(401);
  });

  it('rejects unknown fields and bad ids before touching data', async () => {
    expectError(await call('get', '/clients?nope=1', people.ownerA), 400, 'VALIDATION_FAILED');
    expectError(await call('get', '/clients/not-a-uuid', people.ownerA), 400, 'VALIDATION_FAILED');
    expectError(
      await call('post', '/clients', people.ownerA, {
        clientId: clients.bare,
        businessId: ids.firmB,
      }),
      400,
      'VALIDATION_FAILED',
    );
  });
});

describe('overview with no payroll', () => {
  it('returns empty lists and zeros, never made-up numbers', async () => {
    const o = exact(
      PayrollOverview,
      await call('get', '/overview', people.ownerB, undefined, ids.firmB),
    );
    expect(o.kpis.activeClients.value).toBe(0);
    expect(o.kpis.totalProcessedCents).toEqual({ value: 0, previous: 0, changePercent: null });
    expect(o.kpis.totalEmployees.value).toBe(0);
    expect(o.kpis.runs.value).toBe(0);
    expect(o.kpis.needAttention.value).toBe(0);
    expect(o.statusBreakdown.total).toBe(0);
    expect(o.statusBreakdown.items.every((i) => i.count === 0)).toBe(true);
    expect(o.volume).toHaveLength(12);
    expect(o.volume.every((v) => v.grossCents === 0 && v.taxesAndDeductionsCents === 0)).toBe(true);
    expect(o.byProvider).toEqual({ totalCents: 0, items: [] });
    expect(o.providers).toEqual([]);
    expect(o.upcomingRuns).toEqual([]);
    const page = exact(
      PayrollClientPage,
      await call('get', '/clients', people.ownerB, undefined, ids.firmB),
    );
    expect(page).toMatchObject({ items: [], total: 0, page: 1, pageSize: 10 });
    expect(page.tabCounts.ALL).toBe(0);
    const runs = exact(
      PayrollRunPage,
      await call('get', '/runs', people.ownerB, undefined, ids.firmB),
    );
    expect(runs.items).toEqual([]);
  });
});

describe('adding payroll clients', () => {
  it('Owner adds a client: the PAYROLL engagement is made, defaults are empty, history and audit are written', async () => {
    const pc = await addClient(clients.assigned, {
      frequency: 'BIWEEKLY',
      providerKey: 'gusto',
      industry: 'Restaurant',
      assignedUserId: people.adminA.id,
    });
    expect(pc).toMatchObject({
      status: 'NOT_STARTED',
      frequency: 'BIWEEKLY',
      industry: 'Restaurant',
      provider: { key: 'gusto', label: 'Gusto', connected: false },
      syncStatus: 'NOT_CONNECTED',
      employeeCount: null,
      nextPayrollOn: null,
      lastRunOn: null,
      currentRun: null,
      latestRun: null,
      upcomingRuns: [],
      recentWorkers: [],
      openRunIssues: 0,
      assignedTo: { userId: people.adminA.id },
      workers: { fullTime: 0, partTime: 0, contractors: 0, onLeave: 0 },
    });
    const engagement = await asOwner(ids.firmA, (tx) =>
      tx.engagement.findFirstOrThrow({ where: { id: pc.engagementId } }),
    );
    expect(engagement).toMatchObject({
      serviceId: ids.serviceA,
      clientId: clients.assigned,
      status: 'ACTIVE',
    });
    const changes = exact(
      PayrollChangeList,
      await call('get', `/clients/${pc.id}/changes`, people.staffA),
    );
    expect(changes.items.map((c) => [c.field, c.newValue])).toEqual([['service', 'added']]);
    expect(await auditActions(pc.id)).toContain('payroll.client.added');
  });

  it('refuses a client that is already on payroll, an unknown client, and a firm with no Payroll service', async () => {
    expectError(
      await call('post', '/clients', people.ownerA, { clientId: clients.assigned }),
      409,
      'ALREADY_PAYROLL_CLIENT',
    );
    expectError(
      await call('post', '/clients', people.ownerA, { clientId: randomUUID() }),
      404,
      'NOT_FOUND',
    );
    // Another firm's client is unknown here.
    expectError(
      await call('post', '/clients', people.ownerA, { clientId: clients.foreign }),
      404,
      'NOT_FOUND',
    );
    expectError(
      await call('post', '/clients', people.ownerB, { clientId: clients.foreign }, ids.firmB),
      409,
      'NO_PAYROLL_SERVICE',
    );
  });

  it('reuses an existing active PAYROLL engagement', async () => {
    const engagement = await asOwner(ids.firmA, (tx) =>
      tx.engagement.create({
        data: {
          businessId: ids.firmA,
          clientId: clients.other,
          serviceId: ids.serviceA,
          title: 'Existing payroll',
        },
      }),
    );
    const pc = await addClient(clients.other);
    expect(pc.engagementId).toBe(engagement.id);
  });

  it('a Staff assignee must have the client assigned to them; a non-member is refused', async () => {
    expectError(
      await call('post', '/clients', people.ownerA, {
        clientId: clients.unassigned,
        assignedUserId: people.staff2A.id,
      }),
      409,
      'CLIENT_NOT_ASSIGNED',
    );
    expectError(
      await call('post', '/clients', people.ownerA, {
        clientId: clients.unassigned,
        assignedUserId: people.ownerB.id,
      }),
      409,
      'NOT_A_MEMBER',
    );
  });
});

describe('the list, the overview and the exports with data', () => {
  const pcs: Record<'green' | 'turner' | 'davis', string> = { green: '', turner: '', davis: '' };

  beforeAll(async () => {
    const green = await call('get', `/clients?search=Green Leaf`, people.ownerA);
    pcs.green = exact(PayrollClientPage, green).items[0]?.id ?? '';
    pcs.turner = (
      await addClient(clients.unassigned, {
        frequency: 'WEEKLY',
        providerKey: 'adp',
        industry: 'Trucking',
      })
    ).id;
    pcs.davis = (
      await addClient(clients.business, { frequency: 'MONTHLY', providerKey: 'paychex' })
    ).id;
    const soon = day(5);
    await call('patch', `/clients/${pcs.turner}`, people.ownerA, { nextPayrollOn: soon });
    await call('patch', `/clients/${pcs.davis}`, people.ownerA, { nextPayrollOn: day(-3) });
    await call('post', `/clients/${pcs.turner}/status`, people.ownerA, { status: 'PROCESSING' });
    await call('post', `/clients/${pcs.davis}/status`, people.ownerA, { status: 'PAST_DUE' });
    await call('post', `/clients/${pcs.green}/status`, people.ownerA, { status: 'ON_TRACK' });
    // Confirmed runs, as the provider would have completed them: two this month, one last month.
    const stamp = new Date('2030-01-01T00:00:00Z');
    const completed = (payDate: string, n: number) => ({
      businessId: ids.firmA,
      payrollClientId: pcs.turner,
      periodStart: new Date(`2038-0${n}-01T00:00:00Z`),
      periodEnd: new Date(`2038-0${n}-15T00:00:00Z`),
      payDate: new Date(`${payDate}T00:00:00Z`),
      frequency: 'WEEKLY' as const,
      status: 'COMPLETED' as const,
      figuresConfirmed: true,
      source: 'provider',
      employeeCount: 10,
      regularPayCents: 100_000,
      overtimePayCents: 0,
      otherEarningsCents: 0,
      grossCents: 100_000,
      employeeTaxesCents: 20_000,
      deductionsCents: 5_000,
      netCents: 75_000,
      employerTaxesCents: 8_000,
      employerBenefitsCents: 2_000,
      employerCostsCents: 10_000,
      totalCostCents: 110_000,
      readyAt: stamp,
      approvedAt: stamp,
      approvedByUserId: people.ownerA.id,
      submittedAt: stamp,
      completedAt: stamp,
    });
    const now = new Date();
    const lastMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 20));
    await asOwner(ids.firmA, async (tx) => {
      await tx.payrollRun.create({
        data: completed(day(0, new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 5))), 1),
      });
      await tx.payrollRun.create({
        data: completed(day(0, new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 20))), 2),
      });
      await tx.payrollRun.create({ data: completed(day(0, lastMonth), 3) });
      await tx.payrollClient.update({
        where: { id: pcs.turner },
        data: { employeeCount: 25, employeeCountAt: stamp },
      });
    });
  });

  it('lists with tabs, filters, search, sort and paging', async () => {
    const all = exact(PayrollClientPage, await call('get', '/clients', people.ownerA));
    expect(all.total).toBe(4);
    expect(all.tabCounts).toMatchObject({
      ALL: 4,
      ON_TRACK: 1,
      PROCESSING: 1,
      PAST_DUE: 1,
      ACTION_REQUIRED: 0,
      NOT_STARTED: 1,
    });
    expect(all.tabCounts.UPCOMING).toBe(1);
    expect(all.items.map((i) => i.client.displayName)).toEqual(
      [...all.items.map((i) => i.client.displayName)].sort(),
    );
    const turner = all.items.find((i) => i.id === pcs.turner);
    expect(turner).toMatchObject({
      status: 'PROCESSING',
      frequency: 'WEEKLY',
      employeeCount: 25,
      nextPayrollSource: 'schedule',
      provider: { key: 'adp', label: 'ADP', connected: false },
      syncStatus: 'NOT_CONNECTED',
    });

    const ids_ = async (q: string) =>
      exact(PayrollClientPage, await call('get', `/clients?${q}`, people.ownerA)).items.map(
        (i) => i.id,
      );
    expect(await ids_('tab=PROCESSING')).toEqual([pcs.turner]);
    expect(await ids_('tab=PAST_DUE')).toEqual([pcs.davis]);
    expect(await ids_('tab=UPCOMING')).toEqual([pcs.turner]);
    expect(await ids_('clientType=BUSINESS')).toEqual([pcs.davis]);
    expect(await ids_('providerKey=adp')).toEqual([pcs.turner]);
    expect(await ids_('frequency=MONTHLY')).toEqual([pcs.davis]);
    expect(await ids_('status=ON_TRACK')).toEqual([pcs.green]);
    expect(await ids_(`assignedUserId=${people.adminA.id}`)).toEqual([pcs.green]);
    expect(await ids_('syncStatus=NOT_CONNECTED')).toHaveLength(4);
    expect(await ids_('syncStatus=SYNCED')).toEqual([]);
    expect(await ids_(`nextFrom=${day(1)}&nextTo=${day(10)}`)).toEqual([pcs.turner]);
    expect(await ids_(`search=turner`)).toEqual([pcs.turner]);
    expect(await ids_(`search=davis-${run}`)).toEqual([pcs.davis]);
    expect(await ids_('sort=employees&direction=desc')).toHaveLength(4);
    expect((await ids_('sort=nextPayrollOn&direction=asc'))[0]).toBe(pcs.davis);
    const page2 = exact(
      PayrollClientPage,
      await call('get', '/clients?pageSize=3&page=2', people.ownerA),
    );
    expect(page2).toMatchObject({ total: 4, page: 2, pageSize: 3 });
    expect(page2.items).toHaveLength(1);
    expectError(
      await call('get', '/clients?pageSize=101', people.ownerA),
      400,
      'VALIDATION_FAILED',
    );
  });

  it('numbers the overview from confirmed runs only', async () => {
    const o = exact(PayrollOverview, await call('get', '/overview', people.ownerA));
    expect(o.period.key).toBe('THIS_MONTH');
    expect(o.kpis.activeClients.value).toBe(4);
    expect(o.kpis.totalProcessedCents).toEqual({
      value: 200_000,
      previous: 100_000,
      changePercent: 100,
    });
    expect(o.kpis.runs).toEqual({ value: 2, previous: 1, changePercent: 100 });
    expect(o.kpis.totalEmployees.value).toBe(25);
    expect(o.kpis.needAttention.value).toBe(1);
    expect(o.statusBreakdown.total).toBe(4);
    expect(o.statusBreakdown.items.find((i) => i.status === 'PAST_DUE')?.count).toBe(1);
    const month = new Date().toISOString().slice(0, 7);
    expect(o.volume.find((v) => v.month === month)).toEqual({
      month,
      grossCents: 200_000,
      taxesAndDeductionsCents: 2 * (20_000 + 8_000 + 5_000),
    });
    expect(o.byProvider.items).toEqual([
      { key: 'adp', label: 'ADP', grossCents: 200_000, sharePercent: 100 },
    ]);
    expect(
      o.providers
        .map((p) => p.key)
        .filter(Boolean)
        .sort(),
    ).toEqual(['adp', 'gusto', 'paychex']);
    // A client with no provider is listed as not connected, with no label of a provider.
    expect(o.providers.find((p) => p.key === null)).toMatchObject({
      label: 'Not connected',
      clientCount: 1,
      connected: false,
    });
    expect(o.upcomingRuns).toEqual([
      {
        payrollClientId: pcs.turner,
        clientName: expect.stringContaining('Turner'),
        frequency: 'WEEKLY',
        nextPayrollOn: day(5),
      },
    ]);
    const quarter = exact(
      PayrollOverview,
      await call('get', '/overview?period=THIS_YEAR', people.ownerA),
    );
    expect(quarter.kpis.totalProcessedCents.value).toBeGreaterThanOrEqual(200_000);
    expectError(
      await call('get', '/overview?period=FOREVER', people.ownerA),
      400,
      'VALIDATION_FAILED',
    );
  });

  it('shows the workspace with the latest completed run and its change against the one before', async () => {
    const pc = exact(
      PayrollClientWorkspace,
      await call('get', `/clients/${pcs.turner}`, people.ownerA),
    );
    expect(pc.latestRun).toMatchObject({
      figures: { grossCents: 100_000, netCents: 75_000, confirmed: true },
      changeVsPrevious: { grossPercent: 0, taxesPercent: 0, netPercent: 0 },
    });
    expect(pc.upcomingRuns).toEqual([]);
    const completed = exact(
      PayrollRunPage,
      await call('get', `/clients/${pcs.turner}/runs`, people.ownerA),
    );
    expect(completed.total).toBe(3);
    expect((completed.items[0]?.payDate ?? '') >= (completed.items[1]?.payDate ?? '')).toBe(true);
  });

  it('lists runs across the firm, with the upcoming and pay-date filters', async () => {
    const all = exact(PayrollRunPage, await call('get', '/runs', people.ownerA));
    expect(all.total).toBeGreaterThanOrEqual(3);
    const completed = exact(
      PayrollRunPage,
      await call('get', '/runs?status=COMPLETED', people.ownerA),
    );
    expect(completed.items.every((r) => r.status === 'COMPLETED')).toBe(true);
    const upcoming = exact(PayrollRunPage, await call('get', '/runs?upcoming=true', people.ownerA));
    expect(upcoming.items.every((r) => r.status !== 'COMPLETED')).toBe(true);
    const range = exact(
      PayrollRunPage,
      await call('get', `/runs?payFrom=${day(-400)}&payTo=${day(-300)}`, people.ownerA),
    );
    expect(range.items).toEqual([]);
    const one = exact(
      PayrollRunPage,
      await call('get', `/runs?payrollClientId=${pcs.turner}&status=COMPLETED`, people.ownerA),
    );
    expect(one.total).toBe(3);
  });

  it('exports the list as a CSV: formulas neutralised, no pay figures, audited', async () => {
    await asOwner(ids.firmA, (tx) =>
      tx.client.update({
        where: { id: clients.business },
        data: { displayName: `=HYPERLINK("x") ${run}` },
      }),
    );
    const before = await auditActionsLike('payroll.clients.exported');
    const res = await call('get', '/clients/export?sort=clientName', people.ownerA);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/csv');
    expect(res.headers['content-disposition']).toContain('attachment');
    expect(res.headers['cache-control']).toContain('no-store');
    const text = Buffer.isBuffer(res.body) ? res.body.toString('utf8') : String(res.text);
    const lines = text.trim().split('\r\n');
    expect(lines[0]).toBe(
      'Client,Client number,Provider,Frequency,Employees,Status,Next payroll date,Last run,Sync,Assigned to',
    );
    expect(lines).toHaveLength(5);
    expect(text).toContain(`"'=HYPERLINK(""x"") ${run}"`);
    expect(text).not.toMatch(/100000|1000\.00/);
    expect(await auditActionsLike('payroll.clients.exported')).toBe(before + 1);
    await asOwner(ids.firmA, (tx) =>
      tx.client.update({
        where: { id: clients.business },
        data: { displayName: `Fake Davis Consulting ${run}` },
      }),
    );
  });
});

describe('the workspace and its service actions', () => {
  let pcId = '';
  beforeAll(async () => {
    pcId = (await addClient(clients.bare, { industry: 'Retail' })).id;
  });

  it('Staff change the industry; plan, frequency, provider, assignment and schedule need Owner or Admin', async () => {
    const own = await call('patch', `/clients/${pcId}`, people.ownerA, {
      assignedUserId: people.staffA.id,
    });
    expectError(own, 409, 'CLIENT_NOT_ASSIGNED');
    await asOwner(ids.firmA, (tx) =>
      tx.client.update({ where: { id: clients.bare }, data: { assignedUserId: people.staffA.id } }),
    );
    expect(
      exact(
        PayrollClientWorkspace,
        await call('patch', `/clients/${pcId}`, people.staffA, { industry: 'Bakery' }),
      ).industry,
    ).toBe('Bakery');
    expect(
      exact(
        PayrollClientWorkspace,
        await call('patch', `/clients/${pcId}`, people.staffA, { industry: null }),
      ).industry,
    ).toBeNull();
    for (const body of [
      { frequency: 'MONTHLY' },
      { providerKey: 'gusto' },
      { assignedUserId: people.adminA.id },
      { nextPayrollOn: day(9) },
    ]) {
      expectError(await call('patch', `/clients/${pcId}`, people.staffA, body), 403, 'FORBIDDEN');
    }
    const ok = exact(
      PayrollClientWorkspace,
      await call('patch', `/clients/${pcId}`, people.ownerA, {
        frequency: 'SEMI_MONTHLY',
        providerKey: 'gusto',
        assignedUserId: people.staffA.id,
        nextPayrollOn: day(9),
      }),
    );
    expect(ok).toMatchObject({
      frequency: 'SEMI_MONTHLY',
      provider: { key: 'gusto' },
      assignedTo: { userId: people.staffA.id },
      nextPayrollOn: day(9),
      nextPayrollSource: 'schedule',
    });
    expect(
      exact(
        PayrollClientWorkspace,
        await call('patch', `/clients/${pcId}`, people.ownerA, { nextPayrollOn: null }),
      ).nextPayrollSource,
    ).toBeNull();
    expectError(
      await call('patch', `/clients/${pcId}`, people.ownerA, {}),
      400,
      'VALIDATION_FAILED',
    );
    expectError(
      await call('patch', `/clients/${pcId}`, people.ownerA, { providerKey: 'Not A Key' }),
      400,
      'VALIDATION_FAILED',
    );
  });

  it('links the Integrations connection when the provider is connected, and queues a sync', async () => {
    expectError(
      await call('post', `/clients/${pcId}/sync`, people.staffA),
      409,
      'PROVIDER_NOT_CONNECTED',
    );
    await asOwner(ids.firmA, (tx) =>
      tx.integrationConnection.create({
        data: {
          businessId: ids.firmA,
          provider: 'gusto',
          status: 'CONNECTED',
          secretRef: `fake/${run}`,
        },
      }),
    );
    const pc = exact(
      PayrollClientWorkspace,
      await call('patch', `/clients/${pcId}`, people.ownerA, { providerKey: 'gusto' }),
    );
    expect(pc.provider?.connected).toBe(true);
    expect(pc.syncStatus).toBe('NEVER');
    const queued = exact(
      PayrollSyncQueued,
      await call('post', `/clients/${pcId}/sync`, people.staffA),
      202,
    );
    expect(Date.parse(queued.requestedAt)).toBeLessThanOrEqual(Date.now());
    const after = exact(
      PayrollClientWorkspace,
      await call('get', `/clients/${pcId}`, people.staffA),
    );
    expect(after.lastSyncAttemptAt).toBe(queued.requestedAt);
    expect(after.lastSyncedAt).toBeNull();
    // A recent sync reads as synced, an old one as stale (the firm's 48 hours).
    await asOwner(ids.firmA, (tx) =>
      tx.payrollClient.update({ where: { id: pcId }, data: { lastSyncedAt: new Date() } }),
    );
    expect(
      exact(PayrollClientWorkspace, await call('get', `/clients/${pcId}`, people.staffA))
        .syncStatus,
    ).toBe('SYNCED');
    await asOwner(ids.firmA, (tx) =>
      tx.payrollClient.update({
        where: { id: pcId },
        data: { lastSyncedAt: new Date(Date.now() - 72 * 3_600_000) },
      }),
    );
    expect(
      exact(PayrollClientWorkspace, await call('get', `/clients/${pcId}`, people.staffA))
        .syncStatus,
    ).toBe('STALE');
    const stale = exact(
      PayrollClientPage,
      await call('get', '/clients?syncStatus=STALE', people.ownerA),
    );
    expect(stale.items.map((i) => i.id)).toContain(pcId);
    expect(await auditActions(pcId)).toContain('payroll.client.sync_queued');
  });

  it('status is set by Staff; pause and resume restore the earlier status; each change is in the history', async () => {
    expect(
      exact(
        PayrollClientWorkspace,
        await call('post', `/clients/${pcId}/status`, people.staffA, {
          status: 'ACTION_REQUIRED',
          reason: 'Missing time sheets',
        }),
        200,
      ).status,
    ).toBe('ACTION_REQUIRED');
    expectError(
      await call('post', `/clients/${pcId}/status`, people.staffA, { status: 'ON_HOLD' }),
      400,
      'VALIDATION_FAILED',
    );
    expectError(await call('post', `/clients/${pcId}/pause`, people.staffA, {}), 403, 'FORBIDDEN');
    const paused = exact(
      PayrollClientWorkspace,
      await call('post', `/clients/${pcId}/pause`, people.ownerA, { reason: 'Client request' }),
    );
    expect(paused.status).toBe('ON_HOLD');
    expect(paused.pausedAt).not.toBeNull();
    expectError(
      await call('post', `/clients/${pcId}/pause`, people.ownerA, {}),
      409,
      'CLIENT_STATE',
    );
    expectError(
      await call('post', `/clients/${pcId}/status`, people.staffA, { status: 'ON_TRACK' }),
      409,
      'CLIENT_STATE',
    );
    expectError(
      await call('post', `/clients/${pcId}/runs`, people.ownerA, nextRun()),
      409,
      'CLIENT_STATE',
    );
    const resumed = exact(
      PayrollClientWorkspace,
      await call('post', `/clients/${pcId}/resume`, people.ownerA),
    );
    expect(resumed).toMatchObject({ status: 'ACTION_REQUIRED', pausedAt: null });
    expectError(await call('post', `/clients/${pcId}/resume`, people.ownerA), 409, 'CLIENT_STATE');
    const history = exact(
      PayrollChangeList,
      await call('get', `/clients/${pcId}/changes?pageSize=100`, people.ownerA),
    );
    const fields = history.items.map((c) => `${c.field}:${c.oldValue}>${c.newValue}`);
    expect(fields).toContain('status:ACTION_REQUIRED>ON_HOLD');
    expect(fields).toContain('status:ON_HOLD>ACTION_REQUIRED');
    expect(
      history.items.find((c) => c.field === 'status' && c.reason === 'Client request')?.changedBy,
    ).toMatchObject({ userId: people.ownerA.id });
    const first = history.items.at(-1);
    expect(first).toMatchObject({ field: 'service', newValue: 'added' });
    const actions = await auditActions(pcId);
    expect(actions).toEqual(
      expect.arrayContaining([
        'payroll.client.status_changed',
        'payroll.client.paused',
        'payroll.client.resumed',
      ]),
    );
  });

  it('assigns, changes the frequency and the plan (Owner or Admin)', async () => {
    expectError(
      await call('post', `/clients/${pcId}/assign`, people.staffA, { assignedUserId: null }),
      403,
      'FORBIDDEN',
    );
    expect(
      exact(
        PayrollClientWorkspace,
        await call('post', `/clients/${pcId}/assign`, people.adminA, {
          assignedUserId: people.adminA.id,
        }),
      ).assignedTo,
    ).toMatchObject({ userId: people.adminA.id });
    expect(
      exact(
        PayrollClientWorkspace,
        await call('post', `/clients/${pcId}/assign`, people.adminA, { assignedUserId: null }),
      ).assignedTo,
    ).toBeNull();
    expectError(
      await call('post', `/clients/${pcId}/assign`, people.adminA, {
        assignedUserId: people.staff2A.id,
      }),
      409,
      'CLIENT_NOT_ASSIGNED',
    );
    expectError(
      await call('post', `/clients/${pcId}/assign`, people.adminA, {
        assignedUserId: people.ownerB.id,
      }),
      409,
      'NOT_A_MEMBER',
    );
    expect(
      exact(
        PayrollClientWorkspace,
        await call('post', `/clients/${pcId}/frequency`, people.adminA, { frequency: 'WEEKLY' }),
      ).frequency,
    ).toBe('WEEKLY');
    expectError(
      await call('post', `/clients/${pcId}/frequency`, people.adminA, { frequency: 'DAILY' }),
      400,
      'VALIDATION_FAILED',
    );
    expect(
      exact(
        PayrollClientWorkspace,
        await call('post', `/clients/${pcId}/plan`, people.adminA, { plan: 'Payroll Plus' }),
      ).plan,
    ).toBe('Payroll Plus');
    expect(
      exact(
        PayrollClientWorkspace,
        await call('post', `/clients/${pcId}/plan`, people.adminA, { plan: null }),
      ).plan,
    ).toBeNull();
    expectError(
      await call('post', `/clients/${pcId}/plan`, people.staffA, { plan: 'x' }),
      403,
      'FORBIDDEN',
    );
    const history = exact(
      PayrollChangeList,
      await call('get', `/clients/${pcId}/changes?pageSize=100`, people.ownerA),
    );
    expect(history.items.map((c) => c.field)).toEqual(
      expect.arrayContaining(['assignee', 'frequency', 'plan']),
    );
  });

  it('logs activities and lists them newest first', async () => {
    const a = exact(
      PayrollActivity,
      await call('post', `/clients/${pcId}/activities`, people.staffA, {
        kind: 'PAYROLL_REVIEW',
        summary: 'Reviewed the register',
        occurredAt: '2020-05-01T10:00:00Z',
      }),
      201,
    );
    expect(a).toMatchObject({ kind: 'PAYROLL_REVIEW', loggedBy: { userId: people.staffA.id } });
    await call('post', `/clients/${pcId}/activities`, people.staffA, {
      kind: 'CLIENT_CALL',
      summary: 'Called the owner',
    });
    const list = exact(
      PayrollActivityList,
      await call('get', `/clients/${pcId}/activities`, people.staffA),
    );
    expect(list.total).toBe(2);
    expect(list.items.map((i) => i.kind)).toEqual(['CLIENT_CALL', 'PAYROLL_REVIEW']);
    expectError(
      await call('post', `/clients/${pcId}/activities`, people.staffA, {
        kind: 'CLIENT_CALL',
        summary: '',
      }),
      400,
      'VALIDATION_FAILED',
    );
    expectError(
      await call('post', `/clients/${pcId}/activities`, people.staffA, {
        kind: 'NOPE',
        summary: 'x',
      }),
      400,
      'VALIDATION_FAILED',
    );
    expect(await auditActions(pcId)).toContain('payroll.activity.logged');
  });

  it('archives, and an archived payroll client changes no more', async () => {
    const archived = exact(
      PayrollClientWorkspace,
      await call('post', `/clients/${pcId}/archive`, people.ownerA, { reason: 'Done' }),
    );
    expect(archived).toMatchObject({ status: 'ARCHIVED' });
    expect(archived.archivedAt).not.toBeNull();
    expectError(
      await call('patch', `/clients/${pcId}`, people.ownerA, { industry: 'x' }),
      409,
      'CLIENT_STATE',
    );
    expectError(
      await call('post', `/clients/${pcId}/status`, people.ownerA, { status: 'ON_TRACK' }),
      409,
      'CLIENT_STATE',
    );
    expectError(
      await call('post', `/clients/${pcId}/workers`, people.ownerA, {
        displayName: 'Late Hire',
        workerType: 'FULL_TIME',
      }),
      409,
      'CLIENT_STATE',
    );
    expectError(
      await call('post', `/clients/${pcId}/runs`, people.ownerA, nextRun()),
      409,
      'CLIENT_STATE',
    );
    // Archived clients leave the default list, and show when asked for.
    const defaults = exact(
      PayrollClientPage,
      await call('get', '/clients', people.ownerA),
    ).items.map((i) => i.id);
    expect(defaults).not.toContain(pcId);
    const asked = exact(
      PayrollClientPage,
      await call('get', '/clients?status=ARCHIVED', people.ownerA),
    ).items.map((i) => i.id);
    expect(asked).toContain(pcId);
    expect(
      exact(PayrollClientWorkspace, await call('get', `/clients/${pcId}`, people.ownerA)).status,
    ).toBe('ARCHIVED');
  });

  it('removing the service archives the payroll client and cancels its engagement', async () => {
    const id = (await addClient(clients.removal)).id;
    expectError(
      await call('post', `/clients/${id}/remove-service`, people.ownerA, {}),
      400,
      'VALIDATION_FAILED',
    );
    expectError(
      await call('post', `/clients/${id}/remove-service`, people.staffA, { reason: 'x' }),
      403,
      'FORBIDDEN',
    );
    const removed = exact(
      PayrollClientWorkspace,
      await call('post', `/clients/${id}/remove-service`, people.ownerA, { reason: 'Client left' }),
    );
    expect(removed.status).toBe('ARCHIVED');
    const engagement = await asOwner(ids.firmA, (tx) =>
      tx.engagement.findFirstOrThrow({ where: { id: removed.engagementId } }),
    );
    expect(engagement).toMatchObject({ status: 'CANCELLED', cancellationReason: 'Client left' });
    expect(await auditActions(id)).toContain('payroll.client.service_removed');
  });
});

describe('Staff reach only their assigned clients', () => {
  it('another Staff member and unassigned clients are 404, in lists too', async () => {
    const pcs = exact(
      PayrollClientPage,
      await call('get', '/clients?pageSize=100', people.ownerA),
    ).items;
    const unassigned = pcs.find((p) => p.client.id === clients.unassigned);
    const assigned = pcs.find((p) => p.client.id === clients.assigned);
    expect(unassigned && assigned).toBeTruthy();
    expectError(await call('get', `/clients/${unassigned?.id}`, people.staffA), 404, 'NOT_FOUND');
    expect((await call('get', `/clients/${assigned?.id}`, people.staffA)).status).toBe(200);
    expectError(await call('get', `/clients/${assigned?.id}`, people.staff2A), 404, 'NOT_FOUND');
    for (const sub of [
      '/workers',
      '/activities',
      '/runs',
      '/changes',
      '/filings',
      '/reports',
      '/year-end',
    ]) {
      expectError(
        await call('get', `/clients/${assigned?.id}${sub}`, people.staff2A),
        404,
        'NOT_FOUND',
      );
    }
    expectError(
      await call('patch', `/clients/${assigned?.id}`, people.staff2A, { industry: 'x' }),
      404,
      'NOT_FOUND',
    );
    const mine = exact(
      PayrollClientPage,
      await call('get', '/clients?pageSize=100', people.staffA),
    ).items.map((i) => i.client.id);
    expect(mine).toContain(clients.assigned);
    expect(mine).not.toContain(clients.unassigned);
    expect(exact(PayrollClientPage, await call('get', '/clients', people.staff2A)).items).toEqual(
      [],
    );
    expect(
      exact(PayrollOverview, await call('get', '/overview', people.staff2A)).kpis.activeClients
        .value,
    ).toBe(0);
    expect(exact(PayrollRunPage, await call('get', '/runs', people.staff2A)).items).toEqual([]);
  });
});

describe('workers', () => {
  let pcId = '';
  beforeAll(async () => {
    pcId = (await addClient(clients.workers)).id;
  });

  it('adds, lists with tab counts, searches and updates workers; the rate needs a pay type', async () => {
    const ok = await mkWorker(pcId, {
      displayName: 'Jasmine Smith',
      jobTitle: 'Cook',
      department: 'Kitchen',
      startedOn: '2024-01-15',
      directDepositReady: true,
    });
    expect(ok).toMatchObject({
      displayName: 'Jasmine Smith',
      workerType: 'FULL_TIME',
      status: 'ACTIVE',
      payType: 'HOURLY',
      rateCents: 1_800,
      source: 'manual',
      lastChangeNote: 'Worker added',
    });
    await mkWorker(pcId, { displayName: 'Emily Wilson', workerType: 'PART_TIME' });
    await mkWorker(pcId, { displayName: 'Robert Johnson', status: 'ON_LEAVE' });
    await mkWorker(pcId, {
      displayName: 'Contract Carl',
      workerType: 'CONTRACTOR',
      payType: 'HOURLY',
      rateCents: 4_000,
    });
    const all = exact(
      PayrollWorkerList,
      await call('get', `/clients/${pcId}/workers`, people.staffA),
    );
    expect(all.total).toBe(4);
    expect(all.tabCounts).toEqual({
      ALL: 4,
      FULL_TIME: 2,
      PART_TIME: 1,
      ON_LEAVE: 1,
      CONTRACTORS: 1,
    });
    expect(all.items.map((w) => w.displayName)).toEqual([
      'Contract Carl',
      'Emily Wilson',
      'Jasmine Smith',
      'Robert Johnson',
    ]);
    const tab = async (t: string) =>
      exact(
        PayrollWorkerList,
        await call('get', `/clients/${pcId}/workers?tab=${t}`, people.staffA),
      ).items.map((w) => w.displayName);
    expect(await tab('PART_TIME')).toEqual(['Emily Wilson']);
    expect(await tab('ON_LEAVE')).toEqual(['Robert Johnson']);
    expect(await tab('CONTRACTORS')).toEqual(['Contract Carl']);
    expect(
      exact(
        PayrollWorkerList,
        await call('get', `/clients/${pcId}/workers?search=jasm`, people.staffA),
      ).items,
    ).toHaveLength(1);

    const updated = exact(
      PayrollWorker,
      await call('patch', `/clients/${pcId}/workers/${ok.id}`, people.staffA, {
        rateCents: 2_000,
        jobTitle: null,
      }),
    );
    expect(updated).toMatchObject({
      rateCents: 2_000,
      jobTitle: null,
      lastChangeNote: 'Pay rate updated. Job details updated',
    });
    expect(updated.lastChangeNote).not.toMatch(/2000|20\.00/);
    expectError(
      await call('patch', `/clients/${pcId}/workers/${ok.id}`, people.staffA, { payType: null }),
      400,
      'VALIDATION_FAILED',
    );
    expectError(
      await call('post', `/clients/${pcId}/workers`, people.staffA, {
        displayName: 'No Type',
        workerType: 'FULL_TIME',
        rateCents: 100,
      }),
      400,
      'VALIDATION_FAILED',
    );
    expectError(
      await call('patch', `/clients/${pcId}/workers/${randomUUID()}`, people.staffA, {
        jobTitle: 'x',
      }),
      404,
      'NOT_FOUND',
    );
    expectError(
      await call('patch', `/clients/${pcId}/workers/${ok.id}`, people.staffA, {
        ssn: '000-00-0000',
      }),
      400,
      'VALIDATION_FAILED',
    );

    // Made inactive, never deleted: hidden from the tabs, listed on request.
    exact(
      PayrollWorker,
      await call('patch', `/clients/${pcId}/workers/${ok.id}`, people.staffA, {
        status: 'INACTIVE',
        changeNote: 'Left the company',
      }),
    );
    expect(
      exact(PayrollWorkerList, await call('get', `/clients/${pcId}/workers`, people.staffA)).total,
    ).toBe(3);
    expect(
      exact(
        PayrollWorkerList,
        await call('get', `/clients/${pcId}/workers?status=INACTIVE`, people.staffA),
      ).items.map((w) => w.id),
    ).toEqual([ok.id]);
    const audit = await auditActions(ok.id);
    expect(audit).toEqual([
      'payroll.worker.added',
      'payroll.worker.updated',
      'payroll.worker.updated',
    ]);
    expect(await auditActionsLike('payroll.workers.listed')).toBeGreaterThan(0);
  });

  it("another payroll client's worker is not found under this one", async () => {
    const strangerClient = await pcOf(clients.unassigned);
    const stranger = exact(
      PayrollWorker,
      await call('post', `/clients/${strangerClient}/workers`, people.ownerA, {
        displayName: 'Fake Stranger',
        workerType: 'FULL_TIME',
      }),
      201,
    );
    expectError(
      await call('patch', `/clients/${pcId}/workers/${stranger.id}`, people.staffA, {
        jobTitle: 'x',
      }),
      404,
      'NOT_FOUND',
    );
  });
});

describe('runs: preparing, checks, review, approval and submission', () => {
  let pcId = '';
  beforeAll(async () => {
    pcId = (await addClient(clients.runs, { frequency: 'SEMI_MONTHLY' })).id;
  });

  it('needs a frequency, makes lines for the active workers and refuses a second run for the period', async () => {
    const noFreq = await pcOf(clients.other);
    expectError(
      await call('post', `/clients/${noFreq}/runs`, people.ownerA, nextRun()),
      409,
      'FREQUENCY_REQUIRED',
    );

    const worker = await mkWorker(pcId);
    const contractor = await mkWorker(pcId, { workerType: 'CONTRACTOR' });
    const away = await mkWorker(pcId, { status: 'ON_LEAVE' });
    const period = nextRun();
    const created = await mkRun(pcId, period);
    expect(created).toMatchObject({
      status: 'IN_PROGRESS',
      step: 1,
      includeContractors: true,
      frequency: expect.any(String),
      preparedBy: { userId: people.ownerA.id },
      figures: {
        grossCents: null,
        netCents: null,
        totalCostCents: null,
        employeeCount: null,
        confirmed: false,
      },
      lineCounts: { total: 2, ready: 2 },
      actions: {
        canEdit: true,
        canMarkReady: true,
        canApprove: false,
        canSubmit: false,
        canReopen: false,
      },
    });
    const lines = exact(
      PayrollLineList,
      await call('get', `/runs/${created.id}/lines`, people.staffA),
    );
    expect(lines.items.map((l) => l.worker.id).sort()).toEqual([worker.id, contractor.id].sort());
    expect(lines.items.map((l) => l.worker.id)).not.toContain(away.id);
    expect(lines.items.every((l) => l.hours === 0 && l.totalPayCents === 0)).toBe(true);
    expectError(
      await call('post', `/clients/${pcId}/runs`, people.ownerA, period),
      409,
      'RUN_EXISTS',
    );
    expectError(
      await call('post', `/clients/${pcId}/runs`, people.ownerA, {
        ...nextRun(),
        periodEnd: '2000-01-01',
        periodStart: '2040-01-01',
      }),
      400,
      'VALIDATION_FAILED',
    );

    const scheduled = await mkRun(pcId, { start: false, includeContractors: false });
    expect(scheduled).toMatchObject({
      status: 'NOT_STARTED',
      preparedBy: null,
      lineCounts: { total: 0 },
    });
    expect(await auditActions(created.id)).toContain('payroll.run.created');
  });

  it('saves pay lines: totals are computed, figures follow, nothing is invented', async () => {
    const worker = await mkWorker(pcId, { displayName: 'Marcus Davis' });
    const created = await mkRun(pcId, { includeContractors: true });
    const grid = exact(
      PayrollLineList,
      await call('put', `/runs/${created.id}/lines`, people.staffA, {
        lines: [
          {
            workerId: worker.id,
            hours: 80,
            regularPayCents: 160_000,
            overtimePayCents: 12_000,
            otherEarningsCents: 5_000,
            deductionsCents: 31_020,
            note: 'Adjusted per time sheet',
          },
        ],
      }),
    );
    expect(grid.items.find((l) => l.worker.id === worker.id)).toMatchObject({
      hours: 80,
      regularPayCents: 160_000,
      overtimePayCents: 12_000,
      otherEarningsCents: 5_000,
      deductionsCents: 31_020,
      totalPayCents: 145_980,
      status: 'READY',
      note: 'Adjusted per time sheet',
    });
    const detail = exact(PayrollRun, await call('get', `/runs/${created.id}`, people.staffA));
    // No taxes supplied: gross follows the lines; net, employer costs and total cost stay empty.
    expect(detail.figures).toMatchObject({
      regularPayCents: 160_000,
      overtimePayCents: 12_000,
      otherEarningsCents: 5_000,
      grossCents: 177_000,
      deductionsCents: 31_020,
      netCents: null,
      employerCostsCents: null,
      totalCostCents: null,
      confirmed: false,
    });
    const taxes = exact(
      PayrollRun,
      await call('patch', `/runs/${created.id}`, people.staffA, {
        employeeTaxesCents: 40_000,
        employerTaxesCents: 14_000,
        employerBenefitsCents: 6_000,
        step: 4,
      }),
    );
    expect(taxes.step).toBe(4);
    expect(taxes.figures).toMatchObject({
      netCents: 177_000 - 40_000 - 31_020,
      employerCostsCents: 20_000,
      totalCostCents: 197_000,
    });
    expectError(
      await call('patch', `/runs/${created.id}`, people.staffA, { employeeTaxesCents: 900_000 }),
      400,
      'VALIDATION_FAILED',
    );
    expect(
      exact(
        PayrollRun,
        await call('patch', `/runs/${created.id}`, people.staffA, { employerBenefitsCents: null }),
      ).figures.employerCostsCents,
    ).toBeNull();
    // Validation and ownership.
    expectError(
      await call('put', `/runs/${created.id}/lines`, people.staffA, { lines: [] }),
      400,
      'VALIDATION_FAILED',
    );
    expectError(
      await call('put', `/runs/${created.id}/lines`, people.staffA, {
        lines: [{ workerId: worker.id, hours: -1, regularPayCents: 1 }],
      }),
      400,
      'VALIDATION_FAILED',
    );
    expectError(
      await call('put', `/runs/${created.id}/lines`, people.staffA, {
        lines: [
          { workerId: worker.id, hours: 1, regularPayCents: 1 },
          { workerId: worker.id, hours: 1, regularPayCents: 1 },
        ],
      }),
      400,
      'VALIDATION_FAILED',
    );
    expectError(
      await call('put', `/runs/${created.id}/lines`, people.staffA, {
        lines: [{ workerId: randomUUID(), hours: 1, regularPayCents: 1 }],
      }),
      409,
      'NOT_THIS_CLIENTS',
    );
    expectError(
      await call('patch', `/runs/${created.id}`, people.staffA, { periodStart: '2040-02-02' }),
      400,
      'VALIDATION_FAILED',
    );
    // Filters on the grid.
    expect(
      exact(
        PayrollLineList,
        await call('get', `/runs/${created.id}/lines?search=marcus`, people.staffA),
      ).total,
    ).toBe(1);
    expect(
      exact(
        PayrollLineList,
        await call('get', `/runs/${created.id}/lines?tab=CONTRACTORS`, people.staffA),
      ).items.every((l) => l.worker.workerType === 'CONTRACTOR'),
    ).toBe(true);
    expect(
      exact(
        PayrollLineList,
        await call('get', `/runs/${created.id}/lines?status=WARNING`, people.staffA),
      ).items,
    ).toEqual([]);
    expect(await auditActions(created.id)).toEqual(
      expect.arrayContaining(['payroll.run.lines_saved', 'payroll.run.updated']),
    );
  });

  it('excluded lines and left-out contractors count for nothing', async () => {
    const a = await mkWorker(pcId);
    const c = await mkWorker(pcId, { workerType: 'CONTRACTOR' });
    const created = await mkRun(pcId);
    await call('put', `/runs/${created.id}/lines`, people.staffA, {
      lines: [
        { workerId: a.id, hours: 10, regularPayCents: 10_000 },
        { workerId: c.id, hours: 10, regularPayCents: 5_000 },
      ],
    });
    expect(
      exact(PayrollRun, await call('get', `/runs/${created.id}`, people.staffA)).figures.grossCents,
    ).toBe(15_000);
    expect(
      exact(
        PayrollRun,
        await call('patch', `/runs/${created.id}`, people.staffA, { includeContractors: false }),
      ).figures,
    ).toMatchObject({ grossCents: 10_000, employeeCount: expect.any(Number) });
    await call('put', `/runs/${created.id}/lines`, people.staffA, {
      lines: [{ workerId: a.id, hours: 10, regularPayCents: 10_000, status: 'EXCLUDED' }],
    });
    expect(
      exact(PayrollRun, await call('get', `/runs/${created.id}`, people.staffA)).figures.grossCents,
    ).toBeNull();
  });

  it('runs the firm checks: warnings are kept, an unresolved error blocks approval', async () => {
    const worker = await mkWorker(pcId, { directDepositReady: false });
    const created = await mkRun(pcId);
    await call('put', `/runs/${created.id}/lines`, people.staffA, {
      lines: [
        { workerId: worker.id, hours: 80, regularPayCents: 100_000, overtimePayCents: 5_000 },
      ],
    });
    const found = exact(
      PayrollIssueList,
      await call('post', `/runs/${created.id}/issues/check`, people.staffA),
      200,
    );
    expect(found.items.map((i) => i.code).sort()).toEqual([
      'bank_validation_missing',
      'overtime_review',
    ]);
    expect(
      found.items.every(
        (i) =>
          i.severity === 'WARNING' && i.resolvedAt === null && i.workerName === worker.displayName,
      ),
    ).toBe(true);
    // Running it again adds nothing.
    expect(
      exact(PayrollIssueList, await call('post', `/runs/${created.id}/issues/check`, people.staffA))
        .items,
    ).toHaveLength(2);
    const detail = exact(PayrollRun, await call('get', `/runs/${created.id}`, people.staffA));
    expect(detail.issueCounts).toEqual({ info: 0, warning: 2, error: 0 });

    const bank = found.items.find((i) => i.code === 'bank_validation_missing');
    const resolved = exact(
      PayrollIssue,
      await call('patch', `/runs/${created.id}/issues/${bank?.id}`, people.staffA, {
        resolved: true,
      }),
    );
    expect(resolved).toMatchObject({ resolvedBy: { userId: people.staffA.id } });
    expect(resolved.resolvedAt).not.toBeNull();
    expect(
      exact(
        PayrollIssueList,
        await call('get', `/runs/${created.id}/issues?open=true`, people.staffA),
      ).items,
    ).toHaveLength(1);
    expect(
      exact(
        PayrollIssueList,
        await call('get', `/runs/${created.id}/issues?open=false`, people.staffA),
      ).items,
    ).toHaveLength(1);
    expect(
      exact(
        PayrollIssueList,
        await call('get', `/runs/${created.id}/issues?severity=ERROR`, people.staffA),
      ).items,
    ).toEqual([]);
    expect(
      exact(
        PayrollIssue,
        await call('patch', `/runs/${created.id}/issues/${bank?.id}`, people.staffA, {
          resolved: false,
        }),
      ).resolvedAt,
    ).toBeNull();
    expectError(
      await call('patch', `/runs/${created.id}/issues/${randomUUID()}`, people.staffA, {
        resolved: true,
      }),
      404,
      'NOT_FOUND',
    );

    // An inactive worker who is paid is an error that blocks the approval.
    await call('patch', `/clients/${pcId}/workers/${worker.id}`, people.staffA, {
      status: 'INACTIVE',
    });
    const blocked = exact(
      PayrollIssueList,
      await call('post', `/runs/${created.id}/issues/check`, people.staffA),
    );
    const error = blocked.items.find((i) => i.severity === 'ERROR');
    expect(error?.code).toBe('worker_not_active');
    await call('post', `/runs/${created.id}/ready`, people.staffA);
    expectError(
      await call('post', `/runs/${created.id}/approve`, people.ownerA),
      409,
      'RUN_BLOCKED',
    );
    expect(exact(PayrollRun, await call('get', `/runs/${created.id}`, people.ownerA)).status).toBe(
      'READY_FOR_REVIEW',
    );
    exact(
      PayrollIssue,
      await call('patch', `/runs/${created.id}/issues/${error?.id}`, people.staffA, {
        resolved: true,
      }),
    );
    const approved = exact(
      PayrollRun,
      await call('post', `/runs/${created.id}/approve`, people.ownerA),
    );
    expect(approved.status).toBe('APPROVED');
  });

  it('a line in error blocks approval too', async () => {
    const worker = await mkWorker(pcId);
    const created = await mkRun(pcId);
    await call('put', `/runs/${created.id}/lines`, people.staffA, {
      lines: [
        {
          workerId: worker.id,
          hours: 10,
          regularPayCents: 10_000,
          status: 'ERROR',
          note: 'Hours look wrong',
        },
      ],
    });
    expect(
      exact(PayrollRun, await call('get', `/runs/${created.id}`, people.staffA)).lineCounts.error,
    ).toBe(1);
    await call('post', `/runs/${created.id}/ready`, people.staffA);
    expectError(
      await call('post', `/runs/${created.id}/approve`, people.ownerA),
      409,
      'RUN_BLOCKED',
    );
  });

  it('walks save draft, ready, approve, submit, complete; approval and submission are separate and Owner or Admin only', async () => {
    const { run: created } = await preparedRun(pcId);
    expect(
      exact(PayrollRun, await call('post', `/runs/${created.id}/save-draft`, people.staffA)).status,
    ).toBe('DRAFT');
    expect(
      exact(PayrollRun, await call('post', `/runs/${created.id}/save-draft`, people.staffA)).status,
    ).toBe('DRAFT');
    expectError(await call('post', `/runs/${created.id}/approve`, people.ownerA), 409, 'RUN_STATE');
    // From a draft, straight to ready (through In Progress).
    const ready = exact(PayrollRun, await call('post', `/runs/${created.id}/ready`, people.staffA));
    expect(ready).toMatchObject({
      status: 'READY_FOR_REVIEW',
      step: 5,
      actions: { canEdit: false, canMarkReady: false, canApprove: false },
    });
    expect(ready.readyAt).not.toBeNull();
    expect(ready.figures.grossCents).toBe(144_000);
    expectError(await call('post', `/runs/${created.id}/ready`, people.staffA), 409, 'RUN_STATE');
    expectError(
      await call('patch', `/runs/${created.id}`, people.staffA, { step: 2 }),
      409,
      'RUN_STATE',
    );
    expectError(
      await call('put', `/runs/${created.id}/lines`, people.staffA, {
        lines: [{ workerId: randomUUID(), hours: 1, regularPayCents: 1 }],
      }),
      409,
      'RUN_STATE',
    );

    for (const [action, body] of [
      ['approve', undefined],
      ['submit', { providerConfirmation: 'FAKE-1' }],
      ['complete', {}],
      ['reopen', { reason: 'x' }],
    ] as const) {
      expectError(
        await call('post', `/runs/${created.id}/${action}`, people.staffA, body),
        403,
        'FORBIDDEN',
      );
    }
    expect(
      exact(PayrollRun, await call('get', `/runs/${created.id}`, people.ownerA)).actions,
    ).toMatchObject({ canApprove: true, canReopen: true, canSubmit: false });

    const approved = exact(
      PayrollRun,
      await call('post', `/runs/${created.id}/approve`, people.adminA),
    );
    expect(approved).toMatchObject({
      status: 'APPROVED',
      approvedBy: { userId: people.adminA.id },
      actions: { canSubmit: true, canApprove: false },
    });
    expectError(await call('post', `/runs/${created.id}/approve`, people.adminA), 409, 'RUN_STATE');
    expectError(
      await call('post', `/runs/${created.id}/submit`, people.ownerA, {}),
      400,
      'VALIDATION_FAILED',
    );
    expectError(
      await call('post', `/runs/${created.id}/complete`, people.ownerA, {}),
      409,
      'RUN_STATE',
    );

    const submitted = exact(
      PayrollRun,
      await call('post', `/runs/${created.id}/submit`, people.ownerA, {
        providerConfirmation: 'FAKE-REF-42',
      }),
    );
    expect(submitted).toMatchObject({
      status: 'SUBMITTED',
      providerConfirmation: 'FAKE-REF-42',
      providerStatus: 'submitted',
      submittedBy: { userId: people.ownerA.id },
    });
    expect(submitted.figures.confirmed).toBe(true);
    const done = exact(
      PayrollRun,
      await call('post', `/runs/${created.id}/complete`, people.ownerA, { providerStatus: 'paid' }),
    );
    expect(done).toMatchObject({ status: 'COMPLETED', providerStatus: 'paid' });
    expect(done.completedAt).not.toBeNull();
    const pc = exact(PayrollClientWorkspace, await call('get', `/clients/${pcId}`, people.ownerA));
    expect(pc.lastRunOn).toBe(done.payDate);

    // A completed run never changes.
    expectError(
      await call('patch', `/runs/${created.id}`, people.ownerA, { step: 2 }),
      409,
      'RUN_STATE',
    );
    expectError(
      await call('post', `/runs/${created.id}/reopen`, people.ownerA, { reason: 'Oops' }),
      409,
      'RUN_STATE',
    );
    expectError(
      await call('post', `/runs/${created.id}/issues/check`, people.ownerA),
      409,
      'RUN_STATE',
    );
    expect(await auditActions(created.id)).toEqual(
      expect.arrayContaining([
        'payroll.run.draft_saved',
        'payroll.run.marked_ready',
        'payroll.run.approved',
        'payroll.run.submitted',
        'payroll.run.completed',
      ]),
    );
  });

  it('marking ready needs a line that counts', async () => {
    const empty = await mkRun(pcId, { start: false });
    expectError(await call('post', `/runs/${empty.id}/ready`, people.staffA), 409, 'RUN_EMPTY');
    expect(
      exact(PayrollRun, await call('get', `/runs/${empty.id}`, people.staffA)).actions.canMarkReady,
    ).toBe(false);
  });

  it('reopens a run in review with a reason; it needs a new approval', async () => {
    const { run: created } = await preparedRun(pcId);
    await call('post', `/runs/${created.id}/ready`, people.staffA);
    expectError(
      await call('post', `/runs/${created.id}/reopen`, people.ownerA, {}),
      400,
      'VALIDATION_FAILED',
    );
    const reopened = exact(
      PayrollRun,
      await call('post', `/runs/${created.id}/reopen`, people.ownerA, {
        reason: 'Hours were wrong',
      }),
    );
    expect(reopened).toMatchObject({
      status: 'IN_PROGRESS',
      reopenReason: 'Hours were wrong',
      readyAt: null,
      approvedAt: null,
      step: 4,
    });
    expect(reopened.reopenedAt).not.toBeNull();
    expectError(
      await call('post', `/runs/${created.id}/reopen`, people.ownerA, { reason: 'Again' }),
      409,
      'RUN_STATE',
    );
    await call('post', `/runs/${created.id}/ready`, people.staffA);
    await call('post', `/runs/${created.id}/approve`, people.ownerA);
    expect(
      exact(
        PayrollRun,
        await call('post', `/runs/${created.id}/reopen`, people.ownerA, {
          reason: 'After approval',
        }),
      ).status,
    ).toBe('IN_PROGRESS');
    expect(await auditActions(created.id)).toContain('payroll.run.reopened');
  });

  it('the run detail lists the last completed runs and exports the lines as a CSV', async () => {
    const worker = await mkWorker(pcId, { displayName: '=cmd|calc' });
    const created = await mkRun(pcId);
    await call('put', `/runs/${created.id}/lines`, people.staffA, {
      lines: [{ workerId: worker.id, hours: 8, regularPayCents: 12_345, deductionsCents: 345 }],
    });
    const detail = exact(PayrollRun, await call('get', `/runs/${created.id}`, people.staffA));
    expect(detail.recentRuns.every((r) => r.status === 'COMPLETED')).toBe(true);
    expect(detail.client.id).toBe(clients.runs);
    expect(detail.provider).toBeNull();
    const res = await call('get', `/runs/${created.id}/export`, people.staffA);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/csv');
    expect(res.headers['content-disposition']).toContain('attachment');
    const text = Buffer.isBuffer(res.body) ? res.body.toString('utf8') : String(res.text);
    expect(text).toContain(
      'Employee,Type,Hours,Regular pay,Overtime,Other earnings,Deductions,Total pay,Status',
    );
    expect(text).toContain("'=cmd|calc,FULL_TIME,8,123.45,0.00,0.00,3.45,120.00,READY");
    expect(await auditActions(created.id)).toContain('payroll.run.exported');
  });
});

describe('filings, reports and year-end', () => {
  let pcId = '';
  beforeAll(async () => {
    pcId = (await addClient(clients.records, { frequency: 'MONTHLY' })).id;
  });

  it('shows filings only as the provider or an import confirmed them; with none, an empty list', async () => {
    expect(
      exact(PayrollFilingList, await call('get', `/clients/${pcId}/filings`, people.staffA)),
    ).toEqual({
      items: [],
      counts: { upcoming: 0, filed: 0, needsAttention: 0 },
    });
    const at = new Date('2030-07-01T00:00:00Z');
    await asOwner(ids.firmA, async (tx) => {
      const base = {
        businessId: ids.firmA,
        payrollClientId: pcId,
        jurisdiction: 'federal',
        periodStart: new Date('2030-04-01'),
        periodEnd: new Date('2030-06-30'),
      };
      await tx.payrollFiling.create({
        data: {
          ...base,
          form: '941',
          dueOn: new Date('2030-07-31'),
          status: 'FILED',
          paymentStatus: 'PAID',
          source: 'provider',
          sourceSyncedAt: at,
          confirmedAt: at,
          confirmationRef: 'FAKE-941',
        },
      });
      await tx.payrollFiling.create({
        data: { ...base, form: '940', dueOn: new Date('2031-01-31'), status: 'UPCOMING' },
      });
      await tx.payrollFiling.create({
        data: { ...base, form: 'W-2', jurisdiction: 'NY', dueOn: null, status: 'NEEDS_ATTENTION' },
      });
      await tx.payrollFiling.create({
        data: {
          ...base,
          form: 'W-3',
          periodStart: new Date('2029-01-01'),
          periodEnd: new Date('2029-12-31'),
        },
      });
    });
    const list = exact(
      PayrollFilingList,
      await call('get', `/clients/${pcId}/filings`, people.staffA),
    );
    expect(list.counts).toEqual({ upcoming: 1, filed: 1, needsAttention: 1 });
    expect(list.items.map((f) => f.form).sort()).toEqual(['940', '941', 'W-2', 'W-3']);
    // Soonest due date first, no date last.
    expect(list.items.at(-1)?.dueOn).toBeNull();
    const filed = list.items.find((f) => f.form === '941');
    expect(filed).toMatchObject({
      status: 'FILED',
      paymentStatus: 'PAID',
      source: 'provider',
      confirmationRef: 'FAKE-941',
      dueOn: '2030-07-31',
    });
    // Nothing is inferred: a filing nobody confirmed is UNKNOWN.
    expect(list.items.find((f) => f.form === 'W-3')).toMatchObject({
      status: 'UNKNOWN',
      paymentStatus: 'UNKNOWN',
      source: null,
      confirmedAt: null,
    });
    expect(
      exact(
        PayrollFilingList,
        await call('get', `/clients/${pcId}/filings?status=FILED`, people.staffA),
      ).items,
    ).toHaveLength(1);
    expect(
      exact(
        PayrollFilingList,
        await call('get', `/clients/${pcId}/filings?year=2029`, people.staffA),
      ).items.map((f) => f.form),
    ).toEqual(['W-3']);
    expectError(
      await call('get', `/clients/${pcId}/filings?status=DONE`, people.staffA),
      400,
      'VALIDATION_FAILED',
    );
  });

  it('adds provider reports from the vault as versions and lists them', async () => {
    const doc = await asOwner(ids.firmA, async (tx) => {
      const tag = randomUUID();
      const make = (clientId: string, engagementId: string) =>
        tx.document.create({
          data: {
            businessId: ids.firmA,
            clientId,
            engagementId,
            direction: 'FIRM_TO_CLIENT',
            fileName: 'register.pdf',
            contentType: 'application/pdf',
            sizeBytes: 100,
            sha256: createHash('sha256').update(`${tag}${clientId}`).digest('hex'),
            s3Key: `tenant/${ids.firmA}/p/${tag}/${clientId}.pdf`,
          },
        });
      const engagementOf = async (clientId: string) =>
        (await tx.payrollClient.findFirstOrThrow({ where: { clientId } })).engagementId;
      return {
        mine: await make(clients.records, await engagementOf(clients.records)),
        others: await make(clients.unassigned, await engagementOf(clients.unassigned)),
      };
    });
    expect(
      exact(PayrollReportList, await call('get', `/clients/${pcId}/reports`, people.staffA)).items,
    ).toEqual([]);
    const body = {
      kind: 'REGISTER',
      periodStart: '2030-04-01',
      periodEnd: '2030-04-15',
      documentId: doc.mine.id,
    };
    const v1 = exact(
      PayrollReport,
      await call('post', `/clients/${pcId}/reports`, people.staffA, body),
      201,
    );
    expect(v1).toMatchObject({
      kind: 'REGISTER',
      version: 1,
      source: 'import',
      documentId: doc.mine.id,
      requestedBy: { userId: people.staffA.id },
      runId: null,
    });
    const v2 = exact(
      PayrollReport,
      await call('post', `/clients/${pcId}/reports`, people.staffA, body),
      201,
    );
    expect(v2.version).toBe(2);
    await call('post', `/clients/${pcId}/reports`, people.staffA, { ...body, kind: 'EARNINGS' });
    const list = exact(
      PayrollReportList,
      await call('get', `/clients/${pcId}/reports`, people.staffA),
    );
    expect(list.total).toBe(3);
    expect(
      exact(
        PayrollReportList,
        await call('get', `/clients/${pcId}/reports?kind=REGISTER`, people.staffA),
      )
        .items.map((r) => r.version)
        .sort(),
    ).toEqual([1, 2]);
    // Only this client's own vault files, and this client's own runs.
    expectError(
      await call('post', `/clients/${pcId}/reports`, people.staffA, {
        ...body,
        documentId: doc.others.id,
      }),
      409,
      'NOT_THIS_CLIENTS',
    );
    expectError(
      await call('post', `/clients/${pcId}/reports`, people.staffA, {
        ...body,
        documentId: randomUUID(),
      }),
      409,
      'NOT_THIS_CLIENTS',
    );
    expectError(
      await call('post', `/clients/${pcId}/reports`, people.staffA, {
        ...body,
        runId: randomUUID(),
      }),
      409,
      'NOT_THIS_CLIENTS',
    );
    expectError(
      await call('post', `/clients/${pcId}/reports`, people.staffA, {
        ...body,
        periodEnd: '2030-03-01',
      }),
      400,
      'VALIDATION_FAILED',
    );
    const run1 = await mkRun(pcId);
    const withRun = exact(
      PayrollReport,
      await call('post', `/clients/${pcId}/reports`, people.staffA, {
        ...body,
        kind: 'JOURNAL',
        runId: run1.id,
      }),
      201,
    );
    expect(withRun.runId).toBe(run1.id);
    expect(
      exact(
        PayrollReportList,
        await call('get', `/clients/${pcId}/reports?runId=${run1.id}`, people.staffA),
      ).total,
    ).toBe(1);
    expect(await auditActions(v1.id)).toEqual(['payroll.report.added']);
  });

  it('tracks the year-end checklist; delivery needs reconciliation', async () => {
    const empty = exact(
      PayrollYearEnd,
      await call('get', `/clients/${pcId}/year-end?taxYear=2030`, people.staffA),
    );
    expect(empty).toMatchObject({
      taxYear: 2030,
      status: 'NOT_STARTED',
      exceptionsNote: null,
      deliveredAt: null,
      updatedAt: null,
    });
    expect(empty.items.map((i) => i.step)).toEqual([
      'WORKER_REVIEW',
      'MISSING_INFORMATION',
      'W2_W3',
      'FORM_1099',
      'RECONCILIATION',
      'CLIENT_DELIVERY',
    ]);
    expect(empty.items.every((i) => i.state === 'NOT_STARTED')).toBe(true);
    expect(
      exact(PayrollYearEnd, await call('get', `/clients/${pcId}/year-end`, people.staffA)).taxYear,
    ).toBe(new Date().getUTCFullYear() - 1);

    const started = exact(
      PayrollYearEnd,
      await call('put', `/clients/${pcId}/year-end/2030`, people.staffA, {
        items: [
          { step: 'WORKER_REVIEW', state: 'DONE' },
          { step: 'W2_W3', state: 'IN_PROGRESS' },
        ],
        exceptionsNote: 'Two workers missing addresses',
      }),
    );
    expect(started).toMatchObject({
      status: 'IN_PROGRESS',
      exceptionsNote: 'Two workers missing addresses',
    });
    expect(started.items.find((i) => i.step === 'WORKER_REVIEW')?.state).toBe('DONE');
    expectError(
      await call('put', `/clients/${pcId}/year-end/2030`, people.staffA, {
        items: [{ step: 'CLIENT_DELIVERY', state: 'DONE' }],
      }),
      400,
      'VALIDATION_FAILED',
    );
    expect(
      exact(
        PayrollYearEnd,
        await call('put', `/clients/${pcId}/year-end/2030`, people.staffA, {
          items: [{ step: 'RECONCILIATION', state: 'DONE' }],
        }),
      ).status,
    ).toBe('RECONCILED');
    const delivered = exact(
      PayrollYearEnd,
      await call('put', `/clients/${pcId}/year-end/2030`, people.staffA, {
        items: [{ step: 'CLIENT_DELIVERY', state: 'DONE' }],
        exceptionsNote: null,
      }),
    );
    expect(delivered).toMatchObject({
      status: 'DELIVERED',
      exceptionsNote: null,
      deliveredBy: { userId: people.staffA.id },
    });
    expect(delivered.deliveredAt).not.toBeNull();
    expect(delivered.reconciledAt).not.toBeNull();
    // Reopening a step walks the status back; the delivery stamp goes with it.
    const back = exact(
      PayrollYearEnd,
      await call('put', `/clients/${pcId}/year-end/2030`, people.staffA, {
        items: [
          { step: 'CLIENT_DELIVERY', state: 'NOT_STARTED' },
          { step: 'RECONCILIATION', state: 'IN_PROGRESS' },
        ],
      }),
    );
    expect(back).toMatchObject({
      status: 'IN_PROGRESS',
      deliveredAt: null,
      reconciledAt: null,
      deliveredBy: null,
    });
    expectError(
      await call('put', `/clients/${pcId}/year-end/2030`, people.staffA, {}),
      400,
      'VALIDATION_FAILED',
    );
    expectError(
      await call('put', `/clients/${pcId}/year-end/1900`, people.staffA, { exceptionsNote: 'x' }),
      400,
      'VALIDATION_FAILED',
    );
    expectError(
      await call('put', `/clients/${pcId}/year-end/2030`, people.staffA, {
        items: [{ step: 'NOPE', state: 'DONE' }],
      }),
      400,
      'VALIDATION_FAILED',
    );
    expect(await auditActionsLike('payroll.year_end.saved')).toBeGreaterThan(0);
  });
});

describe('settings', () => {
  it('shows the defaults until the firm saves its own; Owner and Admin save', async () => {
    const before = exact(
      PayrollSettings,
      await call('get', '/settings', people.ownerB, undefined, ids.firmB),
    );
    expect(before).toEqual({
      defaultAssignee: null,
      reminderDaysBefore: 3,
      staleAfterHours: 48,
      updatedAt: null,
    });
    const saved = exact(
      PayrollSettings,
      await call('put', '/settings', people.adminA, {
        defaultAssigneeId: people.adminA.id,
        reminderDaysBefore: 5,
        staleAfterHours: 24,
      }),
    );
    expect(saved).toMatchObject({
      defaultAssignee: { userId: people.adminA.id },
      reminderDaysBefore: 5,
      staleAfterHours: 24,
    });
    expect(saved.updatedAt).not.toBeNull();
    expect(exact(PayrollSettings, await call('get', '/settings', people.ownerA))).toEqual(saved);
    // The stale window drives the sync status.
    expect(
      exact(
        PayrollSettings,
        await call('put', '/settings', people.ownerA, {
          defaultAssigneeId: null,
          reminderDaysBefore: 0,
          staleAfterHours: 720,
        }),
      ).defaultAssignee,
    ).toBeNull();
    expectError(
      await call('put', '/settings', people.ownerA, {
        defaultAssigneeId: people.ownerB.id,
        reminderDaysBefore: 3,
        staleAfterHours: 48,
      }),
      400,
      'VALIDATION_FAILED',
    );
    expectError(
      await call('put', '/settings', people.ownerA, {
        defaultAssigneeId: null,
        reminderDaysBefore: 31,
        staleAfterHours: 48,
      }),
      400,
      'VALIDATION_FAILED',
    );
    expectError(
      await call('put', '/settings', people.ownerA, {
        defaultAssigneeId: null,
        reminderDaysBefore: 3,
        staleAfterHours: 0,
      }),
      400,
      'VALIDATION_FAILED',
    );
    expectError(
      await call('put', '/settings', people.ownerA, { reminderDaysBefore: 3, staleAfterHours: 48 }),
      400,
      'VALIDATION_FAILED',
    );
    expect(await auditActionsLike('payroll.settings.updated')).toBeGreaterThanOrEqual(2);
    // A default assignee is used for new payroll clients.
    await call('put', '/settings', people.ownerA, {
      defaultAssigneeId: people.adminA.id,
      reminderDaysBefore: 3,
      staleAfterHours: 48,
    });
  });
});

describe('firm B never reaches firm A payroll', () => {
  it('every record of firm A is 404 for firm B, and firm B sees none of it in lists', async () => {
    const a = exact(PayrollClientPage, await call('get', '/clients?pageSize=100', people.ownerA))
      .items[0];
    expect(a).toBeTruthy();
    const runA = exact(PayrollRunPage, await call('get', '/runs', people.ownerA)).items[0];
    expect(runA).toBeTruthy();
    const asB = (method: 'get' | 'post' | 'patch' | 'put', path: string, body?: object) =>
      call(method, path, people.ownerB, body, ids.firmB);
    for (const [method, path, body] of [
      ['get', `/clients/${a?.id}`],
      ['patch', `/clients/${a?.id}`, { industry: 'x' }],
      ['post', `/clients/${a?.id}/status`, { status: 'ON_TRACK' }],
      ['post', `/clients/${a?.id}/pause`, {}],
      ['post', `/clients/${a?.id}/archive`, {}],
      ['post', `/clients/${a?.id}/sync`],
      ['get', `/clients/${a?.id}/workers`],
      ['post', `/clients/${a?.id}/workers`, { displayName: 'Intruder', workerType: 'FULL_TIME' }],
      ['get', `/clients/${a?.id}/runs`],
      ['post', `/clients/${a?.id}/runs`, nextRun()],
      ['get', `/clients/${a?.id}/activities`],
      ['get', `/clients/${a?.id}/filings`],
      ['get', `/clients/${a?.id}/reports`],
      ['get', `/clients/${a?.id}/year-end`],
      ['get', `/runs/${runA?.id}`],
      ['get', `/runs/${runA?.id}/lines`],
      ['get', `/runs/${runA?.id}/export`],
      ['post', `/runs/${runA?.id}/approve`],
    ] as const) {
      const res = await asB(method, path, body);
      expect([method, path, res.status]).toEqual([method, path, 404]);
    }
    expect(exact(PayrollClientPage, await asB('get', '/clients')).items).toEqual([]);
    expect(exact(PayrollRunPage, await asB('get', '/runs')).items).toEqual([]);
    expect(exact(PayrollOverview, await asB('get', '/overview')).kpis.activeClients.value).toBe(0);
    // And a row of firm A is invisible in firm B's database scope.
    const leaked = await asOwner(ids.firmB, (tx) =>
      tx.payrollClient.count({ where: { businessId: ids.firmB } }),
    );
    expect(leaked).toBe(0);
  });
});
