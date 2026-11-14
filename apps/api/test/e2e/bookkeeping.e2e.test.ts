// End-to-end: the firm's Bookkeeping module (R38 Bookkeeping API; contract in
// packages/types/src/bookkeeping): overview, bookkeeping clients and their service actions,
// connections and syncs, accounts, periods with the close workflow, reconciliations, reports,
// settings and the CSV exports. Owner and Admin manage; Staff prepare the clients assigned to
// them; firm B never reads or changes firm A's books, and every action writes an audit row.
// Synthetic data only.
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
  BookkeepingAccount,
  BookkeepingAccountList,
  BookkeepingActivity,
  BookkeepingActivityList,
  BookkeepingClientPage,
  BookkeepingClientWorkspace,
  BookkeepingTransactionPage,
  BookkeepingReportPreview,
  BookkeepingReportVersionList,
  BookkeepingReportVersionRow,
  BookkeepingTransactionRow,
  BookkeepingTransferCandidates,
  BulkBookkeepingTransactionsResult,
  BookkeepingCategoryList,
  BookkeepingConnection,
  BookkeepingConnectionList,
  BookkeepingOverview,
  BookkeepingPeriod,
  BookkeepingPeriodList,
  BookkeepingReconciliation,
  BookkeepingReconciliationItems,
  BookkeepingReconciliationList,
  BookkeepingReportPage,
  BookkeepingReportRow,
  BookkeepingSettings,
  BookkeepingStatusRefreshed,
  BookkeepingSyncQueued,
  BookkeepingSyncRunList,
  DEFAULT_CLOSE_CHECKLIST,
} from '@firmivra/types';
import { AppModule } from '../../src/app.module.js';
import { configureApp } from '../../src/configure-app.js';
import { loadEnv } from '../../src/config/env.js';

const fx = inject('fixtures');
const run = randomUUID().slice(0, 8);
const person = (key: string) => ({ id: randomUUID(), email: `r38b-${key}-${run}@r38.test` });
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
  conn: '',
  close: '',
  recon: '',
  reports: '',
  rules: '',
  ledger: '',
  pnl: '',
};

let app: INestApplication;
const tokens = new Map<string, string>();
let viewers = 0;
/** A new viewer IP per call, so no test meets the per-IP rate limit. */
const viewer = () => {
  viewers += 1;
  return `198.54.${Math.floor(viewers / 250)}.${(viewers % 250) + 1}, 10.0.0.5`;
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
    [method](`/api/v1/business/bookkeeping${path}`)
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

const day = (offset = 0, from = new Date()) =>
  new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate() + offset))
    .toISOString()
    .slice(0, 10);

/** A month of 2040 or later no other test uses: one period per start and end of a client. */
let months = 0;
const nextMonth = () => {
  months += 1;
  const year = 2040 + Math.floor(months / 12);
  const m = (months % 12) + 1;
  const mm = String(m).padStart(2, '0');
  const last = new Date(Date.UTC(year, m, 0)).getUTCDate();
  return { periodStart: `${year}-${mm}-01`, periodEnd: `${year}-${mm}-${last}`, kind: 'MONTH' };
};

const addClient = async (clientId: string, body: object = {}, who: Who = people.ownerA) =>
  exact(
    BookkeepingClientWorkspace,
    await call('post', '/clients', who, { clientId, ...body }, ids.firmA),
    201,
  );
/** The bookkeeping client id of a client already on bookkeeping. */
const bkOf = async (clientId: string) => {
  const page = exact(
    BookkeepingClientPage,
    await call('get', '/clients?pageSize=100', people.ownerA),
  );
  const found = page.items.find((i) => i.client.id === clientId);
  if (!found) throw new Error(`client ${clientId} is not on bookkeeping`);
  return found.id;
};
const mkPeriod = async (bk: string, body: object = {}, who: Who = people.staffA) =>
  exact(
    BookkeepingPeriod,
    await call('post', `/clients/${bk}/periods`, who, { ...nextMonth(), ...body }),
    201,
  );
const mkAccount = async (bk: string, body: object = {}) =>
  exact(
    BookkeepingAccount,
    await call('post', `/clients/${bk}/accounts`, people.staffA, {
      name: `Fake account ${(months += 1)}`,
      type: 'BANK',
      ...body,
    }),
    201,
  );
let reports = 0;
const mkReport = async (bk: string, body: object = {}) => {
  reports += 1;
  return exact(
    BookkeepingReportRow,
    await call('post', `/clients/${bk}/reports`, people.staffA, {
      reportType: 'PROFIT_LOSS',
      periodLabel: `Fake report period ${reports}`,
      dueOn: day(7),
      ...body,
    }),
    201,
  );
};
/** Review 2 (RP03): the client's P&L from its ledger (synced from the accounting software). */
const ledgerPnl = async (bk: string) =>
  exact(
    BookkeepingClientWorkspace,
    await call('patch', `/clients/${bk}`, people.staffA, { pnlSource: 'ACCOUNTING_SOFTWARE' }),
  );
const mkDocument = (clientId: string, engagementId: string) =>
  asOwner(ids.firmA, async (tx) => {
    const tag = randomUUID();
    return (
      await tx.document.create({
        data: {
          businessId: ids.firmA,
          clientId,
          engagementId,
          direction: 'CLIENT_TO_FIRM',
          fileName: 'statement.pdf',
          contentType: 'application/pdf',
          sizeBytes: 100,
          sha256: createHash('sha256').update(tag).digest('hex'),
          s3Key: `tenant/${ids.firmA}/e2e/${tag}/statement.pdf`,
        },
      })
    ).id;
  });
const mkPublishedReport = (engagementId: string) =>
  asOwner(ids.firmA, async (tx) => {
    const row = await tx.engagementReport.create({
      data: { businessId: ids.firmA, engagementId, kind: 'REPORT', title: 'Fake published report' },
    });
    await tx.engagementReport.update({
      where: { id: row.id },
      data: { status: 'PUBLISHED', publishedAt: new Date() },
    });
    return row.id;
  });

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
          name: `Fake R38 ${key}`,
        },
      });
    }
    for (const key of ['firmA', 'firmB'] as const) {
      const slug = `r38b-${key.toLowerCase()}-${run}`;
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
          kind: 'BOOKKEEPING',
          name: `Fake bookkeeping ${run}`,
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
      email: `davis-${run}@r38.test`,
    });
    clients.other = await mk('Fake Walker Properties', { assignedUserId: people.staffA.id });
    clients.bare = await mk('Fake Bare Client');
    for (const key of ['conn', 'close', 'recon', 'reports', 'rules', 'ledger', 'pnl'] as const) {
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
    expect((await call('get', '/reports', people.staffA)).status).toBe(200);
    // Owner and Admin only.
    expectError(
      await call('post', '/clients', people.staffA, { clientId: clients.bare }),
      403,
      'FORBIDDEN',
    );
    expectError(await call('get', '/settings', people.staffA), 403, 'FORBIDDEN');
    expectError(await call('put', '/settings', people.staffA, {}), 403, 'FORBIDDEN');
    expectError(await call('post', '/clients/refresh-status', people.staffA, {}), 403, 'FORBIDDEN');
    expect((await call('get', '/settings', people.adminA)).status).toBe(200);
    // A client login is never a firm member.
    expect((await call('get', '/overview', people.clientA)).status).toBe(403);
    // Firm B's owner has no seat in firm A.
    expect((await call('get', '/overview', people.ownerB, undefined, ids.firmA)).status).toBe(404);
    expect((await call('get', '/overview', undefined)).status).toBe(401);
  });

  it('rejects unknown fields and bad ids before touching data', async () => {
    expectError(await call('get', '/clients?nope=1', people.ownerA), 400, 'VALIDATION_FAILED');
    expectError(
      await call('get', '/clients?tab=SOMETHING', people.ownerA),
      400,
      'VALIDATION_FAILED',
    );
    expectError(await call('get', '/clients/not-a-uuid', people.ownerA), 400, 'VALIDATION_FAILED');
    expectError(await call('get', '/periods/not-a-uuid', people.ownerA), 400, 'VALIDATION_FAILED');
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

describe('with no bookkeeping', () => {
  it('returns empty lists and zeros, never made-up numbers', async () => {
    const o = exact(
      BookkeepingOverview,
      await call('get', '/overview', people.ownerB, undefined, ids.firmB),
    );
    expect(o.kpis.activeClients.value).toBe(0);
    expect(o.kpis.totalIncomeCents).toEqual({ value: 0, previous: null, changePercent: null });
    expect(o.kpis.totalExpensesCents.value).toBe(0);
    expect(o.kpis.netProfitCents.value).toBe(0);
    expect(o.kpis.clientsWithFigures).toBe(0);
    expect(o.kpis.clientsWithUpcomingReports.value).toBe(0);
    expect(o.statusBreakdown.total).toBe(0);
    expect(o.statusBreakdown.items.every((i) => i.count === 0)).toBe(true);
    expect(o.monthly).toHaveLength(12);
    expect(o.monthly.every((m) => m.incomeCents === 0 && m.expensesCents === 0)).toBe(true);
    expect(o.software).toEqual([]);
    expect(o.upcomingReports).toEqual([]);
    const page = exact(
      BookkeepingClientPage,
      await call('get', '/clients', people.ownerB, undefined, ids.firmB),
    );
    expect(page).toMatchObject({ items: [], total: 0, page: 1, pageSize: 25 });
    expect(page.tabCounts.ALL).toBe(0);
    expect(
      exact(
        BookkeepingReportPage,
        await call('get', '/reports', people.ownerB, undefined, ids.firmB),
      ).items,
    ).toEqual([]);
  });

  it('settings default to the standard values until the firm saves its own', async () => {
    const s = exact(
      BookkeepingSettings,
      await call('get', '/settings', people.ownerB, undefined, ids.firmB),
    );
    expect(s).toMatchObject({
      defaultCadence: 'MONTHLY',
      closeTargetDay: 10,
      upcomingReportDays: 14,
      staleSyncHours: 48,
      reconToleranceCents: 0,
      closeChecklist: [],
      updatedAt: null,
    });
  });
});

describe('adding bookkeeping clients', () => {
  it('Owner adds a client: the Bookkeeping engagement is made, nothing is invented, history and audit are written', async () => {
    const bk = await addClient(clients.assigned, {
      plan: 'Growth',
      cadence: 'MONTHLY',
      assignedUserId: people.adminA.id,
      reviewerUserId: people.ownerA.id,
    });
    expect(bk).toMatchObject({
      status: 'NOT_STARTED',
      statusSource: 'AUTOMATIC',
      cadence: 'MONTHLY',
      plan: 'Growth',
      paused: false,
      archived: false,
      connections: [],
      accounts: [],
      currentPeriod: null,
      kpis: {
        incomeCents: null,
        expensesCents: null,
        netProfitCents: null,
        uncategorizedCount: null,
      },
      yearToDate: null,
      trend: [],
      upcomingReports: [],
      assignedTo: { userId: people.adminA.id },
      reviewer: { userId: people.ownerA.id },
      shared: {
        openTasks: 0,
        overdueTasks: 0,
        documents: 0,
        outstandingDocumentRequests: 0,
        notes: 0,
      },
    });
    expect(bk.nextReportDueOn! >= day()).toBe(true);
    const engagement = await asOwner(ids.firmA, (tx) =>
      tx.engagement.findFirstOrThrow({ where: { id: bk.engagementId } }),
    );
    expect(engagement).toMatchObject({
      serviceId: ids.serviceA,
      clientId: clients.assigned,
      status: 'ACTIVE',
    });
    expect(bk.recentActivity.map((a) => a.summary)).toEqual(['Added to Bookkeeping']);
    expect(await auditActions(bk.id)).toContain('bookkeeping.client.added');
  });

  it('refuses a client already on bookkeeping, an unknown client and a firm with no Bookkeeping service', async () => {
    expectError(
      await call('post', '/clients', people.ownerA, { clientId: clients.assigned }),
      409,
      'ALREADY_BOOKKEEPING_CLIENT',
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
      'NO_BOOKKEEPING_SERVICE',
    );
  });

  it('reuses an existing active Bookkeeping engagement', async () => {
    const engagement = await asOwner(ids.firmA, (tx) =>
      tx.engagement.create({
        data: {
          businessId: ids.firmA,
          clientId: clients.other,
          serviceId: ids.serviceA,
          title: 'Existing books',
        },
      }),
    );
    expect((await addClient(clients.other)).engagementId).toBe(engagement.id);
  });

  it('a Staff assignee must have the client assigned to them; a non-member assignee or reviewer is refused', async () => {
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
    expectError(
      await call('post', '/clients', people.ownerA, {
        clientId: clients.unassigned,
        reviewerUserId: people.ownerB.id,
      }),
      409,
      'NOT_A_MEMBER',
    );
  });

  it('a custom cadence needs its months', async () => {
    expectError(
      await call('post', '/clients', people.ownerA, { clientId: clients.bare, cadence: 'CUSTOM' }),
      400,
      'VALIDATION_FAILED',
    );
    const bk = await addClient(clients.bare, { cadence: 'CUSTOM', cadenceMonths: 2 });
    expect(bk).toMatchObject({ cadence: 'CUSTOM', cadenceMonths: 2 });
  });
});

describe('the list, the overview and the exports', () => {
  const bks: Record<'green' | 'turner' | 'davis', string> = { green: '', turner: '', davis: '' };

  beforeAll(async () => {
    bks.green = await bkOf(clients.assigned);
    bks.turner = (await addClient(clients.unassigned, { plan: 'Elite' })).id;
    bks.davis = (await addClient(clients.business, { plan: 'Foundation' })).id;
    await call('post', `/clients/${bks.turner}/status`, people.ownerA, {
      status: 'NEEDS_ATTENTION',
      reason: 'Fake cleanup',
    });
    await call('post', `/clients/${bks.davis}/status`, people.ownerA, {
      status: 'MISSING_DOCUMENTS',
    });
    await call('post', `/clients/${bks.green}/status`, people.ownerA, { status: 'ON_TRACK' });
    await call('patch', `/clients/${bks.turner}`, people.ownerA, { nextReportDueOn: day(5) });
    // A fixed date years past any client's default due date (the 20th after a period of at most
    // a year), so the report-due filter below finds Davis alone whatever day the suite runs.
    await call('patch', `/clients/${bks.davis}`, people.ownerA, { nextReportDueOn: '2039-03-15' });
    await call('post', `/clients/${bks.green}/connections`, people.ownerA, {
      provider: 'quickbooks',
      providerCompany: `FAKE-QB-${run}`,
      companyName: 'Fake Green Leaf',
    });
  });

  it('lists with tab counts and filters, one page at a time', async () => {
    const all = exact(
      BookkeepingClientPage,
      await call('get', '/clients?pageSize=100', people.ownerA),
    );
    expect(all.total).toBeGreaterThanOrEqual(5);
    expect(all.tabCounts.ALL).toBe(all.total);
    expect(all.tabCounts.NEEDS_ATTENTION).toBeGreaterThanOrEqual(1);
    expect(all.tabCounts.UPCOMING).toBeGreaterThanOrEqual(1);
    const green = all.items.find((i) => i.id === bks.green)!;
    expect(green).toMatchObject({
      status: 'ON_TRACK',
      statusSource: 'MANUAL',
      plan: 'Growth',
      software: { key: 'quickbooks', label: 'QuickBooks Online', status: 'CONNECTED' },
      syncStatus: 'NEVER',
      lastSyncedAt: null,
      paused: false,
    });
    const one = exact(
      BookkeepingClientPage,
      await call('get', '/clients?pageSize=1&sort=clientName', people.ownerA),
    );
    expect(one.items).toHaveLength(1);
    expect(one.total).toBe(all.total);
    const tab = exact(
      BookkeepingClientPage,
      await call('get', '/clients?tab=NEEDS_ATTENTION&pageSize=100', people.ownerA),
    );
    expect(tab.items.every((i) => i.status === 'NEEDS_ATTENTION')).toBe(true);
    expect(tab.items.map((i) => i.id)).toContain(bks.turner);
    const upcoming = exact(
      BookkeepingClientPage,
      await call('get', '/clients?tab=UPCOMING&pageSize=100', people.ownerA),
    );
    expect(upcoming.items.map((i) => i.id)).toContain(bks.turner);
    expect(upcoming.items.map((i) => i.id)).not.toContain(bks.davis);
    const q = async (query: string) =>
      exact(
        BookkeepingClientPage,
        await call('get', `/clients?pageSize=100&${query}`, people.ownerA),
      ).items.map((i) => i.id);
    expect(await q('clientType=BUSINESS')).toContain(bks.davis);
    expect(await q('clientType=BUSINESS')).not.toContain(bks.green);
    expect(await q('plan=elite')).toEqual([bks.turner]);
    expect(await q('software=quickbooks')).toEqual([bks.green]);
    expect(await q('software=NOT_CONNECTED')).toContain(bks.turner);
    expect(await q('software=NOT_CONNECTED')).not.toContain(bks.green);
    expect(await q('search=Green Leaf')).toEqual([bks.green]);
    expect(await q('reportDueFrom=2039-03-01&reportDueTo=2039-03-31')).toEqual([bks.davis]);
    expect(await q(`assignedUserId=${people.adminA.id}`)).toEqual([bks.green]);
    expect(await q('status=MISSING_DOCUMENTS&tab=ALL')).toContain(bks.davis);
    expect(await q('tab=OVERDUE&status=ON_TRACK')).toEqual([]);
  });

  it('the Active cohort leaves a paused client out, and the chart counts the cohort shown (Review 2, D01, D02)', async () => {
    const page = async (query: string) =>
      exact(
        BookkeepingClientPage,
        await call('get', `/clients?pageSize=100&${query}`, people.ownerA),
      );
    const charted = (p: BookkeepingClientPage) =>
      (p.cohortStatus ?? []).reduce((n, c) => n + c.count, 0);
    exact(
      BookkeepingClientWorkspace,
      await call('post', `/clients/${bks.davis}/pause`, people.ownerA, {
        reason: 'Fake: on leave',
      }),
    );
    try {
      const active = await page('tab=ACTIVE');
      expect(active.items.map((i) => i.id)).not.toContain(bks.davis);
      expect(active.items.every((i) => !i.paused)).toBe(true);
      expect(active.tabCounts.ACTIVE).toBe(active.total);
      expect(charted(active)).toBe(active.total);
      // Every client, paused ones too, and the chart counts the same rows.
      const all = await page('tab=ALL');
      expect(all.items.map((i) => i.id)).toContain(bks.davis);
      expect(all.tabCounts.ACTIVE).toBe(active.total);
      expect(charted(all)).toBe(all.total);
      const upcoming = await page('tab=UPCOMING');
      expect(charted(upcoming)).toBe(upcoming.total);
      // The other filters narrow the chart too.
      const green = await page('tab=ACTIVE&search=Green Leaf');
      expect(green.cohortStatus).toEqual([{ status: 'ON_TRACK', count: 1 }]);
    } finally {
      await call('post', `/clients/${bks.davis}/resume`, people.ownerA, {});
    }
  });

  it('Staff see only the clients assigned to them', async () => {
    const page = exact(
      BookkeepingClientPage,
      await call('get', '/clients?pageSize=100', people.staffA),
    );
    const seen = page.items.map((i) => i.id);
    expect(seen).toContain(bks.green);
    expect(seen).toContain(bks.davis);
    expect(seen).not.toContain(bks.turner);
    expectError(await call('get', `/clients/${bks.turner}`, people.staffA), 404, 'NOT_FOUND');
    expectError(
      await call('get', `/clients/${bks.turner}/periods`, people.staffA),
      404,
      'NOT_FOUND',
    );
    expect((await call('get', `/clients/${bks.green}`, people.staff2A)).status).toBe(404);
    const o = exact(BookkeepingOverview, await call('get', '/overview', people.staffA));
    expect(o.statusBreakdown.total).toBeLessThan(
      exact(BookkeepingOverview, await call('get', '/overview', people.ownerA)).statusBreakdown
        .total,
    );
  });

  it('the overview counts active clients, statuses, software and the upcoming window', async () => {
    const o = exact(BookkeepingOverview, await call('get', '/overview', people.ownerA));
    expect(o.kpis.activeClients.value).toBe(o.statusBreakdown.total);
    expect(o.kpis.clientsWithUpcomingReports.value).toBeGreaterThanOrEqual(1);
    const qb = o.software.find((s) => s.key === 'quickbooks');
    expect(qb).toMatchObject({ label: 'QuickBooks Online', clientCount: 1, connected: true });
    expect(o.software.find((s) => s.key === null)!.label).toBe('Not connected');
    expect(o.statusBreakdown.items.map((i) => i.status)).toEqual([
      'ON_TRACK',
      'NEEDS_ATTENTION',
      'MISSING_DOCUMENTS',
      'OVERDUE',
      'NOT_STARTED',
    ]);
  });

  it('exports the list as a CSV with no figures, for those with the export permission', async () => {
    const res = await call('get', '/clients/export?tab=ALL', people.ownerA);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/csv');
    expect(res.headers['content-disposition']).toContain('bookkeeping-clients.csv');
    const text = res.text;
    expect(text.split('\r\n')[0]).toBe(
      'Client,Client number,Type,Plan,Accounting software,Status,Reason,Sync,Last synced,Next report due,Assigned to,Paused',
    );
    expect(text).toContain('Fake Green Leaf Cafe');
    expect(text).toContain('QuickBooks Online');
    expect((await call('get', '/clients/export', people.staffA)).status).toBe(200);
    expect((await call('get', '/clients/export', undefined)).status).toBe(401);
  });
});

describe('the client workspace and its service actions', () => {
  let bk = '';

  beforeAll(async () => {
    bk = (await addClient(clients.rules, { plan: 'Starter' })).id;
  });

  it('shows the workspace to a Staff member of the client and audits the view', async () => {
    const ws = exact(
      BookkeepingClientWorkspace,
      await call('get', `/clients/${bk}`, people.staffA),
    );
    expect(ws.client.displayName).toContain('Fake rules client');
    expect(ws.closeTargetDay).toBe(10);
    expect(await auditActions(bk)).toContain('bookkeeping.client.viewed');
  });

  it('Staff change portal defaults, alerts and rules but not cadence, reviewer or schedule', async () => {
    const ws = exact(
      BookkeepingClientWorkspace,
      await call('patch', `/clients/${bk}`, people.staffA, {
        portalDefaults: { reports: true, documents: false },
        alerts: { staleSync: false },
        categorizationRules: [{ match: 'AMAZON', category: 'Office Supplies' }],
      }),
    );
    expect(ws.portalDefaults).toEqual({ reports: true, documents: false });
    expect(ws.alerts).toEqual({ staleSync: false });
    expect(ws.categorizationRules).toEqual([{ match: 'AMAZON', category: 'Office Supplies' }]);
    // Merged, not replaced.
    const again = exact(
      BookkeepingClientWorkspace,
      await call('patch', `/clients/${bk}`, people.staffA, { portalDefaults: { notes: true } }),
    );
    expect(again.portalDefaults).toEqual({ reports: true, documents: false, notes: true });
    for (const body of [
      { cadence: 'QUARTERLY' },
      { closeTargetDay: 5 },
      { reviewerUserId: people.ownerA.id },
      { nextReportDueOn: day(3) },
      { reportSchedule: [] },
      { documentChecklist: [] },
    ]) {
      expectError(await call('patch', `/clients/${bk}`, people.staffA, body), 403, 'FORBIDDEN');
    }
    expectError(await call('patch', `/clients/${bk}`, people.staffA, {}), 400, 'VALIDATION_FAILED');
  });

  it('Owner changes cadence, close day, reviewer and schedules; the next report date follows', async () => {
    const ws = exact(
      BookkeepingClientWorkspace,
      await call('patch', `/clients/${bk}`, people.ownerA, {
        cadence: 'QUARTERLY',
        closeTargetDay: 20,
        reviewerUserId: people.adminA.id,
        reportSchedule: [
          { report: 'PROFIT_LOSS', cadence: 'MONTHLY', dueDay: 15, delivery: 'PORTAL' },
        ],
        documentChecklist: [{ label: 'Bank statements', cadence: 'MONTHLY' }],
      }),
    );
    expect(ws).toMatchObject({
      cadence: 'QUARTERLY',
      cadenceMonths: null,
      closeTargetDay: 20,
      reviewer: { userId: people.adminA.id },
      reportSchedule: [
        { report: 'PROFIT_LOSS', cadence: 'MONTHLY', dueDay: 15, delivery: 'PORTAL' },
      ],
      documentChecklist: [{ label: 'Bank statements', cadence: 'MONTHLY' }],
    });
    expect(ws.nextReportDueOn!.endsWith('-20')).toBe(true);
    const cleared = exact(
      BookkeepingClientWorkspace,
      await call('patch', `/clients/${bk}`, people.ownerA, {
        reportSchedule: null,
        closeTargetDay: null,
      }),
    );
    expect(cleared.reportSchedule).toBeNull();
    expect(cleared.closeTargetDay).toBe(10);
    expectError(
      await call('patch', `/clients/${bk}`, people.ownerA, { cadence: 'CUSTOM' }),
      400,
      'VALIDATION_FAILED',
    );
    expectError(
      await call('patch', `/clients/${bk}`, people.ownerA, { cadenceMonths: 3 }),
      400,
      'VALIDATION_FAILED',
    );
    expectError(
      await call('patch', `/clients/${bk}`, people.ownerA, { reviewerUserId: people.ownerB.id }),
      409,
      'NOT_A_MEMBER',
    );
    expect(await auditActions(bk)).toContain('bookkeeping.client.updated');
  });

  it('sets the status by hand with its reason, and hands it back to the rules', async () => {
    const manual = exact(
      BookkeepingClientWorkspace,
      await call('post', `/clients/${bk}/status`, people.staffA, {
        status: 'OVERDUE',
        reason: 'Client unresponsive',
      }),
    );
    expect(manual).toMatchObject({
      status: 'OVERDUE',
      statusSource: 'MANUAL',
      statusReason: 'Client unresponsive',
    });
    const auto = exact(
      BookkeepingClientWorkspace,
      await call('post', `/clients/${bk}/status`, people.staffA, { status: 'AUTOMATIC' }),
    );
    expect(auto.statusSource).toBe('AUTOMATIC');
    expect(auto.status).not.toBe('OVERDUE');
    const history = exact(
      BookkeepingActivityList,
      await call('get', `/clients/${bk}/activities`, people.staffA),
    );
    expect(history.items.map((a) => a.kind)).toContain('STATUS_CHANGE');
    expect(history.items.map((a) => a.summary)).toContain(
      'Status changed from NOT_STARTED to OVERDUE',
    );
    expect(await auditActions(bk)).toContain('bookkeeping.client.status_changed');
  });

  it('a note written on the Bookkeeping service shows in its Activity, never its text (Review 2, A01)', async () => {
    const clientId = await asOwner(ids.firmA, (tx) =>
      tx.client
        .create({
          data: {
            businessId: ids.firmA,
            displayName: `Fake A01 client ${run}`,
            assignedUserId: people.staffA.id,
          },
        })
        .then((c) => c.id),
    );
    const ws = await addClient(clientId);
    const note = await request(app.getHttpServer())
      .post(`/api/v1/business/clients/${clientId}/notes`)
      .set('x-business-id', ids.firmA)
      .set('x-forwarded-for', viewer())
      .set('authorization', `Bearer ${await tokenFor(people.staffA.email)}`)
      .send({
        body: 'Fake: asked for the receipts',
        engagementId: ws.engagementId,
        noteType: 'CALL',
      });
    expect(note.status, JSON.stringify(note.body)).toBe(201);
    const after = exact(
      BookkeepingClientWorkspace,
      await call('get', `/clients/${ws.id}`, people.staffA),
    );
    expect(after.recentActivity.map((a) => [a.kind, a.summary, a.actor?.userId])).toEqual([
      ['NOTE', 'Call note added', people.staffA.id],
      ['PLAN_CHANGE', 'Added to Bookkeeping', people.ownerA.id],
    ]);
    expect(JSON.stringify(after.recentActivity)).not.toContain('receipts');
  });

  it('logs activity with a kind and a short summary, newest first', async () => {
    const a = exact(
      BookkeepingActivity,
      await call('post', `/clients/${bk}/activities`, people.staffA, {
        kind: 'CONTACT',
        summary: 'Called about receipts',
      }),
      201,
    );
    expect(a).toMatchObject({
      kind: 'CONTACT',
      summary: 'Called about receipts',
      actor: { userId: people.staffA.id },
    });
    const page = exact(
      BookkeepingActivityList,
      await call('get', `/clients/${bk}/activities?pageSize=2`, people.staffA),
    );
    expect(page.items[0]!.id).toBe(a.id);
    expect(page.total).toBeGreaterThan(2);
    expectError(
      await call('post', `/clients/${bk}/activities`, people.staffA, {
        kind: 'SYNC',
        summary: 'x',
      }),
      400,
      'VALIDATION_FAILED',
    );
    expectError(
      await call('post', `/clients/${bk}/activities`, people.staffA, { summary: '   ' }),
      400,
      'VALIDATION_FAILED',
    );
  });

  it('pauses with a reason, resumes, assigns and archives; only Owner and Admin may', async () => {
    expectError(
      await call('post', `/clients/${bk}/pause`, people.staffA, { reason: 'x' }),
      403,
      'FORBIDDEN',
    );
    expectError(
      await call('post', `/clients/${bk}/pause`, people.ownerA, {}),
      400,
      'VALIDATION_FAILED',
    );
    const paused = exact(
      BookkeepingClientWorkspace,
      await call('post', `/clients/${bk}/pause`, people.ownerA, { reason: 'Client on leave' }),
    );
    expect(paused).toMatchObject({ paused: true, pauseReason: 'Client on leave' });
    expectError(
      await call('post', `/clients/${bk}/pause`, people.ownerA, { reason: 'again' }),
      409,
      'CLIENT_STATE',
    );
    const row = exact(
      BookkeepingClientPage,
      await call('get', '/clients?paused=true&pageSize=100', people.ownerA),
    ).items;
    expect(row.map((r) => r.id)).toContain(bk);
    const resumed = exact(
      BookkeepingClientWorkspace,
      await call('post', `/clients/${bk}/resume`, people.ownerA, {}),
    );
    expect(resumed).toMatchObject({ paused: false, pauseReason: null });
    expectError(
      await call('post', `/clients/${bk}/resume`, people.ownerA, {}),
      409,
      'CLIENT_STATE',
    );

    const assigned = exact(
      BookkeepingClientWorkspace,
      await call('post', `/clients/${bk}/assign`, people.ownerA, {
        assignedUserId: people.staffA.id,
      }),
    );
    expect(assigned.assignedTo?.userId).toBe(people.staffA.id);
    expectError(
      await call('post', `/clients/${bk}/assign`, people.ownerA, {
        assignedUserId: people.staff2A.id,
      }),
      409,
      'CLIENT_NOT_ASSIGNED',
    );
    expectError(
      await call('post', `/clients/${bk}/assign`, people.ownerA, {
        assignedUserId: people.ownerB.id,
      }),
      409,
      'NOT_A_MEMBER',
    );
    const removed = exact(
      BookkeepingClientWorkspace,
      await call('post', `/clients/${bk}/assign`, people.ownerA, { assignedUserId: null }),
    );
    expect(removed.assignedTo).toBeNull();

    const archived = exact(
      BookkeepingClientWorkspace,
      await call('post', `/clients/${bk}/archive`, people.ownerA, { reason: 'Left the firm' }),
    );
    expect(archived.archived).toBe(true);
    const list = exact(
      BookkeepingClientPage,
      await call('get', '/clients?pageSize=100', people.ownerA),
    ).items;
    expect(list.map((r) => r.id)).not.toContain(bk);
    // Archived: changes are refused, reading still works.
    expectError(
      await call('post', `/clients/${bk}/status`, people.ownerA, { status: 'ON_TRACK' }),
      409,
      'CLIENT_STATE',
    );
    expect((await call('get', `/clients/${bk}`, people.ownerA)).status).toBe(200);
    const actions = await auditActions(bk);
    expect(actions).toEqual(
      expect.arrayContaining([
        'bookkeeping.client.paused',
        'bookkeeping.client.resumed',
        'bookkeeping.client.assigned',
        'bookkeeping.client.archived',
      ]),
    );
  });

  it('shows what lives in the shared modules as counts', async () => {
    const bk2 = (await addClient(clients.reports, {})).id;
    const ws = exact(
      BookkeepingClientWorkspace,
      await call('get', `/clients/${bk2}`, people.ownerA),
    );
    await asOwner(ids.firmA, async (tx) => {
      await tx.task.create({
        data: {
          businessId: ids.firmA,
          clientId: clients.reports,
          engagementId: ws.engagementId,
          title: 'Fake open task',
          dueOn: new Date(`${day(-2)}T00:00:00.000Z`),
        },
      });
      await tx.task.create({
        data: {
          businessId: ids.firmA,
          clientId: clients.reports,
          engagementId: ws.engagementId,
          title: 'Fake later task',
          dueOn: new Date(`${day(9)}T00:00:00.000Z`),
        },
      });
      await tx.note.create({
        data: {
          businessId: ids.firmA,
          clientId: clients.reports,
          engagementId: ws.engagementId,
          body: 'Fake note',
          authorUserId: people.ownerA.id,
        },
      });
      await tx.documentRequest.create({
        data: {
          businessId: ids.firmA,
          clientId: clients.reports,
          engagementId: ws.engagementId,
          title: 'Fake request',
        },
      });
    });
    await mkDocument(clients.reports, ws.engagementId);
    const after = exact(
      BookkeepingClientWorkspace,
      await call('get', `/clients/${bk2}`, people.ownerA),
    );
    expect(after.shared).toEqual({
      openTasks: 2,
      overdueTasks: 1,
      documents: 1,
      outstandingDocumentRequests: 1,
      notes: 1,
    });
  });
});

/** A bookkeeping client for the client, added now when it is not on bookkeeping yet. */
const bkFor = async (clientId: string) => {
  try {
    return await bkOf(clientId);
  } catch {
    return (await addClient(clientId)).id;
  }
};

describe("statuses from the firm's rules", () => {
  it('an outstanding document request makes the client MISSING_DOCUMENTS, and clearing it takes it back', async () => {
    const bk = await bkFor(clients.reports);
    const before = exact(
      BookkeepingClientWorkspace,
      await call('get', `/clients/${bk}`, people.ownerA),
    );
    expect(before.shared.outstandingDocumentRequests).toBe(1);
    const refreshed = exact(
      BookkeepingStatusRefreshed,
      await call('post', '/clients/refresh-status', people.ownerA, {}),
    );
    expect(refreshed.checked).toBeGreaterThanOrEqual(1);
    expect(refreshed.changed).toBeGreaterThanOrEqual(1);
    const ws = exact(
      BookkeepingClientWorkspace,
      await call('get', `/clients/${bk}`, people.ownerA),
    );
    expect(ws).toMatchObject({
      status: 'MISSING_DOCUMENTS',
      statusReason: '1 document outstanding',
      statusSource: 'AUTOMATIC',
    });
    const history = exact(
      BookkeepingActivityList,
      await call('get', `/clients/${bk}/activities`, people.ownerA),
    );
    expect(history.items.map((a) => a.summary)).toContain(
      'Status changed from NOT_STARTED to MISSING_DOCUMENTS',
    );
    // The client turned this alert off: it no longer drives the status.
    const off = exact(
      BookkeepingClientWorkspace,
      await call('patch', `/clients/${bk}`, people.staffA, { alerts: { missingDocuments: false } }),
    );
    expect(off.status).toBe('NOT_STARTED');
    // And a status set by hand is never changed by the rules.
    await call('post', `/clients/${bk}/status`, people.ownerA, { status: 'ON_TRACK' });
    await call('post', '/clients/refresh-status', people.ownerA, {});
    expect(
      exact(BookkeepingClientWorkspace, await call('get', `/clients/${bk}`, people.ownerA)).status,
    ).toBe('ON_TRACK');
    expect(await auditActions(ids.firmA)).toBeDefined();
  });
});

describe('connections and syncs', () => {
  let bk = '';
  let conn = '';
  const company = `FAKE-CONN-${run}`;

  beforeAll(async () => {
    bk = await bkFor(clients.conn);
  });

  it('connects a provider company, asks for the first sync, and refuses duplicates', async () => {
    expectError(
      await call('post', `/clients/${bk}/connections`, people.staffA, {
        provider: 'quickbooks',
        providerCompany: company,
      }),
      403,
      'FORBIDDEN',
    );
    const c = exact(
      BookkeepingConnection,
      await call('post', `/clients/${bk}/connections`, people.ownerA, {
        provider: 'quickbooks',
        providerCompany: company,
        companyName: 'Fake Conn Co',
      }),
      201,
    );
    conn = c.id;
    expect(c).toMatchObject({
      provider: 'quickbooks',
      label: 'QuickBooks Online',
      providerCompanyId: company,
      companyName: 'Fake Conn Co',
      status: 'CONNECTED',
      syncStatus: 'NEVER',
      lastSuccessfulSyncAt: null,
      lastErrorCode: null,
      disconnectedAt: null,
    });
    const runs = exact(
      BookkeepingSyncRunList,
      await call('get', `/connections/${conn}/syncs`, people.staffA),
    );
    expect(runs.items).toHaveLength(1);
    expect(runs.items[0]).toMatchObject({
      trigger: 'INITIAL',
      outcome: 'RUNNING',
      finishedAt: null,
      requestedBy: { userId: people.ownerA.id },
    });
    expectError(
      await call('post', `/clients/${bk}/connections`, people.ownerA, {
        provider: 'quickbooks',
        providerCompany: 'OTHER-1',
      }),
      409,
      'CONNECTION_EXISTS',
    );
    expectError(
      await call('post', `/clients/${bk}/connections`, people.ownerA, {
        provider: 'quickbooks',
        providerCompany: company,
      }),
      409,
      'CONNECTION_EXISTS',
    );
    // The same company cannot be mapped to a second client.
    const other = await bkFor(clients.close);
    expectError(
      await call('post', `/clients/${other}/connections`, people.ownerA, {
        provider: 'quickbooks',
        providerCompany: company,
      }),
      409,
      'COMPANY_ALREADY_CONNECTED',
    );
    expectError(
      await call('post', `/clients/${bk}/connections`, people.ownerA, {
        provider: 'Not A Key',
        providerCompany: 'x',
      }),
      400,
      'VALIDATION_FAILED',
    );
    const list = exact(
      BookkeepingConnectionList,
      await call('get', `/clients/${bk}/connections`, people.staffA),
    );
    expect(list.items.map((i) => i.id)).toEqual([conn]);
    expect(await auditActions(conn)).toContain('bookkeeping.connection.connected');
  });

  it('renames the mapped company', async () => {
    const c = exact(
      BookkeepingConnection,
      await call('patch', `/connections/${conn}`, people.ownerA, {
        companyName: 'Fake Renamed Co',
      }),
    );
    expect(c.companyName).toBe('Fake Renamed Co');
    expectError(
      await call('patch', `/connections/${conn}`, people.staffA, { companyName: 'x' }),
      403,
      'FORBIDDEN',
    );
    expectError(
      await call('patch', `/connections/${randomUUID()}`, people.ownerA, { companyName: 'x' }),
      404,
      'NOT_FOUND',
    );
  });

  it('Sync Now records a run once, until the integration worker finishes it', async () => {
    // The first (initial) run is still under way: asking again adds nothing.
    const again = exact(
      BookkeepingSyncQueued,
      await call('post', `/clients/${bk}/sync`, people.staffA, {}),
    );
    expect(again.queued).toBe(0);
    // The worker finishes the run with a good sync.
    await asOwner(ids.firmA, async (tx) => {
      const now = new Date();
      await tx.bookkeepingSyncRun.updateMany({
        where: { connectionId: conn },
        data: { outcome: 'SUCCESS', finishedAt: now, counts: { accounts: 4 } },
      });
      // A good sync a day and a half ago: fresh for the default 48 hours.
      const earlier = new Date(now.getTime() - 36 * 3_600_000);
      await tx.bookkeepingConnection.update({
        where: { businessId_id: { businessId: ids.firmA, id: conn } },
        data: { lastSyncAt: earlier, lastSuccessfulSyncAt: earlier },
      });
    });
    const ws = exact(
      BookkeepingClientWorkspace,
      await call('get', `/clients/${bk}`, people.staffA),
    );
    expect(ws.connections[0]).toMatchObject({ syncStatus: 'SYNCED' });
    const queued = exact(
      BookkeepingSyncQueued,
      await call('post', `/clients/${bk}/sync`, people.staffA, {}),
    );
    expect(queued.queued).toBe(1);
    expect(
      exact(BookkeepingSyncQueued, await call('post', `/clients/${bk}/sync`, people.staffA, {}))
        .queued,
    ).toBe(0);
    const runs = exact(
      BookkeepingSyncRunList,
      await call('get', `/connections/${conn}/syncs?pageSize=10`, people.ownerA),
    );
    expect(runs.total).toBe(2);
    expect(runs.items.map((r) => [r.trigger, r.outcome])).toEqual([
      ['MANUAL', 'RUNNING'],
      ['INITIAL', 'SUCCESS'],
    ]);
    expect(runs.items[1]!.counts).toEqual({ accounts: 4 });
    expect(await auditActions(bk)).toContain('bookkeeping.client.sync_queued');
  });

  it('a stale sync and a failed one drive the status and keep the last good sync', async () => {
    // The firm counts a sync older than 24 hours as stale (the last good one was 36 hours ago).
    await call('put', '/settings', people.ownerA, { staleSyncHours: 24 });
    const old = (
      await asOwner(ids.firmA, (tx) =>
        tx.bookkeepingConnection.findFirstOrThrow({ where: { id: conn } }),
      )
    ).lastSuccessfulSyncAt!;
    await asOwner(ids.firmA, (tx) =>
      tx.bookkeepingSyncRun.updateMany({
        where: { connectionId: conn },
        data: { outcome: 'SUCCESS', finishedAt: new Date() },
      }),
    );
    await call('post', `/clients/${bk}/status`, people.ownerA, { status: 'AUTOMATIC' });
    let ws = exact(BookkeepingClientWorkspace, await call('get', `/clients/${bk}`, people.ownerA));
    expect(ws.connections[0]!.syncStatus).toBe('STALE');
    expect(ws).toMatchObject({
      status: 'NEEDS_ATTENTION',
      statusReason: 'The last sync is out of date',
    });
    // The latest sync failed: the error shows, the last good sync stays.
    await asOwner(ids.firmA, (tx) =>
      tx.bookkeepingConnection.update({
        where: { businessId_id: { businessId: ids.firmA, id: conn } },
        data: { status: 'ERROR', lastErrorCode: 'RATE_LIMITED', lastSyncAt: new Date() },
      }),
    );
    await call('post', '/clients/refresh-status', people.ownerA, {});
    ws = exact(BookkeepingClientWorkspace, await call('get', `/clients/${bk}`, people.ownerA));
    expect(ws.connections[0]).toMatchObject({
      status: 'ERROR',
      syncStatus: 'ERROR',
      lastErrorCode: 'RATE_LIMITED',
    });
    expect(ws.connections[0]!.lastSuccessfulSyncAt).toBe(old.toISOString());
    expect(ws.statusReason).toBe('The accounting connection needs attention');
    expectError(await call('post', `/clients/${bk}/sync`, people.staffA, {}), 409, 'NOT_CONNECTED');
    await call('put', '/settings', people.ownerA, {});
  });

  it('reconnects, then disconnects and connects the same company again on the same row', async () => {
    expectError(
      await call('post', `/connections/${conn}/reconnect`, people.staffA, {}),
      403,
      'FORBIDDEN',
    );
    const re = exact(
      BookkeepingConnection,
      await call('post', `/connections/${conn}/reconnect`, people.ownerA, {}),
    );
    expect(re).toMatchObject({ status: 'CONNECTED', lastErrorCode: null });
    expect(re.lastSuccessfulSyncAt).not.toBeNull();
    expectError(
      await call('post', `/connections/${conn}/reconnect`, people.ownerA, {}),
      409,
      'CLIENT_STATE',
    );

    expectError(
      await call('post', `/connections/${conn}/disconnect`, people.staffA, {}),
      403,
      'FORBIDDEN',
    );
    const off = exact(
      BookkeepingConnection,
      await call('post', `/connections/${conn}/disconnect`, people.ownerA, {}),
    );
    expect(off).toMatchObject({ status: 'DISCONNECTED', syncStatus: 'NOT_CONNECTED' });
    expect(off.disconnectedAt).not.toBeNull();
    expectError(
      await call('post', `/connections/${conn}/disconnect`, people.ownerA, {}),
      409,
      'CLIENT_STATE',
    );
    const page = exact(
      BookkeepingClientPage,
      await call('get', '/clients?software=NOT_CONNECTED&pageSize=100', people.ownerA),
    );
    expect(page.items.find((i) => i.id === bk)!.software).toBeNull();

    // The company is free again for any client; this one gets its old row back.
    const back = exact(
      BookkeepingConnection,
      await call('post', `/clients/${bk}/connections`, people.ownerA, {
        provider: 'quickbooks',
        providerCompany: company,
      }),
      201,
    );
    expect(back.id).toBe(conn);
    expect(back.status).toBe('CONNECTED');
    const actions = await auditActions(conn);
    expect(actions).toEqual(
      expect.arrayContaining([
        'bookkeeping.connection.reconnected',
        'bookkeeping.connection.disconnected',
      ]),
    );
  });

  it('Sync All Clients asks for each connected client the caller reaches', async () => {
    await asOwner(ids.firmA, (tx) =>
      tx.bookkeepingSyncRun.updateMany({
        where: { businessId: ids.firmA },
        data: { outcome: 'SUCCESS', finishedAt: new Date() },
      }),
    );
    const staff = exact(
      BookkeepingSyncQueued,
      await call('post', '/clients/sync', people.staffA, {}),
    );
    expect(staff.queued).toBeGreaterThanOrEqual(1);
    const nothingLeft = exact(
      BookkeepingSyncQueued,
      await call('post', '/clients/sync', people.ownerA, {}),
    );
    // Staff's request already covered their clients; the Owner adds only the clients Staff cannot reach.
    expect(nothingLeft.queued).toBeGreaterThanOrEqual(0);
    expect(await auditActions(ids.firmA)).toBeDefined();
    const none = exact(
      BookkeepingSyncQueued,
      await call('post', '/clients/sync', people.ownerB, {}, ids.firmB),
    );
    expect(none.queued).toBe(0);
  });
});

describe('bank and credit card accounts', () => {
  let bk = '';
  beforeAll(async () => {
    bk = await bkFor(clients.conn);
  });

  it('adds an account with its last digits only, updates its balance and archives it', async () => {
    const a = await mkAccount(bk, {
      name: 'Fake Checking',
      institution: 'Fake Bank',
      mask: '4321',
      balanceCents: 1_245_032,
      balanceAsOf: new Date().toISOString(),
    });
    expect(a).toMatchObject({
      name: 'Fake Checking',
      type: 'BANK',
      mask: '4321',
      balanceCents: 1_245_032,
      reconcile: true,
      archived: false,
    });
    const card = await mkAccount(bk, {
      type: 'CREDIT_CARD',
      balanceCents: -234_012,
      balanceAsOf: new Date().toISOString(),
    });
    expect(card.balanceCents).toBe(-234_012);
    const updated = exact(
      BookkeepingAccount,
      await call('patch', `/accounts/${a.id}`, people.staffA, {
        name: 'Fake Checking 2',
        balanceCents: 5_000,
        balanceAsOf: new Date().toISOString(),
        reconcile: false,
      }),
    );
    expect(updated).toMatchObject({
      name: 'Fake Checking 2',
      balanceCents: 5_000,
      reconcile: false,
    });
    const cleared = exact(
      BookkeepingAccount,
      await call('patch', `/accounts/${a.id}`, people.staffA, { balanceCents: null }),
    );
    expect(cleared).toMatchObject({ balanceCents: null, balanceAsOf: null });
    const archived = exact(
      BookkeepingAccount,
      await call('patch', `/accounts/${a.id}`, people.staffA, { archived: true }),
    );
    expect(archived.archived).toBe(true);
    const list = exact(
      BookkeepingAccountList,
      await call('get', `/clients/${bk}/accounts`, people.staffA),
    );
    expect(list.items.map((i) => i.id)).toContain(card.id);
    expect(list.items.map((i) => i.id)).not.toContain(a.id);
    const ws = exact(
      BookkeepingClientWorkspace,
      await call('get', `/clients/${bk}`, people.staffA),
    );
    expect(ws.accounts.map((i) => i.id)).toContain(card.id);
    expect(await auditActions(a.id)).toEqual([
      'bookkeeping.account.added',
      'bookkeeping.account.updated',
      'bookkeeping.account.updated',
      'bookkeeping.account.updated',
    ]);
  });

  it("refuses a full account number, a balance without its date and another client's account", async () => {
    for (const body of [
      { name: 'x', type: 'BANK', mask: '123456789' },
      { name: 'x', type: 'BANK', balanceCents: 100 },
      { name: 'x', type: 'BANK', balanceAsOf: new Date().toISOString() },
      { name: 'x', type: 'SAVINGS' },
      { name: '', type: 'BANK' },
    ]) {
      expectError(
        await call('post', `/clients/${bk}/accounts`, people.staffA, body),
        400,
        'VALIDATION_FAILED',
      );
    }
    expectError(
      await call('patch', `/accounts/${randomUUID()}`, people.staffA, { name: 'x' }),
      404,
      'NOT_FOUND',
    );
    expectError(
      await call('patch', `/accounts/${(await mkAccount(bk)).id}`, people.staffA, {
        balanceAsOf: new Date().toISOString(),
      }),
      400,
      'VALIDATION_FAILED',
    );
  });
});

/** The close day of the month after the month after `end`'s: the due date once `end`'s period is done. */
const dueAfterClosing = (end: string) => {
  const d = new Date(`${end}T00:00:00.000Z`);
  // The next period is the month after `end`; it is due on the 10th of the month after that.
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 2, 10)).toISOString().slice(0, 10);
};

describe('periods and the close workflow', () => {
  let bk = '';
  beforeAll(async () => {
    bk = await bkFor(clients.close);
  });

  it('creates a period with the standard checklist and its close date', async () => {
    const dates = nextMonth();
    const p = await mkPeriod(bk, dates);
    expect(p).toMatchObject({
      status: 'NOT_STARTED',
      closeVersion: 1,
      incomeCents: null,
      expensesCents: null,
      netProfitCents: null,
      figuresSource: null,
      uncategorizedCount: null,
      overdue: false,
    });
    expect(p.label).toMatch(/^[A-Z][a-z]+ 20\d\d$/);
    expect(p.closeItems.map((i) => i.itemKey)).toEqual(DEFAULT_CLOSE_CHECKLIST.map((i) => i.key));
    expect(p.progress).toEqual({
      done: 0,
      total: 12,
      requiredDone: 0,
      requiredTotal: DEFAULT_CLOSE_CHECKLIST.filter((i) => i.required).length,
    });
    expect(p.closeByOn!.endsWith('-10')).toBe(true);
    expect(p.closeByOn! > dates.periodEnd).toBe(true);
    expect(p.accountsWithoutReconciliation).toEqual([]);
    expect(await auditActions(p.id)).toContain('bookkeeping.period.created');
    expectError(
      await call('post', `/clients/${bk}/periods`, people.staffA, dates),
      409,
      'DUPLICATE',
    );
  });

  it('names a custom period, and refuses dates that make no period', async () => {
    expectError(
      await call('post', `/clients/${bk}/periods`, people.staffA, {
        kind: 'MONTH',
        periodStart: '2060-03-05',
        periodEnd: '2060-03-20',
      }),
      400,
      'VALIDATION_FAILED',
    );
    expectError(
      await call('post', `/clients/${bk}/periods`, people.staffA, {
        kind: 'CUSTOM',
        periodStart: '2060-03-05',
        periodEnd: '2060-03-20',
      }),
      400,
      'VALIDATION_FAILED',
    );
    expectError(
      await call('post', `/clients/${bk}/periods`, people.staffA, {
        kind: 'MONTH',
        periodStart: '2060-03-31',
        periodEnd: '2060-03-01',
      }),
      400,
      'VALIDATION_FAILED',
    );
    const p = await mkPeriod(bk, {
      kind: 'CUSTOM',
      periodStart: '2060-03-05',
      periodEnd: '2060-03-20',
      label: 'Fake custom stretch',
      closeByOn: null,
    });
    expect(p).toMatchObject({ label: 'Fake custom stretch', closeByOn: null, kind: 'CUSTOM' });
    const q = await mkPeriod(bk, {
      kind: 'QUARTER',
      periodStart: '2060-07-01',
      periodEnd: '2060-09-30',
    });
    expect(q.label).toBe('Q3 2060');
  });

  it('enters figures by hand: both together, never negative, and they show as entered', async () => {
    const p = await mkPeriod(bk);
    const set = exact(
      BookkeepingPeriod,
      await call('patch', `/periods/${p.id}`, people.staffA, {
        incomeCents: 2_458_000,
        expensesCents: 1_622_000,
        uncategorizedCount: 12,
      }),
    );
    expect(set).toMatchObject({
      incomeCents: 2_458_000,
      expensesCents: 1_622_000,
      netProfitCents: 836_000,
      figuresSource: 'MANUAL',
      uncategorizedCount: 12,
    });
    expect(set.figuresAsOf).not.toBeNull();
    const one = exact(
      BookkeepingPeriod,
      await call('patch', `/periods/${p.id}`, people.staffA, { incomeCents: 3_000_000 }),
    );
    expect(one).toMatchObject({ incomeCents: 3_000_000, expensesCents: 1_622_000 });
    const fresh = await mkPeriod(bk);
    expectError(
      await call('patch', `/periods/${fresh.id}`, people.staffA, { incomeCents: 100 }),
      400,
      'VALIDATION_FAILED',
    );
    expectError(
      await call('patch', `/periods/${p.id}`, people.staffA, { incomeCents: -1 }),
      400,
      'VALIDATION_FAILED',
    );
    expectError(
      await call('patch', `/periods/${p.id}`, people.staffA, {}),
      400,
      'VALIDATION_FAILED',
    );
    const cleared = exact(
      BookkeepingPeriod,
      await call('patch', `/periods/${p.id}`, people.staffA, {
        incomeCents: null,
        expensesCents: null,
      }),
    );
    expect(cleared).toMatchObject({
      incomeCents: null,
      expensesCents: null,
      figuresSource: null,
      figuresAsOf: null,
      netProfitCents: null,
    });
    const moved = exact(
      BookkeepingPeriod,
      await call('patch', `/periods/${p.id}`, people.staffA, { closeByOn: day(-4) }),
    );
    expect(moved).toMatchObject({ closeByOn: day(-4), overdue: true });
  });

  it('runs the whole close: start, review, send back, approve, complete the steps, close, lock, reopen', async () => {
    const dates = nextMonth();
    const p = await mkPeriod(bk, dates);
    const id = p.id;
    expectError(await call('post', `/periods/${id}/ready`, people.staffA, {}), 409, 'PERIOD_STATE');
    expect(
      exact(BookkeepingPeriod, await call('post', `/periods/${id}/start`, people.staffA, {}))
        .status,
    ).toBe('IN_PROGRESS');
    expectError(await call('post', `/periods/${id}/start`, people.staffA, {}), 409, 'PERIOD_STATE');
    const ready = exact(
      BookkeepingPeriod,
      await call('post', `/periods/${id}/ready`, people.staffA, {}),
    );
    expect(ready).toMatchObject({
      status: 'READY_FOR_REVIEW',
      readyForReviewBy: { userId: people.staffA.id },
    });
    expect(ready.readyForReviewAt).not.toBeNull();
    // Only Owner and Admin send back, approve, close and reopen.
    for (const path of ['send-back', 'approve', 'close']) {
      expectError(
        await call('post', `/periods/${id}/${path}`, people.staffA, {}),
        403,
        'FORBIDDEN',
      );
    }
    expectError(
      await call('post', `/periods/${id}/reopen`, people.staffA, { reason: 'x' }),
      403,
      'FORBIDDEN',
    );
    expect(
      exact(BookkeepingPeriod, await call('post', `/periods/${id}/send-back`, people.adminA, {}))
        .status,
    ).toBe('IN_PROGRESS');
    await call('post', `/periods/${id}/ready`, people.staffA, {});
    const approved = exact(
      BookkeepingPeriod,
      await call('post', `/periods/${id}/approve`, people.ownerA, {}),
    );
    expect(approved).toMatchObject({
      status: 'APPROVED',
      approvedBy: { userId: people.ownerA.id },
    });
    // Approved: the figures are reviewed and cannot change quietly.
    expectError(
      await call('patch', `/periods/${id}`, people.staffA, { incomeCents: 1, expensesCents: 1 }),
      409,
      'PERIOD_STATE',
    );
    // The required steps must be done before the close.
    expectError(
      await call('post', `/periods/${id}/close`, people.ownerA, {}),
      409,
      'CLOSE_ITEMS_OPEN',
    );
    let detail = approved;
    for (const item of approved.closeItems.filter((i) => i.required)) {
      detail = exact(
        BookkeepingPeriod,
        await call('patch', `/periods/${id}/close-items/${item.id}`, people.staffA, {
          completed: true,
          note: 'Fake note',
        }),
      );
    }
    expect(detail.progress.requiredDone).toBe(detail.progress.requiredTotal);
    expect(detail.closeItems.find((i) => i.required)).toMatchObject({
      completed: true,
      completedBy: { userId: people.staffA.id },
      note: 'Fake note',
    });
    const undone = exact(
      BookkeepingPeriod,
      await call(
        'patch',
        `/periods/${id}/close-items/${approved.closeItems[0]!.id}`,
        people.staffA,
        { completed: false },
      ),
    );
    expect(undone.closeItems[0]).toMatchObject({ completed: false, completedBy: null });
    await call('patch', `/periods/${id}/close-items/${approved.closeItems[0]!.id}`, people.staffA, {
      completed: true,
    });
    expectError(
      await call('patch', `/periods/${id}/close-items/${randomUUID()}`, people.staffA, {
        completed: true,
      }),
      404,
      'NOT_FOUND',
    );
    expectError(
      await call(
        'patch',
        `/periods/${id}/close-items/${approved.closeItems[0]!.id}`,
        people.staffA,
        {},
      ),
      400,
      'VALIDATION_FAILED',
    );
    const closed = exact(
      BookkeepingPeriod,
      await call('post', `/periods/${id}/close`, people.ownerA, {}),
    );
    expect(closed).toMatchObject({ status: 'CLOSED', closedBy: { userId: people.ownerA.id } });
    // Closed means locked.
    expectError(
      await call('patch', `/periods/${id}`, people.staffA, { closeByOn: day(3) }),
      409,
      'PERIOD_LOCKED',
    );
    expectError(
      await call(
        'patch',
        `/periods/${id}/close-items/${approved.closeItems[0]!.id}`,
        people.staffA,
        { completed: false },
      ),
      409,
      'PERIOD_LOCKED',
    );
    expectError(
      await call('post', `/periods/${id}/start`, people.staffA, {}),
      409,
      'PERIOD_LOCKED',
    );
    // The next report date follows the closed period.
    const ws = exact(
      BookkeepingClientWorkspace,
      await call('get', `/clients/${bk}`, people.ownerA),
    );
    expect(
      ws.nextReportDueOn! >= dueAfterClosing(dates.periodEnd) ||
        ws.nextReportDueOn! > dates.periodEnd,
    ).toBe(true);
    // Reopen: a reason, a new close version, approval and close cleared.
    expectError(
      await call('post', `/periods/${id}/reopen`, people.ownerA, {}),
      400,
      'VALIDATION_FAILED',
    );
    const reopened = exact(
      BookkeepingPeriod,
      await call('post', `/periods/${id}/reopen`, people.ownerA, { reason: 'Late invoice found' }),
    );
    expect(reopened).toMatchObject({
      status: 'IN_PROGRESS',
      closeVersion: 2,
      reopenReason: 'Late invoice found',
      reopenedBy: { userId: people.ownerA.id },
      approvedAt: null,
      closedAt: null,
    });
    const actions = await auditActions(id);
    expect(actions).toEqual(
      expect.arrayContaining([
        'bookkeeping.period.started',
        'bookkeeping.period.ready',
        'bookkeeping.period.sent_back',
        'bookkeeping.period.approved',
        'bookkeeping.period.closed',
        'bookkeeping.period.reopened',
        'bookkeeping.period.close_item_updated',
      ]),
    );
    const history = exact(
      BookkeepingActivityList,
      await call('get', `/clients/${bk}/activities?pageSize=50`, people.ownerA),
    );
    expect(history.items.filter((a) => a.kind === 'CLOSE').length).toBeGreaterThanOrEqual(6);
  });

  it("lists a client's periods, newest first, with filters and paging", async () => {
    const all = exact(
      BookkeepingPeriodList,
      await call('get', `/clients/${bk}/periods?pageSize=100`, people.staffA),
    );
    expect(all.total).toBeGreaterThanOrEqual(5);
    const starts = all.items.map((i) => i.periodStart);
    expect([...starts].sort().reverse()).toEqual(starts);
    const open = exact(
      BookkeepingPeriodList,
      await call('get', `/clients/${bk}/periods?status=IN_PROGRESS`, people.staffA),
    );
    expect(open.items.every((i) => i.status === 'IN_PROGRESS')).toBe(true);
    const y = exact(
      BookkeepingPeriodList,
      await call('get', '/clients/' + bk + '/periods?year=2060', people.staffA),
    );
    expect(y.items.every((i) => i.periodStart.startsWith('2060'))).toBe(true);
    expect(
      exact(
        BookkeepingPeriodList,
        await call('get', `/clients/${bk}/periods?pageSize=1&page=2`, people.staffA),
      ).items,
    ).toHaveLength(1);
  });

  it('the overview adds the figures of the months and compares with the month before', async () => {
    const now = new Date();
    const first = (offset: number) =>
      new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + offset, 1));
    const span = (offset: number) => ({
      kind: 'MONTH',
      periodStart: first(offset).toISOString().slice(0, 10),
      periodEnd: new Date(first(offset + 1).getTime() - 86_400_000).toISOString().slice(0, 10),
    });
    const thisMonth = await mkPeriod(bk, span(0));
    const lastMonth = await mkPeriod(bk, span(-1));
    await call('patch', `/periods/${thisMonth.id}`, people.staffA, {
      incomeCents: 2_458_000,
      expensesCents: 1_622_000,
    });
    await call('patch', `/periods/${lastMonth.id}`, people.staffA, {
      incomeCents: 2_000_000,
      expensesCents: 1_500_000,
    });
    // A quarter on top of those months must not count twice.
    const o = exact(
      BookkeepingOverview,
      await call('get', '/overview?period=THIS_MONTH', people.ownerA),
    );
    expect(o.kpis.totalIncomeCents).toEqual({
      value: 2_458_000,
      previous: 2_000_000,
      changePercent: 22.9,
    });
    expect(o.kpis.totalExpensesCents).toEqual({
      value: 1_622_000,
      previous: 1_500_000,
      changePercent: 8.1,
    });
    expect(o.kpis.netProfitCents).toEqual({
      value: 836_000,
      previous: 500_000,
      changePercent: 67.2,
    });
    expect(o.kpis.clientsWithFigures).toBe(1);
    const entry = o.monthly[now.getUTCMonth()]!;
    expect(entry).toEqual({
      month: `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`,
      incomeCents: 2_458_000,
      expensesCents: 1_622_000,
    });
    const year = exact(
      BookkeepingOverview,
      await call('get', '/overview?period=THIS_YEAR', people.ownerA),
    );
    expect(year.kpis.totalIncomeCents.value).toBe(now.getUTCMonth() === 0 ? 2_458_000 : 4_458_000);
    const ws = exact(
      BookkeepingClientWorkspace,
      await call('get', `/clients/${bk}`, people.ownerA),
    );
    expect(ws.yearToDate).toMatchObject({
      incomeCents: year.kpis.totalIncomeCents.value,
      expenseRatioPercent: expect.any(Number),
    });
    expect(ws.trend.map((t) => t.month)).toContain(entry.month);
    // The overview is for the firm: Staff see it for their clients only, and firm B sees nothing of A.
    const b = exact(
      BookkeepingOverview,
      await call('get', '/overview?period=THIS_MONTH', people.ownerB, undefined, ids.firmB),
    );
    expect(b.kpis.totalIncomeCents.value).toBe(0);
  });
});

describe('reconciliations', () => {
  let bk = '';
  let period = '';
  let account = '';
  let statement = '';
  let reconId = '';

  beforeAll(async () => {
    bk = await bkFor(clients.recon);
    const p = await mkPeriod(bk);
    period = p.id;
    await call('post', `/periods/${period}/start`, people.staffA, {});
    account = (await mkAccount(bk, { name: 'Fake recon checking', mask: '9876' })).id;
    const ws = exact(
      BookkeepingClientWorkspace,
      await call('get', `/clients/${bk}`, people.ownerA),
    );
    statement = await mkDocument(clients.recon, ws.engagementId);
  });

  const body = () => ({
    accountId: account,
    statementStart: '2040-01-01',
    statementEnd: '2040-01-31',
    beginningBalanceCents: 1_000_000,
    endingBalanceCents: 5_000_000,
    clearedBalanceCents: 4_500_000,
    clearedCount: 12,
    exceptionsCount: 1,
    statementDocumentId: statement,
  });

  it("starts a reconciliation with its difference worked out, and refuses another client's account or statement", async () => {
    const r = exact(
      BookkeepingReconciliation,
      await call('post', `/periods/${period}/reconciliations`, people.staffA, body()),
      201,
    );
    reconId = r.id;
    expect(r).toMatchObject({
      status: 'IN_PROGRESS',
      differenceCents: 500_000,
      toleranceCents: 0,
      withinTolerance: false,
      exceptionsCount: 1,
      clearedCount: 12,
      statementDocumentId: statement,
      account: { id: account, name: 'Fake recon checking', type: 'BANK', mask: '9876' },
    });
    expectError(
      await call('post', `/periods/${period}/reconciliations`, people.staffA, body()),
      409,
      'DUPLICATE',
    );
    const otherBk = await bkFor(clients.close);
    const otherAccount = (await mkAccount(otherBk)).id;
    expectError(
      await call('post', `/periods/${period}/reconciliations`, people.staffA, {
        ...body(),
        accountId: otherAccount,
      }),
      409,
      'NOT_THIS_CLIENTS',
    );
    expectError(
      await call('post', `/periods/${period}/reconciliations`, people.staffA, {
        ...body(),
        accountId: randomUUID(),
      }),
      409,
      'NOT_THIS_CLIENTS',
    );
    const second = (await mkAccount(bk)).id;
    const otherDoc = await mkDocument(
      clients.close,
      exact(BookkeepingClientWorkspace, await call('get', `/clients/${otherBk}`, people.ownerA))
        .engagementId,
    );
    expectError(
      await call('post', `/periods/${period}/reconciliations`, people.staffA, {
        ...body(),
        accountId: second,
        statementDocumentId: otherDoc,
      }),
      409,
      'NOT_THIS_CLIENTS',
    );
    expectError(
      await call('post', `/periods/${period}/reconciliations`, people.staffA, {
        ...body(),
        accountId: second,
        statementEnd: '2039-12-31',
      }),
      400,
      'VALIDATION_FAILED',
    );
    const detail = exact(BookkeepingPeriod, await call('get', `/periods/${period}`, people.staffA));
    expect(detail.reconciliations.map((x) => x.id)).toEqual([reconId]);
    expect(detail.accountsWithoutReconciliation.map((a) => a.id)).toEqual([second]);
    const list = exact(
      BookkeepingReconciliationList,
      await call('get', `/periods/${period}/reconciliations`, people.staffA),
    );
    expect(list.items).toHaveLength(1);
    expect(
      exact(
        BookkeepingReconciliation,
        await call('get', `/reconciliations/${reconId}`, people.staffA),
      ).id,
    ).toBe(reconId);
    expect(await auditActions(reconId)).toContain('bookkeeping.reconciliation.created');
  });

  it('saves progress, goes to review, and is approved only when the difference and exceptions are clear', async () => {
    const saved = exact(
      BookkeepingReconciliation,
      await call('patch', `/reconciliations/${reconId}`, people.staffA, {
        clearedBalanceCents: 4_900_000,
        clearedCount: 30,
      }),
    );
    expect(saved).toMatchObject({
      differenceCents: 100_000,
      clearedCount: 30,
      status: 'IN_PROGRESS',
    });
    expectError(
      await call('patch', `/reconciliations/${reconId}`, people.staffA, {}),
      400,
      'VALIDATION_FAILED',
    );
    expectError(
      await call('patch', `/reconciliations/${reconId}`, people.staffA, {
        statementEnd: '2039-01-01',
      }),
      400,
      'VALIDATION_FAILED',
    );
    expectError(
      await call('post', `/reconciliations/${reconId}/approve`, people.ownerA, {}),
      409,
      'RECON_STATE',
    );
    const ready = exact(
      BookkeepingReconciliation,
      await call('post', `/reconciliations/${reconId}/ready`, people.staffA, {}),
    );
    expect(ready.status).toBe('READY_FOR_REVIEW');
    expect(ready.readyForReviewAt).not.toBeNull();
    expectError(
      await call('post', `/reconciliations/${reconId}/ready`, people.staffA, {}),
      409,
      'RECON_STATE',
    );
    expectError(
      await call('patch', `/reconciliations/${reconId}`, people.staffA, {
        clearedBalanceCents: 5_000_000,
      }),
      409,
      'RECON_STATE',
    );
    expectError(
      await call('post', `/reconciliations/${reconId}/approve`, people.staffA, {}),
      403,
      'FORBIDDEN',
    );
    expectError(
      await call('post', `/reconciliations/${reconId}/approve`, people.ownerA, {}),
      409,
      'RECON_DIFFERENCE',
    );
    // Back for more work, with a reason.
    expectError(
      await call('post', `/reconciliations/${reconId}/reopen`, people.staffA, { reason: 'x' }),
      403,
      'FORBIDDEN',
    );
    expectError(
      await call('post', `/reconciliations/${reconId}/reopen`, people.ownerA, {}),
      400,
      'VALIDATION_FAILED',
    );
    const reopened = exact(
      BookkeepingReconciliation,
      await call('post', `/reconciliations/${reconId}/reopen`, people.ownerA, {
        reason: 'Missing a deposit',
      }),
    );
    expect(reopened).toMatchObject({
      status: 'REOPENED',
      reopenReason: 'Missing a deposit',
      readyForReviewAt: null,
    });
    // The difference is cleared, but an exception is still open.
    await call('patch', `/reconciliations/${reconId}`, people.staffA, {
      clearedBalanceCents: 5_000_000,
    });
    await call('post', `/reconciliations/${reconId}/ready`, people.staffA, {});
    const open = await call('post', `/reconciliations/${reconId}/approve`, people.ownerA, {});
    expectError(open, 409, 'RECON_STATE');
    await call('post', `/reconciliations/${reconId}/reopen`, people.ownerA, {
      reason: 'Resolve the exception',
    });
    await call('patch', `/reconciliations/${reconId}`, people.staffA, { exceptionsCount: 0 });
    await call('post', `/reconciliations/${reconId}/ready`, people.staffA, {});
    const done = exact(
      BookkeepingReconciliation,
      await call('post', `/reconciliations/${reconId}/approve`, people.ownerA, {}),
    );
    expect(done).toMatchObject({
      status: 'APPROVED',
      differenceCents: 0,
      withinTolerance: true,
      approvedBy: { userId: people.ownerA.id },
    });
    expect(done.approvedAt).not.toBeNull();
    expectError(
      await call('post', `/reconciliations/${reconId}/approve`, people.ownerA, {}),
      409,
      'RECON_STATE',
    );
    expect(await auditActions(reconId)).toEqual(
      expect.arrayContaining([
        'bookkeeping.reconciliation.saved',
        'bookkeeping.reconciliation.ready',
        'bookkeeping.reconciliation.approved',
        'bookkeeping.reconciliation.reopened',
      ]),
    );
  });

  it('needs the statement attached before approval, apart from the zero difference (Review 2, R01c)', async () => {
    const third = (await mkAccount(bk, { name: 'Fake statement account' })).id;
    const { statementDocumentId: _none, ...noStatement } = body();
    const r = exact(
      BookkeepingReconciliation,
      await call('post', `/periods/${period}/reconciliations`, people.staffA, {
        ...noStatement,
        accountId: third,
        clearedBalanceCents: 5_000_000,
        exceptionsCount: 0,
      }),
      201,
    );
    expect(r).toMatchObject({ differenceCents: 0, statementDocumentId: null });
    await call('post', `/reconciliations/${r.id}/ready`, people.staffA, {});
    expectError(
      await call('post', `/reconciliations/${r.id}/approve`, people.ownerA, {}),
      409,
      'STATEMENTS_MISSING',
    );
    // Back to work, attach it, and the same zero difference approves.
    await call('post', `/reconciliations/${r.id}/reopen`, people.ownerA, {
      reason: 'Fake: attach the statement',
    });
    exact(
      BookkeepingReconciliation,
      await call('patch', `/reconciliations/${r.id}`, people.staffA, {
        statementDocumentId: statement,
      }),
    );
    await call('post', `/reconciliations/${r.id}/ready`, people.staffA, {});
    expect(
      exact(
        BookkeepingReconciliation,
        await call('post', `/reconciliations/${r.id}/approve`, people.ownerA, {}),
      ).status,
    ).toBe('APPROVED');
  });

  it('keeps a note on the difference with who wrote it and when, for the reviewer (Review 2, R01)', async () => {
    const fourth = (await mkAccount(bk, { name: 'Fake note account' })).id;
    const r = exact(
      BookkeepingReconciliation,
      await call('post', `/periods/${period}/reconciliations`, people.staffA, {
        ...body(),
        accountId: fourth,
        exceptionsCount: 0,
      }),
      201,
    );
    expect(r.discrepancyNote).toBeNull();
    const noted = exact(
      BookkeepingReconciliation,
      await call('patch', `/reconciliations/${r.id}`, people.staffA, {
        discrepancyNote: '  Fake: a $5,000 deposit in transit clears on the 3rd  ',
      }),
    );
    expect(noted.discrepancyNote).toMatchObject({
      text: 'Fake: a $5,000 deposit in transit clears on the 3rd',
      by: { userId: people.staffA.id },
    });
    // The reviewer reads it; it never lets a difference through.
    await call('post', `/reconciliations/${r.id}/ready`, people.staffA, {});
    const read = exact(
      BookkeepingReconciliation,
      await call('get', `/reconciliations/${r.id}`, people.ownerA),
    );
    expect(read.discrepancyNote?.text).toMatch(/deposit in transit/);
    expectError(
      await call('post', `/reconciliations/${r.id}/approve`, people.ownerA, {}),
      409,
      'RECON_DIFFERENCE',
    );
    // The note's text never goes to the audit log.
    const logged = await asOwner(ids.firmA, (tx) =>
      tx.auditLog.findMany({ where: { entityId: r.id }, select: { metadata: true } }),
    );
    expect(logged.length).toBeGreaterThan(0);
    expect(JSON.stringify(logged)).not.toMatch(/deposit in transit/);
    await call('post', `/reconciliations/${r.id}/reopen`, people.ownerA, { reason: 'Fake: redo' });
    const cleared = exact(
      BookkeepingReconciliation,
      await call('patch', `/reconciliations/${r.id}`, people.staffA, { discrepancyNote: null }),
    );
    expect(cleared.discrepancyNote).toBeNull();
  });

  it("zero tolerance: the firm's old tolerance setting lets no difference through", async () => {
    await call('put', '/settings', people.ownerA, { reconToleranceCents: 500 });
    const second = (await mkAccount(bk, { name: 'Fake tolerance account' })).id;
    const r = exact(
      BookkeepingReconciliation,
      await call('post', `/periods/${period}/reconciliations`, people.staffA, {
        ...body(),
        accountId: second,
        clearedBalanceCents: 4_999_700,
        exceptionsCount: 0,
      }),
      201,
    );
    expect(r).toMatchObject({ differenceCents: 300, toleranceCents: 0, withinTolerance: false });
    await call('post', `/reconciliations/${r.id}/ready`, people.staffA, {});
    expectError(
      await call('post', `/reconciliations/${r.id}/approve`, people.ownerA, {}),
      409,
      'RECON_DIFFERENCE',
    );
    await call('put', '/settings', people.ownerA, {});
  });

  it('a closed period locks its reconciliations', async () => {
    await call('post', `/periods/${period}/ready`, people.staffA, {});
    const approved = exact(
      BookkeepingPeriod,
      await call('post', `/periods/${period}/approve`, people.ownerA, {}),
    );
    for (const item of approved.closeItems.filter((i) => i.required)) {
      await call('patch', `/periods/${period}/close-items/${item.id}`, people.staffA, {
        completed: true,
      });
    }
    expect(
      exact(BookkeepingPeriod, await call('post', `/periods/${period}/close`, people.ownerA, {}))
        .status,
    ).toBe('CLOSED');
    expectError(
      await call('patch', `/reconciliations/${reconId}`, people.staffA, { exceptionsCount: 2 }),
      409,
      'PERIOD_LOCKED',
    );
    expectError(
      await call('post', `/reconciliations/${reconId}/reopen`, people.ownerA, {
        reason: 'Too late',
      }),
      409,
      'PERIOD_LOCKED',
    );
    expectError(
      await call('post', `/periods/${period}/reconciliations`, people.staffA, {
        ...body(),
        accountId: (await mkAccount(bk)).id,
      }),
      409,
      'PERIOD_LOCKED',
    );
  });
});

describe('reports', () => {
  let bk = '';
  let engagementId = '';
  beforeAll(async () => {
    bk = await bkFor(clients.reports);
    engagementId = exact(
      BookkeepingClientWorkspace,
      await call('get', `/clients/${bk}`, people.ownerA),
    ).engagementId;
  });

  it('adds a report to prepare, with its name, period and due date', async () => {
    const r = await mkReport(bk, { basis: 'ACCRUAL' });
    expect(r).toMatchObject({
      bookkeepingClientId: bk,
      reportType: 'PROFIT_LOSS',
      name: 'Profit & Loss',
      status: 'NOT_STARTED',
      basis: 'ACCRUAL',
      dueOn: day(7),
      overdue: false,
      generatedAt: null,
      deliveredAt: null,
      engagementReportId: null,
    });
    expect(r.client.id).toBe(clients.reports);
    expectError(
      await call('post', `/clients/${bk}/reports`, people.staffA, {
        reportType: 'PROFIT_LOSS',
        periodLabel: r.periodLabel,
      }),
      409,
      'DUPLICATE',
    );
    const custom = await mkReport(bk, { reportType: 'CUSTOM', customName: 'Fake cash review' });
    expect(custom).toMatchObject({
      name: 'Fake cash review',
      customName: 'Fake cash review',
      reportType: 'CUSTOM',
    });
    expectError(
      await call('post', `/clients/${bk}/reports`, people.staffA, {
        reportType: 'CUSTOM',
        periodLabel: 'x',
      }),
      400,
      'VALIDATION_FAILED',
    );
    expectError(
      await call('post', `/clients/${bk}/reports`, people.staffA, {
        reportType: 'CASH_FLOW',
        customName: 'x',
        periodLabel: 'x',
      }),
      400,
      'VALIDATION_FAILED',
    );
    expectError(
      await call('post', `/clients/${bk}/reports`, people.staffA, {
        reportType: 'CASH_FLOW',
        periodLabel: 'x',
        periodId: randomUUID(),
      }),
      409,
      'NOT_THIS_CLIENTS',
    );
    const otherBk = await bkFor(clients.close);
    const otherPeriod = await mkPeriod(otherBk);
    expectError(
      await call('post', `/clients/${bk}/reports`, people.staffA, {
        reportType: 'CASH_FLOW',
        periodLabel: 'x',
        periodId: otherPeriod.id,
      }),
      409,
      'NOT_THIS_CLIENTS',
    );
    const ownPeriod = await mkPeriod(bk);
    const linked = await mkReport(bk, { reportType: 'BALANCE_SHEET', periodId: ownPeriod.id });
    expect(linked.periodId).toBe(ownPeriod.id);
    expect(
      exact(
        BookkeepingPeriod,
        await call('get', `/periods/${ownPeriod.id}`, people.staffA),
      ).reports.map((x) => x.id),
    ).toEqual([linked.id]);
    expect(await auditActions(r.id)).toContain('bookkeeping.report.added');
  });

  it('prepares, reviews, approves and delivers a report against the published one', async () => {
    const r = await mkReport(bk);
    expectError(
      await call('post', `/reports/${r.id}/submit-review`, people.staffA, {}),
      409,
      'REPORT_STATE',
    );
    const started = exact(
      BookkeepingReportRow,
      await call('post', `/reports/${r.id}/start`, people.staffA, {}),
    );
    expect(started).toMatchObject({
      status: 'IN_PROGRESS',
      generatedBy: { userId: people.staffA.id },
    });
    expect(started.generatedAt).not.toBeNull();
    expectError(
      await call('post', `/reports/${r.id}/start`, people.staffA, {}),
      409,
      'REPORT_STATE',
    );
    expectError(
      await call('post', `/reports/${r.id}/approve`, people.ownerA, {}),
      409,
      'REPORT_STATE',
    );
    expect(
      exact(
        BookkeepingReportRow,
        await call('post', `/reports/${r.id}/submit-review`, people.staffA, {}),
      ).status,
    ).toBe('IN_REVIEW');
    expectError(
      await call('post', `/reports/${r.id}/approve`, people.staffA, {}),
      403,
      'FORBIDDEN',
    );
    const approved = exact(
      BookkeepingReportRow,
      await call('post', `/reports/${r.id}/approve`, people.ownerA, {}),
    );
    expect(approved).toMatchObject({
      status: 'APPROVED',
      reviewedBy: { userId: people.ownerA.id },
    });
    // Delivery needs the client's published report.
    const draft = await asOwner(ids.firmA, (tx) =>
      tx.engagementReport.create({
        data: { businessId: ids.firmA, engagementId, kind: 'REPORT', title: 'Fake draft' },
      }),
    );
    expectError(
      await call('post', `/reports/${r.id}/deliver`, people.staffA, {
        engagementReportId: draft.id,
      }),
      403,
      'FORBIDDEN',
    );
    expectError(
      await call('post', `/reports/${r.id}/deliver`, people.ownerA, {
        engagementReportId: draft.id,
      }),
      409,
      'REPORT_NOT_PUBLISHED',
    );
    const otherEngagement = exact(
      BookkeepingClientWorkspace,
      await call('get', `/clients/${await bkFor(clients.close)}`, people.ownerA),
    ).engagementId;
    const foreignPublished = await mkPublishedReport(otherEngagement);
    expectError(
      await call('post', `/reports/${r.id}/deliver`, people.ownerA, {
        engagementReportId: foreignPublished,
      }),
      409,
      'NOT_THIS_CLIENTS',
    );
    expectError(
      await call('post', `/reports/${r.id}/deliver`, people.ownerA, {
        engagementReportId: randomUUID(),
      }),
      409,
      'NOT_THIS_CLIENTS',
    );
    const published = await mkPublishedReport(engagementId);
    const delivered = exact(
      BookkeepingReportRow,
      await call('post', `/reports/${r.id}/deliver`, people.ownerA, {
        engagementReportId: published,
      }),
    );
    expect(delivered).toMatchObject({
      status: 'DELIVERED',
      engagementReportId: published,
      deliveredBy: { userId: people.ownerA.id },
      overdue: false,
    });
    expect(delivered.deliveredAt).not.toBeNull();
    // Delivered means frozen.
    expectError(
      await call('patch', `/reports/${r.id}`, people.ownerA, { basis: 'CASH' }),
      409,
      'REPORT_STATE',
    );
    expectError(
      await call('post', `/reports/${r.id}/start`, people.ownerA, {}),
      409,
      'REPORT_STATE',
    );
    // One published report serves one bookkeeping report.
    const next = await mkReport(bk);
    await call('post', `/reports/${next.id}/start`, people.staffA, {});
    await call('post', `/reports/${next.id}/submit-review`, people.staffA, {});
    await call('post', `/reports/${next.id}/approve`, people.ownerA, {});
    expectError(
      await call('post', `/reports/${next.id}/deliver`, people.ownerA, {
        engagementReportId: published,
      }),
      409,
      'DUPLICATE',
    );
    const actions = await auditActions(r.id);
    expect(actions).toEqual(
      expect.arrayContaining([
        'bookkeeping.report.started',
        'bookkeeping.report.submitted',
        'bookkeeping.report.approved',
        'bookkeeping.report.delivered',
      ]),
    );
    const history = exact(
      BookkeepingActivityList,
      await call('get', `/clients/${bk}/activities?pageSize=50`, people.ownerA),
    );
    expect(history.items.map((a) => a.kind)).toContain('REPORT');
  });

  it('sends a report back with a note, and Staff cannot', async () => {
    const r = await mkReport(bk);
    await call('post', `/reports/${r.id}/start`, people.staffA, {});
    await call('post', `/reports/${r.id}/submit-review`, people.staffA, {});
    expectError(
      await call('post', `/reports/${r.id}/send-back`, people.staffA, {}),
      403,
      'FORBIDDEN',
    );
    const back = exact(
      BookkeepingReportRow,
      await call('post', `/reports/${r.id}/send-back`, people.adminA, {
        note: 'Check the owner draws',
      }),
    );
    expect(back).toMatchObject({
      status: 'IN_PROGRESS',
      reviewNote: 'Check the owner draws',
      reviewedAt: null,
    });
    expectError(
      await call('post', `/reports/${r.id}/send-back`, people.adminA, {}),
      409,
      'REPORT_STATE',
    );
    const noted = exact(
      BookkeepingReportRow,
      await call('patch', `/reports/${r.id}`, people.staffA, { reviewNote: null, dueOn: day(-3) }),
    );
    expect(noted).toMatchObject({ reviewNote: null, dueOn: day(-3), overdue: true });
    expectError(
      await call('patch', `/reports/${r.id}`, people.staffA, {}),
      400,
      'VALIDATION_FAILED',
    );
    expect(
      exact(BookkeepingReportRow, await call('get', `/reports/${r.id}`, people.staffA)).id,
    ).toBe(r.id);
    expectError(await call('get', `/reports/${randomUUID()}`, people.staffA), 404, 'NOT_FOUND');
  });

  it('lists reports firm-wide and per client with filters, and the overview shows the upcoming ones', async () => {
    const firm = exact(
      BookkeepingReportPage,
      await call('get', '/reports?pageSize=100', people.ownerA),
    );
    expect(firm.total).toBeGreaterThanOrEqual(5);
    const q = async (query: string) =>
      exact(
        BookkeepingReportPage,
        await call('get', `/reports?pageSize=100&${query}`, people.ownerA),
      ).items;
    expect((await q('status=DELIVERED')).every((r) => r.status === 'DELIVERED')).toBe(true);
    expect((await q('reportType=CUSTOM')).map((r) => r.name)).toEqual(['Fake cash review']);
    expect((await q('overdue=true')).every((r) => r.overdue)).toBe(true);
    expect((await q('overdue=true')).length).toBeGreaterThanOrEqual(1);
    const upcoming = await q('upcoming=true');
    expect(
      upcoming.every((r) => r.status !== 'DELIVERED' && r.dueOn! >= day() && r.dueOn! <= day(14)),
    ).toBe(true);
    expect(upcoming.length).toBeGreaterThanOrEqual(1);
    expect((await q(`bookkeepingClientId=${bk}`)).every((r) => r.bookkeepingClientId === bk)).toBe(
      true,
    );
    expect((await q('search=cash review')).map((r) => r.name)).toEqual(['Fake cash review']);
    expect((await q(`dueFrom=${day(6)}&dueTo=${day(8)}`)).length).toBeGreaterThanOrEqual(1);
    const mine = exact(
      BookkeepingReportPage,
      await call('get', `/clients/${bk}/reports?pageSize=100`, people.staffA),
    );
    expect(mine.items.every((r) => r.bookkeepingClientId === bk)).toBe(true);
    expectError(
      await call('get', `/clients/${randomUUID()}/reports`, people.staffA),
      404,
      'NOT_FOUND',
    );
    const o = exact(BookkeepingOverview, await call('get', '/overview', people.ownerA));
    expect(o.upcomingReports.length).toBeGreaterThanOrEqual(1);
    expect(o.upcomingReports[0]).toMatchObject({
      bookkeepingClientId: expect.any(String),
      dueOn: expect.any(String),
    });
    expect(o.upcomingReports.map((r) => r.dueOn)).toEqual(
      [...o.upcomingReports.map((r) => r.dueOn)].sort(),
    );
    const ws = exact(
      BookkeepingClientWorkspace,
      await call('get', `/clients/${bk}`, people.ownerA),
    );
    expect(ws.upcomingReports.every((r) => r.status !== 'DELIVERED')).toBe(true);
  });

  it('exports the filtered reports as a CSV', async () => {
    const res = await call('get', '/reports/export?reportType=CUSTOM', people.ownerA);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/csv');
    expect(res.headers['content-disposition']).toContain('bookkeeping-reports.csv');
    expect(res.text.split('\r\n')[0]).toBe(
      'Client,Report,Period,Basis,Due,Status,Overdue,Delivered',
    );
    expect(res.text).toContain('Fake cash review');
    expect(res.text).not.toContain('Profit & Loss');
    expect((await call('get', '/reports/export', undefined)).status).toBe(401);
  });
});

describe('settings', () => {
  const body = {
    defaultCadence: 'QUARTERLY',
    closeTargetDay: 15,
    upcomingReportDays: 21,
    staleSyncHours: 24,
    reconToleranceCents: 100,
    statusRules: { missingDocumentsAfterDays: 3, overdueAfterDays: 2 },
    reminderDefaults: [{ daysBefore: 3, channels: ['EMAIL', 'PORTAL'] }],
    reportSchedule: [
      { report: 'PROFIT_LOSS', cadence: 'MONTHLY', dueDay: 12, delivery: 'PORTAL_AND_EMAIL' },
    ],
    documentChecklist: [{ label: 'Bank statements', cadence: 'MONTHLY' }],
    closeChecklist: [
      { key: 'categorization', label: 'Categorization done', required: true },
      { key: 'review', label: 'Owner review', required: false },
    ],
  } as const;

  it('saves, reads back, drives new clients and periods, and defaults when sent empty', async () => {
    const saved = exact(BookkeepingSettings, await call('put', '/settings', people.ownerA, body));
    expect(saved).toMatchObject({ ...body, closeChecklist: [...body.closeChecklist] });
    expect(saved.updatedAt).not.toBeNull();
    expect(exact(BookkeepingSettings, await call('get', '/settings', people.adminA))).toEqual(
      saved,
    );
    // A new client takes the firm's cadence; a new period takes the firm's checklist.
    const fresh = await addClient(
      clients.foreign.length ? clients.unassigned : clients.unassigned,
    ).catch(async () => null);
    expect(fresh === null || fresh.cadence === 'QUARTERLY').toBe(true);
    const bk = await bkFor(clients.conn);
    const p = await mkPeriod(bk);
    expect(p.closeItems.map((i) => [i.itemKey, i.required])).toEqual([
      ['categorization', true],
      ['review', false],
    ]);
    expect(p.closeByOn!.endsWith('-15')).toBe(true);
    expect(await auditActions(ids.firmA)).toBeDefined();
    const reset = exact(BookkeepingSettings, await call('put', '/settings', people.ownerA, {}));
    expect(reset).toMatchObject({
      defaultCadence: 'MONTHLY',
      closeTargetDay: 10,
      closeChecklist: [],
      reminderDefaults: [],
    });
  });

  it('refuses values the database would, and fields it does not know', async () => {
    for (const bad of [
      { closeTargetDay: 31 },
      { closeTargetDay: 0 },
      { upcomingReportDays: 91 },
      { staleSyncHours: 0 },
      { reconToleranceCents: -1 },
      { statusRules: { nope: 1 } },
      { reminderDefaults: [{ daysBefore: 3, channels: [] }] },
      { reportSchedule: [{ report: 'NOPE', cadence: 'MONTHLY', dueDay: 12, delivery: 'PORTAL' }] },
      {
        documentChecklist: [
          { label: 'A', cadence: 'MONTHLY' },
          { label: 'a', cadence: 'MONTHLY' },
        ],
      },
      { closeChecklist: [{ key: 'Bad Key', label: 'x', required: true }] },
      {
        closeChecklist: [
          { key: 'one', label: 'x', required: true },
          { key: 'one', label: 'y', required: true },
        ],
      },
      { somethingElse: true },
    ]) {
      expectError(await call('put', '/settings', people.ownerA, bad), 400, 'VALIDATION_FAILED');
    }
    expect(await auditActions(ids.firmA)).toBeDefined();
  });
});

describe('transactions and categories (BK-T01, read side)', () => {
  it('lists the ledger newest first, with search, filters and counts; Staff only their clients', async () => {
    const bk = await bkOf(clients.assigned);
    const ws = exact(
      BookkeepingClientWorkspace,
      await call('get', `/clients/${bk}`, people.ownerA),
    );
    const account = await mkAccount(bk);
    const A = { businessId: ids.firmA, engagementId: ws.engagementId };
    const category = await asOwner(ids.firmA, (tx) =>
      tx.bookkeepingCategory.create({
        data: { ...A, name: 'Fake Office Supplies', type: 'EXPENSE' },
        select: { id: true },
      }),
    );
    await asOwner(ids.firmA, async (tx) => {
      for (const [date, payee, cents, status] of [
        ['2026-09-02', 'Fake Paper Co', 4200, 'CATEGORIZED'],
        ['2026-09-15', 'Fake Coffee Roasters', 1850, 'UNCATEGORIZED'],
        ['2026-10-01', 'Fake Landlord LLC', 120000, 'NEEDS_REVIEW'],
      ] as const) {
        await tx.bookkeepingTransaction.create({
          data: {
            ...A,
            accountId: account.id,
            transactionDate: new Date(`${date}T00:00:00.000Z`),
            description: `Fake ${payee} payment`,
            payee,
            amountCents: cents,
            direction: 'DEBIT',
            status,
            source: 'MANUAL',
            ...(status === 'CATEGORIZED' ? { categoryId: category.id } : {}),
          },
        });
      }
    });

    const page = exact(
      BookkeepingTransactionPage,
      await call('get', `/clients/${bk}/transactions`, people.staffA),
    );
    expect(page.items.map((r) => r.payee)).toEqual([
      'Fake Landlord LLC',
      'Fake Coffee Roasters',
      'Fake Paper Co',
    ]);
    expect(page.counts).toMatchObject({ all: 3, uncategorized: 1, needsReview: 1, categorized: 1 });
    expect(page.items[2]).toMatchObject({
      category: { id: category.id, name: 'Fake Office Supplies' },
      account: { id: account.id },
      splitCount: 0,
      hasReceipt: false,
      cleared: false,
    });
    const searched = exact(
      BookkeepingTransactionPage,
      await call('get', `/clients/${bk}/transactions?search=coffee`, people.ownerA),
    );
    expect(searched.items.map((r) => r.payee)).toEqual(['Fake Coffee Roasters']);
    expect(searched.counts.all).toBe(3);
    const ranged = exact(
      BookkeepingTransactionPage,
      await call(
        'get',
        `/clients/${bk}/transactions?status=CATEGORIZED&from=2026-09-01&to=2026-09-30`,
        people.ownerA,
      ),
    );
    expect(ranged.total).toBe(1);
    // Review 2 (T01a): by source, and by amount with both ends included.
    const by = async (query: string) =>
      exact(
        BookkeepingTransactionPage,
        await call('get', `/clients/${bk}/transactions?${query}`, people.ownerA),
      ).items.map((r) => r.payee);
    expect(await by('source=MANUAL')).toHaveLength(3);
    expect(await by('source=SYNC')).toEqual([]);
    expect(await by('amountMin=1850&amountMax=4200')).toEqual([
      'Fake Coffee Roasters',
      'Fake Paper Co',
    ]);
    expect(await by('amountMin=100000')).toEqual(['Fake Landlord LLC']);
    for (const bad of ['amountMin=500&amountMax=100', 'amountMin=-1', 'source=BANK']) {
      expectError(
        await call('get', `/clients/${bk}/transactions?${bad}`, people.ownerA),
        400,
        'VALIDATION_FAILED',
      );
    }
    expectError(
      await call('get', `/clients/${bk}/transactions?from=nope`, people.ownerA),
      400,
      'VALIDATION_FAILED',
    );
    expectError(await call('get', `/clients/${bk}/transactions`, people.staff2A), 404, 'NOT_FOUND');
    expectError(
      await call('get', `/clients/${bk}/transactions`, people.ownerB, undefined, ids.firmB),
      404,
      'NOT_FOUND',
    );

    const categories = exact(
      BookkeepingCategoryList,
      await call('get', `/clients/${bk}/categories`, people.staffA),
    );
    expect(categories.items).toEqual([
      { id: category.id, name: 'Fake Office Supplies', type: 'EXPENSE', active: true },
    ]);
    expect(await auditActions(bk)).toEqual(
      expect.arrayContaining(['bookkeeping.transactions.listed', 'bookkeeping.categories.listed']),
    );
  });
});

describe('transaction engines (BK-T01)', () => {
  const setup = async () => {
    const bk = await bkOf(clients.assigned);
    const ws = exact(
      BookkeepingClientWorkspace,
      await call('get', `/clients/${bk}`, people.ownerA),
    );
    const A = { businessId: ids.firmA, engagementId: ws.engagementId };
    // Each setup has its own names: the two tests share the client.
    const tag = randomUUID().slice(0, 6);
    const checking = await mkAccount(bk, { name: `Fake engine checking ${tag}`, type: 'BANK' });
    const savings = await mkAccount(bk, { name: `Fake engine savings ${tag}`, type: 'BANK' });
    const category = (name: string, isActive = true) =>
      asOwner(ids.firmA, (tx) =>
        tx.bookkeepingCategory.create({
          data: { ...A, name: `${name} ${tag}`, type: 'EXPENSE', isActive },
          select: { id: true },
        }),
      ).then((c) => c.id);
    const rent = await category('Fake Rent');
    const supplies = await category('Fake Supplies');
    const retired = await category('Fake Retired', false);
    const mk = (accountId: string, cents: number, direction: 'DEBIT' | 'CREDIT', payee: string) =>
      asOwner(ids.firmA, (tx) =>
        tx.bookkeepingTransaction.create({
          data: {
            ...A,
            accountId,
            transactionDate: new Date('2026-10-10T00:00:00.000Z'),
            description: `Fake ${payee}`,
            payee,
            amountCents: cents,
            direction,
            source: 'MANUAL',
          },
          select: { id: true },
        }),
      ).then((t) => t.id);
    const T = (id: string, rest = '') => `/clients/${bk}/transactions/${id}${rest}`;
    return { bk, A, checking, savings, rent, supplies, retired, mk, T };
  };

  it('categorizes, splits to the amount, matches a transfer, excludes and includes, and takes a receipt; each audited', async () => {
    const { A, checking, savings, rent, supplies, retired, mk, T } = await setup();
    const a = await mk(checking.id, 5_000, 'DEBIT', 'Engine Supplies Store');
    expect(
      exact(
        BookkeepingTransactionRow,
        await call('patch', T(a, '/category'), people.staffA, { categoryId: supplies }),
      ),
    ).toMatchObject({ status: 'CATEGORIZED', category: { id: supplies } });
    expectError(
      await call('patch', T(a, '/category'), people.staffA, { categoryId: retired }),
      409,
      'CATEGORY_INACTIVE',
    );
    // A split's parts add up to the amount, and it then has no category of its own.
    expectError(
      await call('put', T(a, '/split'), people.staffA, {
        parts: [
          { categoryId: rent, amountCents: 1_000 },
          { categoryId: supplies, amountCents: 3_000 },
        ],
      }),
      409,
      'SPLIT_TOTAL',
    );
    expect(
      exact(
        BookkeepingTransactionRow,
        await call('put', T(a, '/split'), people.staffA, {
          parts: [
            { categoryId: rent, amountCents: 2_000, memo: 'Fake share' },
            { categoryId: supplies, amountCents: 3_000 },
          ],
        }),
      ),
    ).toMatchObject({ status: 'CATEGORIZED', category: null, splitCount: 2 });

    // A transfer: the same amount the other way on another account; each side names the other.
    const out = await mk(checking.id, 25_000, 'DEBIT', 'Engine transfer out');
    const into = await mk(savings.id, 25_000, 'CREDIT', 'Engine transfer in');
    const near = await mk(savings.id, 24_999, 'CREDIT', 'Engine near miss');
    const candidates = exact(
      BookkeepingTransferCandidates,
      await call('get', T(out, '/transfer-candidates'), people.staffA),
    );
    expect(candidates.items.map((c) => c.id)).toEqual([into]);
    expectError(
      await call('post', T(out, '/transfer'), people.staffA, { pairId: near }),
      409,
      'NOT_A_TRANSFER',
    );
    expect(
      exact(
        BookkeepingTransactionRow,
        await call('post', T(out, '/transfer'), people.staffA, { pairId: into }),
      ),
    ).toMatchObject({ kind: 'TRANSFER', status: 'CATEGORIZED', category: null });
    const sides = await asOwner(ids.firmA, (tx) =>
      tx.bookkeepingTransaction.findMany({
        where: { ...A, id: { in: [out, into] } },
        select: { id: true, transferPairId: true, kind: true },
      }),
    );
    expect(Object.fromEntries(sides.map((s) => [s.id, s.transferPairId]))).toEqual({
      [out]: into,
      [into]: out,
    });
    // Categorizing one side takes the transfer apart on both.
    exact(
      BookkeepingTransactionRow,
      await call('patch', T(into, '/category'), people.staffA, { categoryId: rent }),
    );
    const after = await asOwner(ids.firmA, (tx) =>
      tx.bookkeepingTransaction.findUniqueOrThrow({
        where: { businessId_id: { businessId: ids.firmA, id: out } },
        select: { transferPairId: true, status: true, kind: true },
      }),
    );
    expect(after).toEqual({ transferPairId: null, status: 'UNCATEGORIZED', kind: 'STANDARD' });

    // Exclude needs a reason; Include brings it back as it was.
    expectError(
      await call('post', T(near, '/exclude'), people.staffA, {}),
      400,
      'VALIDATION_FAILED',
    );
    expect(
      exact(
        BookkeepingTransactionRow,
        await call('post', T(near, '/exclude'), people.staffA, { reason: 'Fake duplicate line' }),
      ),
    ).toMatchObject({ status: 'EXCLUDED' });
    expect(
      exact(BookkeepingTransactionRow, await call('post', T(near, '/include'), people.staffA, {})),
    ).toMatchObject({ status: 'UNCATEGORIZED' });

    // A receipt is one of the client's own documents on this workspace.
    const doc = await asOwner(ids.firmA, (tx) =>
      tx.document.create({
        data: {
          ...A,
          clientId: clients.assigned,
          direction: 'CLIENT_TO_FIRM',
          fileName: 'fake-receipt.pdf',
          contentType: 'application/pdf',
          sizeBytes: 100,
          sha256: 'a'.repeat(64),
          s3Key: `tenant/${ids.firmA}/fake/${randomUUID()}/fake-receipt.pdf`,
        },
        select: { id: true },
      }),
    );
    expect(
      exact(
        BookkeepingTransactionRow,
        await call('put', T(a, '/receipt'), people.staffA, { documentId: doc.id }),
      ),
    ).toMatchObject({ hasReceipt: true });
    expectError(
      await call('put', T(a, '/receipt'), people.staffA, { documentId: randomUUID() }),
      404,
      'NOT_FOUND',
    );

    const audit = await asOwner(ids.firmA, (tx) =>
      tx.auditLog.findMany({
        where: { entityType: 'bookkeeping_transaction', entityId: { in: [a, out, into, near] } },
        select: { action: true, metadata: true },
      }),
    );
    expect(audit.map((x) => x.action)).toEqual(
      expect.arrayContaining([
        'bookkeeping.transaction.categorized',
        'bookkeeping.transaction.split',
        'bookkeeping.transaction.transfer_matched',
        'bookkeeping.transaction.excluded',
        'bookkeeping.transaction.included',
        'bookkeeping.transaction.receipt_changed',
      ]),
    );
    expect(JSON.stringify(audit)).not.toMatch(/Engine Supplies Store|Fake share|Fake duplicate/);
  });

  it("bulk changes the client's lines or none; Staff only their clients; another firm not at all", async () => {
    const { bk, checking, supplies, mk, T } = await setup();
    const one = await mk(checking.id, 1_200, 'DEBIT', 'Engine bulk one');
    const two = await mk(checking.id, 3_400, 'DEBIT', 'Engine bulk two');
    // A line that is not the client's refuses the whole request, and nothing changes.
    expectError(
      await call('post', `/clients/${bk}/transactions/bulk`, people.staffA, {
        ids: [one, two, randomUUID()],
        action: 'CATEGORIZE',
        categoryId: supplies,
      }),
      404,
      'NOT_FOUND',
    );
    const result = exact(
      BulkBookkeepingTransactionsResult,
      await call('post', `/clients/${bk}/transactions/bulk`, people.staffA, {
        ids: [one, two],
        action: 'CATEGORIZE',
        categoryId: supplies,
      }),
    );
    expect(result).toEqual({ done: 2, refused: [] });
    expectError(
      await call('post', `/clients/${bk}/transactions/bulk`, people.staffA, {
        ids: [one],
        action: 'EXCLUDE',
      }),
      400,
      'VALIDATION_FAILED',
    );
    expectError(
      await call('patch', T(one, '/category'), people.staff2A, { categoryId: supplies }),
      404,
      'NOT_FOUND',
    );
    expectError(
      await call('patch', T(one, '/category'), people.ownerB, { categoryId: supplies }, ids.firmB),
      404,
      'NOT_FOUND',
    );
    expectError(
      await call(
        'post',
        `/clients/${bk}/transactions/bulk`,
        people.ownerB,
        { ids: [one], action: 'INCLUDE' },
        ids.firmB,
      ),
      404,
      'NOT_FOUND',
    );
  });
});

describe('report figures and versions (BK-RPT part 1)', () => {
  it('previews, generates immutable numbered versions from the period ledger, lists them and downloads one', async () => {
    const bk = await bkOf(clients.assigned);
    await ledgerPnl(bk);
    const ws = exact(
      BookkeepingClientWorkspace,
      await call('get', `/clients/${bk}`, people.ownerA),
    );
    const A = { businessId: ids.firmA, engagementId: ws.engagementId };
    const tag = randomUUID().slice(0, 6);
    const p = await mkPeriod(bk);
    const acct = await mkAccount(bk, { name: `Fake report checking ${tag}` });
    const category = (name: string, type: 'INCOME' | 'EXPENSE') =>
      asOwner(ids.firmA, (tx) =>
        tx.bookkeepingCategory.create({
          data: { ...A, name: `${name} ${tag}`, type },
          select: { id: true },
        }),
      ).then((c) => c.id);
    const fees = await category('Fake Fees', 'INCOME');
    const rent = await category('Fake Rent', 'EXPENSE');
    const mk = (
      on: string,
      cents: number,
      direction: 'DEBIT' | 'CREDIT',
      categoryId: string | null,
      status: 'CATEGORIZED' | 'UNCATEGORIZED' | 'EXCLUDED' = categoryId
        ? 'CATEGORIZED'
        : 'UNCATEGORIZED',
    ) =>
      asOwner(ids.firmA, (tx) =>
        tx.bookkeepingTransaction.create({
          data: {
            ...A,
            accountId: acct.id,
            transactionDate: new Date(`${on}T00:00:00.000Z`),
            description: 'Fake report line',
            amountCents: cents,
            direction,
            status,
            source: 'MANUAL',
            categoryId,
            ...(status === 'EXCLUDED' ? { excludedReason: 'Fake duplicate' } : {}),
          },
        }),
      );
    await mk(p.periodStart, 120_000, 'CREDIT', fees);
    await mk(p.periodEnd, 30_000, 'DEBIT', rent);
    await mk(p.periodStart, 5_000, 'DEBIT', null);
    await mk(p.periodStart, 999, 'DEBIT', rent, 'EXCLUDED');
    // The day before the period: not in it.
    const before = new Date(Date.parse(`${p.periodStart}T00:00:00.000Z`) - 86_400_000)
      .toISOString()
      .slice(0, 10);
    await mk(before, 7_777, 'DEBIT', rent);

    const r = await mkReport(bk, { reportType: 'PROFIT_LOSS', periodId: p.id, basis: 'ACCRUAL' });
    const preview = exact(
      BookkeepingReportPreview,
      await call('get', `/reports/${r.id}/preview`, people.staffA),
    );
    expect(preview).toMatchObject({
      supported: true,
      period: { start: p.periodStart, end: p.periodEnd },
    });
    expect(preview.figures!.totals).toMatchObject({
      incomeCents: 120_000,
      expensesCents: 30_000,
      netIncomeCents: 90_000,
    });
    expect(preview.figures!.lineCount).toBe(3);
    expect(preview.figures!.basisNote).toMatch(/cash basis/);

    const v1 = exact(
      BookkeepingReportVersionRow,
      await call('post', `/reports/${r.id}/generate`, people.staffA, {}),
    );
    expect(v1).toMatchObject({ version: 1, deliveryStatus: 'NOT_SENT' });
    // A later line changes the next version, never the first.
    await mk(p.periodStart, 10_000, 'CREDIT', fees);
    const v2 = exact(
      BookkeepingReportVersionRow,
      await call('post', `/reports/${r.id}/generate`, people.staffA, {}),
    );
    expect([v2.version, v2.figures.totals.incomeCents]).toEqual([2, 130_000]);
    const list = exact(
      BookkeepingReportVersionList,
      await call('get', `/reports/${r.id}/versions`, people.staffA),
    );
    expect(list.items.map((v) => [v.version, v.figures.totals.incomeCents])).toEqual([
      [2, 130_000],
      [1, 120_000],
    ]);
    await expect(
      asOwner(ids.firmA, (tx) =>
        tx.bookkeepingReportVersion.updateMany({
          where: { businessId: ids.firmA, reportId: r.id, version: 1 },
          data: { summary: {} },
        }),
      ),
    ).rejects.toThrow(/never changes/);

    const file = await call('get', `/reports/${r.id}/versions/1/csv`, people.ownerA);
    expect(file.status).toBe(200);
    expect(file.headers['content-type']).toMatch(/text\/csv/);
    expect(file.text).toContain(`Income,Fake Fees ${tag},,,1200.00,`);
    expect(file.text).toContain('Total,Net income,,,900.00,');
    expectError(
      await call('get', `/reports/${r.id}/versions/9/csv`, people.ownerA),
      404,
      'NOT_FOUND',
    );

    // A type not worked out yet, and a report with no period, say so.
    const bs = await mkReport(bk, {
      reportType: 'CUSTOM',
      customName: 'Fake custom report',
      periodId: p.id,
    });
    expectError(
      await call('post', `/reports/${bs.id}/generate`, people.staffA, {}),
      409,
      'REPORT_NOT_SUPPORTED',
    );
    const none = await mkReport(bk, { reportType: 'TRIAL_BALANCE' });
    expectError(
      await call('post', `/reports/${none.id}/generate`, people.staffA, {}),
      409,
      'NO_PERIOD',
    );
    expect(
      exact(
        BookkeepingReportPreview,
        await call('get', `/reports/${none.id}/preview`, people.staffA),
      ),
    ).toMatchObject({ supported: false, figures: null });

    // Staff on another's client and another firm reach nothing.
    expectError(await call('get', `/reports/${r.id}/preview`, people.staff2A), 404, 'NOT_FOUND');
    expectError(
      await call('post', `/reports/${r.id}/generate`, people.ownerB, {}, ids.firmB),
      404,
      'NOT_FOUND',
    );
    const audit = await asOwner(ids.firmA, (tx) =>
      tx.auditLog.findMany({
        where: { entityId: r.id, action: 'bookkeeping.report.generated' },
        select: { metadata: true },
      }),
    );
    expect(audit).toHaveLength(2);
    expect(JSON.stringify(audit)).not.toMatch(/Fake Fees|120000/);
  });
});

describe('report figures from statements, status and documents (BK-RPT part 2)', () => {
  it('works out the statement reports, waits for missing statements, and never completes a report past an open reconciliation', async () => {
    const bk = await bkOf(clients.assigned);
    await ledgerPnl(bk);
    const ws = exact(
      BookkeepingClientWorkspace,
      await call('get', `/clients/${bk}`, people.ownerA),
    );
    const A = { businessId: ids.firmA, engagementId: ws.engagementId };
    const tag = randomUUID().slice(0, 6);
    const p = await mkPeriod(bk);
    const at = (on: string) => new Date(`${on}T00:00:00.000Z`);
    const checking = await mkAccount(bk, { name: `Fake p2 checking ${tag}` });
    const card = await mkAccount(bk, { name: `Fake p2 card ${tag}`, type: 'CREDIT_CARD' });
    const category = (name: string, type: 'INCOME' | 'EXPENSE') =>
      asOwner(ids.firmA, (tx) =>
        tx.bookkeepingCategory.create({
          data: { ...A, name: `${name} ${tag}`, type },
          select: { id: true },
        }),
      ).then((c) => c.id);
    const fees = await category('Fake p2 Fees', 'INCOME');
    const rent = await category('Fake p2 Rent', 'EXPENSE');
    const mk = (
      accountId: string,
      cents: number,
      direction: 'DEBIT' | 'CREDIT',
      categoryId: string,
    ) =>
      asOwner(ids.firmA, (tx) =>
        tx.bookkeepingTransaction.create({
          data: {
            ...A,
            accountId,
            transactionDate: at(p.periodStart),
            description: 'Fake p2 line',
            amountCents: cents,
            direction,
            status: 'CATEGORIZED',
            source: 'MANUAL',
            categoryId,
          },
        }),
      );
    await mk(checking.id, 100_000, 'CREDIT', fees);
    await mk(checking.id, 30_000, 'DEBIT', rent);
    await mk(card.id, 700, 'DEBIT', rent);
    const preview = async (type: string) => {
      const r = await mkReport(bk, { reportType: type, periodId: p.id });
      const out = exact(
        BookkeepingReportPreview,
        await call('get', `/reports/${r.id}/preview`, people.staffA),
      );
      return { id: r.id, ...out };
    };

    // No statements yet: the Balance Sheet says which, and is not generated from a guess.
    const bs = await preview('BALANCE_SHEET');
    expect(bs.supported).toBe(true);
    expect(bs.figures!.notes.join(' ')).toContain(`Fake p2 checking ${tag}`);
    expectError(
      await call('post', `/reports/${bs.id}/generate`, people.staffA, {}),
      409,
      'STATEMENTS_MISSING',
    );

    // The period's statements: checking still open, the card approved; the client's other
    // accounts (from other tests) approved at zero so they change nothing.
    const recon = (accountId: string, beginning: number, ending: number, approved: boolean) =>
      asOwner(ids.firmA, (tx) =>
        tx.bookkeepingReconciliation.create({
          data: {
            businessId: ids.firmA,
            periodId: p.id,
            accountId,
            statementStart: at(p.periodStart),
            statementEnd: at(p.periodEnd),
            beginningBalanceCents: beginning,
            endingBalanceCents: ending,
            clearedBalanceCents: approved ? ending : 0,
            differenceCents: approved ? 0 : ending,
            ...(approved
              ? { status: 'APPROVED', readyForReviewAt: new Date(), approvedAt: new Date() }
              : {}),
          },
          select: { id: true },
        }),
      );
    const open = await recon(checking.id, 50_000, 120_000, false);
    await recon(card.id, 0, -700, true);
    const others = await asOwner(ids.firmA, (tx) =>
      tx.bookkeepingAccount.findMany({
        where: { ...A, archivedAt: null, reconcile: true, id: { notIn: [checking.id, card.id] } },
        select: { id: true },
      }),
    );
    for (const o of others) await recon(o.id, 0, 0, true);

    const v1 = exact(
      BookkeepingReportVersionRow,
      await call('post', `/reports/${bs.id}/generate`, people.staffA, {}),
    );
    expect(v1.figures.totals).toEqual({
      assetsCents: 120_000,
      liabilitiesCents: 700,
      netAssetsCents: 119_300,
    });
    expect(v1.figures.notes).toContain(`Not reconciled and approved yet: Fake p2 checking ${tag}.`);

    // Cash Flow: the bank lines explain the statement's change exactly.
    const cf = await preview('CASH_FLOW');
    expect(cf.figures!.totals).toMatchObject({
      beginningCashCents: 50_000,
      operatingCents: 70_000,
      netChangeCents: 70_000,
      endingCashCents: 120_000,
      differenceCents: 0,
    });

    // Reconciliation, with the period's refunds and settlements broken down.
    await asOwner(ids.firmA, async (tx) => {
      await tx.bookkeepingRefund.create({
        data: {
          ...A,
          kind: 'REFUND_ISSUED',
          refundDate: at(p.periodStart),
          amountCents: 2_000,
          status: 'COMPLETED',
        },
      });
      await tx.bookkeepingSettlement.create({
        data: {
          ...A,
          processor: 'stripe',
          periodStart: at(p.periodStart),
          periodEnd: at(p.periodEnd),
          payoutDate: at(p.periodEnd),
          grossCents: 10_000,
          feesCents: 300,
          netPayoutCents: 9_700,
          netSource: 'CALCULATED',
        },
      });
    });
    const rc = await preview('RECONCILIATION');
    const mine = rc.figures!.sections.find(
      (s) => s.title === `Fake p2 checking ${tag} (in progress)`,
    );
    expect(mine!.rows.find((r) => r.label === 'Difference')).toEqual({
      label: 'Difference',
      amountCents: 120_000,
    });
    expect(rc.figures!.sections.find((s) => s.title === 'Refunds and Chargebacks')!.rows).toEqual([
      { label: 'Refund issued (completed)', amountCents: 2_000, count: 1 },
    ]);
    expect(rc.figures!.sections.find((s) => s.title === 'Settlements')!.totalCents).toBe(9_700);
    expect(rc.figures!.totals).toMatchObject({ openCount: 1, refundsCents: 2_000 });

    // Missing Documents, Status and the General Ledger.
    const md = await preview('MISSING_DOCUMENTS');
    expect(md.figures!.totals).toMatchObject({
      receiptsMissing: 2,
      amountWithoutReceiptCents: 30_700,
    });
    expect(md.figures!.sections[1]!.rows.map((r) => r.label)).toEqual(
      expect.arrayContaining([`Fake p2 checking ${tag}`, `Fake p2 card ${tag}`]),
    );
    const st = await preview('BOOKKEEPING_STATUS');
    expect(st.figures!.totals).toMatchObject({
      uncategorized: 0,
      withoutReceipt: 2,
      reconciliationsOpen: 1,
      reconciliationsNotStarted: 0,
    });
    const gl = await preview('GENERAL_LEDGER');
    expect(gl.figures!.totals['debitsCents']).toBe(gl.figures!.totals['creditsCents']);
    expect(gl.figures!.totals['debitsCents']).toBe(130_700);

    // Approving or completing the period's report never skips its reconciliation, or its close.
    const report = await mkReport(bk, { reportType: 'PROFIT_LOSS', periodId: p.id });
    await call('post', `/reports/${report.id}/start`, people.staffA, {});
    await call('post', `/reports/${report.id}/submit-review`, people.staffA, {});
    expectError(
      await call('post', `/reports/${report.id}/approve`, people.ownerA, {}),
      409,
      'RECON_OPEN',
    );
    await asOwner(ids.firmA, (tx) =>
      tx.bookkeepingReconciliation.update({
        where: { businessId_id: { businessId: ids.firmA, id: open.id } },
        data: {
          clearedBalanceCents: 120_000,
          differenceCents: 0,
          status: 'APPROVED',
          readyForReviewAt: new Date(),
          approvedAt: new Date(),
        },
      }),
    );
    exact(
      BookkeepingReportRow,
      await call('post', `/reports/${report.id}/approve`, people.ownerA, {}),
    );
    // Its figures are generated before it goes to the client.
    exact(
      BookkeepingReportVersionRow,
      await call('post', `/reports/${report.id}/generate`, people.staffA, {}),
    );
    const published = await mkPublishedReport(ws.engagementId);
    expectError(
      await call('post', `/reports/${report.id}/deliver`, people.ownerA, {
        engagementReportId: published,
      }),
      409,
      'PERIOD_STATE',
    );
    await call('post', `/periods/${p.id}/start`, people.staffA, {});
    await call('post', `/periods/${p.id}/ready`, people.staffA, {});
    exact(BookkeepingPeriod, await call('post', `/periods/${p.id}/approve`, people.ownerA, {}));
    expect(
      exact(
        BookkeepingReportRow,
        await call('post', `/reports/${report.id}/deliver`, people.ownerA, {
          engagementReportId: published,
        }),
      ).status,
    ).toBe('DELIVERED');
    // Delivering sent the latest version: the database stamps when, and it stays sent.
    const sent = exact(
      BookkeepingReportVersionList,
      await call('get', `/reports/${report.id}/versions`, people.staffA),
    ).items[0]!;
    expect(sent).toMatchObject({ version: 1, deliveryStatus: 'SENT' });
    expect(sent.sentAt).not.toBeNull();
    await expect(
      asOwner(ids.firmA, (tx) =>
        tx.bookkeepingReportVersion.updateMany({
          where: { businessId: ids.firmA, reportId: report.id },
          data: { deliveryStatus: 'NOT_SENT' },
        }),
      ),
    ).rejects.toThrow(/stays sent/);

    // Another firm reaches none of it.
    expectError(
      await call('get', `/reports/${bs.id}/preview`, people.ownerB, undefined, ids.firmB),
      404,
      'NOT_FOUND',
    );

    // Review 2 (RP01): the Refund and Settlement Reports, from the same records.
    await asOwner(ids.firmA, (tx) =>
      tx.bookkeepingRefund.create({
        data: {
          ...A,
          kind: 'CHARGEBACK',
          disputeStatus: 'OPEN',
          refundDate: at(p.periodEnd),
          amountCents: 1_500,
          reason: 'Fake dispute',
        },
      }),
    );
    const rf = await preview('REFUND');
    expect(rf.figures!.sections.map((s) => s.title)).toEqual([
      'Refunds Issued to Customers',
      'Refunds Received from Vendors',
      'Chargebacks',
      'By Reason',
    ]);
    expect(rf.figures!.sections[0]!.rows).toEqual([
      { label: 'Completed', amountCents: 2_000, count: 1 },
    ]);
    expect(rf.figures!.sections[3]!.rows).toEqual([
      { label: 'Fake dispute', amountCents: 1_500, count: 1 },
      { label: 'No reason given', amountCents: 2_000, count: 1 },
    ]);
    expect(rf.figures!.totals).toEqual({
      refundsIssuedCents: 2_000,
      refundsReceivedCents: 0,
      chargebacksCents: 1_500,
      pendingCount: 1,
    });
    const sm = await preview('SETTLEMENT');
    expect(sm.figures!.sections[0]!.rows).toEqual([
      { label: `Stripe ${p.periodEnd} (unmatched)`, amountCents: 9_700 },
    ]);
    expect(sm.figures!.totals).toEqual({
      grossCents: 10_000,
      feesCents: 300,
      netPayoutCents: 9_700,
      unmatchedCount: 1,
    });
    const smV = exact(
      BookkeepingReportVersionRow,
      await call('post', `/reports/${sm.id}/generate`, people.staffA, {}),
    );
    expect(smV.figures).toMatchObject({ type: 'SETTLEMENT', lineCount: 1, source: 'LEDGER' });
  });
});

describe('Quarterly Review and Year to Date Summary from the ledger (BK-RPT, Nov 10)', () => {
  it('works out the days from the label or period, nets each month, generates versions, and firm B reaches none of it', async () => {
    const bk = await bkOf(clients.assigned);
    await ledgerPnl(bk);
    const ws = exact(
      BookkeepingClientWorkspace,
      await call('get', `/clients/${bk}`, people.ownerA),
    );
    const A = { businessId: ids.firmA, engagementId: ws.engagementId };
    const tag = randomUUID().slice(0, 6);
    const acct = await mkAccount(bk, { name: `Fake summary checking ${tag}` });
    const category = (name: string, type: 'INCOME' | 'EXPENSE') =>
      asOwner(ids.firmA, (tx) =>
        tx.bookkeepingCategory.create({
          data: { ...A, name: `${name} ${tag}`, type },
          select: { id: true },
        }),
      ).then((c) => c.id);
    const fees = await category('Fake Summary Fees', 'INCOME');
    const rent = await category('Fake Summary Rent', 'EXPENSE');
    const mk = (
      on: string,
      cents: number,
      direction: 'DEBIT' | 'CREDIT',
      categoryId: string | null,
    ) =>
      asOwner(ids.firmA, (tx) =>
        tx.bookkeepingTransaction.create({
          data: {
            ...A,
            accountId: acct.id,
            transactionDate: new Date(`${on}T00:00:00.000Z`),
            description: 'Fake summary line',
            amountCents: cents,
            direction,
            status: categoryId ? 'CATEGORIZED' : 'UNCATEGORIZED',
            source: 'MANUAL',
            categoryId,
          },
        }),
      );
    // 2037: a year no other bookkeeping test writes lines in.
    await mk('2036-12-31', 4_444, 'CREDIT', fees); // the year before: in neither
    await mk('2037-02-10', 50_000, 'CREDIT', fees); // the year, not the quarter
    await mk('2037-07-01', 200_000, 'CREDIT', fees); // the first day of the quarter
    await mk('2037-08-14', 60_000, 'DEBIT', rent);
    await mk('2037-09-30', 2_500, 'DEBIT', null); // the last day of the quarter, uncategorized
    await mk('2037-10-01', 9_000, 'DEBIT', rent); // the day after the quarter

    const qr = await mkReport(bk, { reportType: 'QUARTERLY_REVIEW', periodLabel: 'Q3 2037' });
    const preview = exact(
      BookkeepingReportPreview,
      await call('get', `/reports/${qr.id}/preview`, people.staffA),
    );
    expect(preview).toMatchObject({
      supported: true,
      period: { start: '2037-07-01', end: '2037-09-30' },
      missingStatements: [],
    });
    const f = preview.figures!;
    expect(f.totals).toEqual({
      incomeCents: 200_000,
      costOfGoodsCents: 0,
      expensesCents: 60_000,
      netIncomeCents: 140_000,
      months: 3,
      uncategorized: 1,
    });
    expect(f.sections.map((s) => s.title)).toEqual([
      'Profit & Loss',
      'Net Income by Month',
      'Ledger',
    ]);
    expect(f.sections[1]!.rows).toEqual([
      { label: 'Jul 2037', amountCents: 200_000, count: 1 },
      { label: 'Aug 2037', amountCents: -60_000, count: 1 },
      { label: 'Sep 2037', amountCents: 0, count: 1 },
    ]);
    expect(f.notes).toEqual([]);
    const v1 = exact(
      BookkeepingReportVersionRow,
      await call('post', `/reports/${qr.id}/generate`, people.staffA, {}),
    );
    expect(v1).toMatchObject({ version: 1, period: { start: '2037-07-01', end: '2037-09-30' } });
    expect(v1.figures.totals['netIncomeCents']).toBe(140_000);
    const file = await call('get', `/reports/${qr.id}/versions/1/csv`, people.ownerA);
    expect(file.status).toBe(200);
    expect(file.text).toContain('Jul 2037');

    // The year to date by its label: a past year, so the whole of it.
    const ytd = await mkReport(bk, { reportType: 'YEAR_TO_DATE_SUMMARY', periodLabel: 'FY 2037' });
    const y = exact(
      BookkeepingReportPreview,
      await call('get', `/reports/${ytd.id}/preview`, people.staffA),
    );
    expect(y.period).toEqual({ start: '2037-01-01', end: '2037-12-31' });
    expect(y.figures!.totals).toMatchObject({
      incomeCents: 250_000,
      expensesCents: 69_000,
      netIncomeCents: 181_000,
      months: 12,
    });
    expect(y.figures!.sections[1]!.rows[1]).toEqual({
      label: 'Feb 2037',
      amountCents: 50_000,
      count: 1,
    });

    // By its period: 1 January to the end of the period.
    const p = await mkPeriod(bk);
    const byPeriod = await mkReport(bk, { reportType: 'YEAR_TO_DATE_SUMMARY', periodId: p.id });
    expect(
      exact(
        BookkeepingReportPreview,
        await call('get', `/reports/${byPeriod.id}/preview`, people.staffA),
      ).period,
    ).toEqual({ start: `${p.periodEnd.slice(0, 4)}-01-01`, end: p.periodEnd });

    // A label that says no days, with no period, says so.
    const vague = await mkReport(bk, {
      reportType: 'QUARTERLY_REVIEW',
      periodLabel: 'Fake quarter',
    });
    expectError(
      await call('post', `/reports/${vague.id}/generate`, people.staffA, {}),
      409,
      'NO_PERIOD',
    );
    expect(
      exact(
        BookkeepingReportPreview,
        await call('get', `/reports/${vague.id}/preview`, people.staffA),
      ),
    ).toMatchObject({ supported: false, figures: null });

    // Another firm reaches none of it, and makes no version.
    for (const [method, path] of [
      ['get', `/reports/${qr.id}/preview`],
      ['post', `/reports/${ytd.id}/generate`],
      ['get', `/reports/${qr.id}/versions`],
    ] as const) {
      expectError(
        await call(method, path, people.ownerB, method === 'post' ? {} : undefined, ids.firmB),
        404,
        'NOT_FOUND',
      );
    }
    expect(
      exact(
        BookkeepingReportVersionList,
        await call('get', `/reports/${ytd.id}/versions`, people.staffA),
      ).items,
    ).toEqual([]);
  });
});

describe('P&L source (Review 2, RP03)', () => {
  it('waits for staff to choose, then uses only the chosen source: the entered figures or the ledger, never both', async () => {
    const bk = await bkFor(clients.pnl);
    const ws = exact(
      BookkeepingClientWorkspace,
      await call('get', `/clients/${bk}`, people.ownerA),
    );
    expect(ws.pnlSource).toBeNull();
    const A = { businessId: ids.firmA, engagementId: ws.engagementId };
    const p = await mkPeriod(bk);
    // The ledger has 400.00 of income in the period.
    const account = await mkAccount(bk, { name: 'Fake pnl checking' });
    const sales = await asOwner(ids.firmA, (tx) =>
      tx.bookkeepingCategory.create({
        data: { ...A, name: `Fake pnl Sales ${run}`, type: 'INCOME' },
        select: { id: true },
      }),
    );
    await asOwner(ids.firmA, (tx) =>
      tx.bookkeepingTransaction.create({
        data: {
          ...A,
          accountId: account.id,
          transactionDate: new Date(`${p.periodStart}T00:00:00.000Z`),
          description: 'Fake pnl sale',
          amountCents: 40_000,
          direction: 'CREDIT',
          status: 'CATEGORIZED',
          source: 'MANUAL',
          categoryId: sales.id,
        },
      }),
    );
    const r = await mkReport(bk, { reportType: 'PROFIT_LOSS', periodId: p.id });
    const ytd = await mkReport(bk, { reportType: 'YEAR_TO_DATE_SUMMARY', periodId: p.id });
    const preview = async (id = r.id) =>
      exact(BookkeepingReportPreview, await call('get', `/reports/${id}/preview`, people.staffA));
    const set = async (pnlSource: string) =>
      exact(
        BookkeepingClientWorkspace,
        await call('patch', `/clients/${bk}`, people.staffA, { pnlSource }),
      );

    // Not chosen: no P&L or summary, and no version.
    const none = await preview();
    expect(none).toMatchObject({ supported: false, figures: null });
    expect(none.reason).toContain("Choose where this client's P&L comes from");
    expect((await preview(ytd.id)).supported).toBe(false);
    expectError(
      await call('post', `/reports/${r.id}/generate`, people.staffA, {}),
      409,
      'PNL_SOURCE_NOT_SET',
    );

    // Entered in Firmivra: waits for the period's figures, then uses only them.
    expect((await set('MANUAL')).pnlSource).toBe('MANUAL');
    expectError(
      await call('post', `/reports/${r.id}/generate`, people.staffA, {}),
      409,
      'PNL_FIGURES_MISSING',
    );
    exact(
      BookkeepingPeriod,
      await call('patch', `/periods/${p.id}`, people.staffA, {
        incomeCents: 100_000,
        expensesCents: 35_000,
      }),
    );
    expect((await preview()).figures).toMatchObject({
      source: 'MANUAL',
      totals: { incomeCents: 100_000, expensesCents: 35_000, netIncomeCents: 65_000 },
    });
    expect((await preview(ytd.id)).figures).toMatchObject({
      source: 'MANUAL',
      totals: { incomeCents: 100_000, netIncomeCents: 65_000 },
    });
    const v1 = exact(
      BookkeepingReportVersionRow,
      await call('post', `/reports/${r.id}/generate`, people.staffA, {}),
    );
    expect(v1.figures.totals['netIncomeCents']).toBe(65_000);
    const file = await call('get', `/reports/${r.id}/versions/1/csv`, people.staffA);
    expect(file.text).toContain('Income and expenses entered in Firmivra');

    // The connected software's ledger: only the ledger's lines; the entered figures are left out.
    await set('ACCOUNTING_SOFTWARE');
    expect((await preview()).figures).toMatchObject({
      source: 'LEDGER',
      totals: { incomeCents: 40_000, expensesCents: 0, netIncomeCents: 40_000 },
    });
    // The version made from the entered figures never changes.
    expect(
      exact(
        BookkeepingReportVersionList,
        await call('get', `/reports/${r.id}/versions`, people.staffA),
      ).items[0]!.figures.totals['netIncomeCents'],
    ).toBe(65_000);

    // Each choice is in the client's bookkeeping Activity; nothing else is a source; firm B can't.
    const after = exact(
      BookkeepingClientWorkspace,
      await call('get', `/clients/${bk}`, people.ownerA),
    );
    expect(after.recentActivity.map((a) => a.summary)).toEqual(
      expect.arrayContaining([
        'P&L source set to figures entered in Firmivra',
        'P&L source set to the connected accounting software',
      ]),
    );
    expectError(
      await call('patch', `/clients/${bk}`, people.staffA, { pnlSource: 'BOTH' }),
      400,
      'VALIDATION_FAILED',
    );
    expectError(
      await call('patch', `/clients/${bk}`, people.ownerB, { pnlSource: 'MANUAL' }, ids.firmB),
      404,
      'NOT_FOUND',
    );
  });
});

describe('reconciliation from the ledger (BK-R01)', () => {
  it('clears ledger lines, works out the cleared balance, difference and exceptions, and approves only at zero', async () => {
    const bk = await bkFor(clients.ledger);
    const p = await mkPeriod(bk);
    await call('post', `/periods/${p.id}/start`, people.staffA, {});
    const ws = exact(
      BookkeepingClientWorkspace,
      await call('get', `/clients/${bk}`, people.ownerA),
    );
    const bank = await mkAccount(bk, { name: 'Fake ledger checking', type: 'BANK' });
    const card = await mkAccount(bk, { name: 'Fake ledger card', type: 'CREDIT_CARD' });
    const A = { businessId: ids.firmA, engagementId: ws.engagementId };
    const at = (offset: number) =>
      new Date(Date.parse(`${p.periodStart}T00:00:00.000Z`) + offset * 86_400_000);
    const line = (
      accountId: string,
      offset: number,
      cents: number,
      direction: 'DEBIT' | 'CREDIT',
      extra: object = {},
    ) =>
      asOwner(ids.firmA, (tx) =>
        tx.bookkeepingTransaction.create({
          data: {
            ...A,
            accountId,
            transactionDate: at(offset),
            description: `Fake line ${offset}`,
            amountCents: cents,
            direction,
            source: 'MANUAL',
            ...extra,
          },
          select: { id: true },
        }),
      );
    const deposit = await line(bank.id, 0, 50_000, 'CREDIT');
    const rent = await line(bank.id, 4, 20_000, 'DEBIT');
    const unsure = await line(bank.id, 9, 5_000, 'DEBIT', {
      status: 'NEEDS_REVIEW',
      duplicateOfId: rent.id,
    });
    const excluded = await line(bank.id, 11, 1_000, 'DEBIT', {
      status: 'EXCLUDED',
      excludedReason: 'Fake personal charge',
    });
    const later = await line(bank.id, 60, 3_000, 'DEBIT');
    const onCard = await line(card.id, 2, 700, 'DEBIT');

    const recons = `/periods/${p.id}/reconciliations`;
    // Review 2 (R01c): approval needs the account's statement for the period.
    const start = {
      accountId: bank.id,
      statementStart: p.periodStart,
      statementEnd: p.periodEnd,
      beginningBalanceCents: 100_000,
      endingBalanceCents: 125_000,
      statementDocumentId: await mkDocument(clients.ledger, ws.engagementId),
    };
    // Typed cleared figures are refused once the account has ledger lines.
    expectError(
      await call('post', recons, people.staffA, { ...start, clearedBalanceCents: 125_000 }),
      400,
      'VALIDATION_FAILED',
    );
    const r = exact(
      BookkeepingReconciliation,
      await call('post', recons, people.staffA, start),
      201,
    );
    expect(r).toMatchObject({
      clearedCount: 0,
      clearedBalanceCents: 100_000,
      differenceCents: 25_000,
      exceptionsCount: 1,
    });
    const items = `/reconciliations/${r.id}/items`;
    const listed = exact(BookkeepingReconciliationItems, await call('get', items, people.staffA));
    // Oldest first; the excluded line and the line after the statement end are not offered.
    expect(listed.items.map((i) => i.id)).toEqual([deposit.id, rent.id, unsure.id]);
    expect(listed.items.map((i) => i.effectCents)).toEqual([50_000, -20_000, -5_000]);
    // A probable duplicate is an exception; a line still to categorize is not.
    expect(listed.items.map((i) => i.exception)).toEqual([null, null, 'DUPLICATE']);
    expect(listed).toMatchObject({ fromLedger: true, truncated: false, differenceCents: 25_000 });

    const clear = (transactionIds: string[], cleared = true, who: Who = people.staffA) =>
      call('post', items, who, { transactionIds, cleared });
    expect(exact(BookkeepingReconciliation, await clear([deposit.id, rent.id]))).toMatchObject({
      clearedCount: 2,
      clearedBalanceCents: 130_000,
      differenceCents: -5_000,
    });
    expectError(await clear([excluded.id]), 409, 'RECON_STATE');
    expectError(await clear([later.id]), 409, 'RECON_STATE');
    expectError(await clear([onCard.id]), 409, 'NOT_THIS_CLIENTS');
    expectError(await clear([randomUUID()]), 409, 'NOT_THIS_CLIENTS');
    expectError(await clear([rent.id, rent.id]), 400, 'VALIDATION_FAILED');
    expectError(await clear([deposit.id], true, people.staff2A), 404, 'NOT_FOUND');
    expectError(
      await call('patch', `/reconciliations/${r.id}`, people.staffA, { clearedCount: 9 }),
      400,
      'VALIDATION_FAILED',
    );

    // A difference blocks approval, and a reconciliation in review cannot change.
    await call('post', `/reconciliations/${r.id}/ready`, people.staffA, {});
    expectError(
      await call('post', `/reconciliations/${r.id}/approve`, people.ownerA, {}),
      409,
      'RECON_DIFFERENCE',
    );
    expectError(await clear([unsure.id]), 409, 'RECON_STATE');
    await call('post', `/reconciliations/${r.id}/reopen`, people.ownerA, {
      reason: 'Fake: the rent cheque is outstanding',
    });

    expect(exact(BookkeepingReconciliation, await clear([unsure.id]))).toMatchObject({
      clearedCount: 3,
      differenceCents: 0,
    });
    // Cleared lines cannot fall after a new statement end.
    expectError(
      await call('patch', `/reconciliations/${r.id}`, people.staffA, {
        statementEnd: at(5).toISOString().slice(0, 10),
      }),
      409,
      'RECON_STATE',
    );
    // An open exception blocks approval at zero; once resolved, the zero difference approves.
    await call('post', `/reconciliations/${r.id}/ready`, people.staffA, {});
    expectError(
      await call('post', `/reconciliations/${r.id}/approve`, people.ownerA, {}),
      409,
      'RECON_STATE',
    );
    await asOwner(ids.firmA, (tx) =>
      tx.bookkeepingTransaction.update({
        where: { id: unsure.id },
        data: { duplicateOfId: null },
      }),
    );
    expect(
      exact(
        BookkeepingReconciliation,
        await call('post', `/reconciliations/${r.id}/approve`, people.ownerA, {}),
      ),
    ).toMatchObject({ status: 'APPROVED', differenceCents: 0, exceptionsCount: 0 });

    // Unclearing works the figures back out (after a reopen).
    await call('post', `/reconciliations/${r.id}/reopen`, people.ownerA, {
      reason: 'Fake: recheck the deposit',
    });
    expect(exact(BookkeepingReconciliation, await clear([deposit.id], false))).toMatchObject({
      clearedCount: 2,
      clearedBalanceCents: 75_000,
      differenceCents: 50_000,
    });

    // Firm B cannot see or change firm A's reconciliation.
    expectError(await call('get', items, people.ownerB, undefined, ids.firmB), 404, 'NOT_FOUND');
    expectError(
      await call(
        'post',
        items,
        people.ownerB,
        { transactionIds: [deposit.id], cleared: true },
        ids.firmB,
      ),
      404,
      'NOT_FOUND',
    );
    expect(await auditActions(r.id)).toEqual(
      expect.arrayContaining([
        'bookkeeping.reconciliation.items_listed',
        'bookkeeping.reconciliation.items_cleared',
        'bookkeeping.reconciliation.items_uncleared',
      ]),
    );
  });
  it("clears an outstanding line from a closed month in the next month's reconciliation (Rasel, Oct 27)", async () => {
    const bk = await bkFor(clients.ledger);
    const ws = exact(
      BookkeepingClientWorkspace,
      await call('get', `/clients/${bk}`, people.ownerA),
    );
    const A = { businessId: ids.firmA, engagementId: ws.engagementId };
    const bank = await mkAccount(bk, { name: 'Fake outstanding checking', type: 'BANK' });
    const first = await mkPeriod(bk);
    const next = await mkPeriod(bk);
    const cheque = await asOwner(ids.firmA, (tx) =>
      tx.bookkeepingTransaction.create({
        data: {
          ...A,
          accountId: bank.id,
          transactionDate: new Date(`${first.periodEnd}T00:00:00.000Z`),
          description: 'Fake outstanding cheque',
          amountCents: 8_000,
          direction: 'DEBIT',
          source: 'MANUAL',
        },
        select: { id: true },
      }),
    );
    // The first month closes with the cheque outstanding.
    await asOwner(ids.firmA, async (tx) => {
      const stamp = new Date();
      await tx.bookkeepingCloseItem.updateMany({
        where: { periodId: first.id },
        data: { completedAt: stamp, completedByUserId: people.ownerA.id },
      });
      const set = (data: object) => tx.bookkeepingPeriod.update({ where: { id: first.id }, data });
      await set({ status: 'IN_PROGRESS' });
      await set({ status: 'READY_FOR_REVIEW', readyForReviewAt: stamp });
      await set({ status: 'APPROVED', approvedAt: stamp });
      await set({ status: 'CLOSED', closedAt: stamp });
    });
    await call('post', `/periods/${next.id}/start`, people.staffA, {});
    const r = exact(
      BookkeepingReconciliation,
      await call('post', `/periods/${next.id}/reconciliations`, people.staffA, {
        accountId: bank.id,
        statementStart: next.periodStart,
        statementEnd: next.periodEnd,
        beginningBalanceCents: 50_000,
        endingBalanceCents: 42_000,
      }),
      201,
    );
    const listed = exact(
      BookkeepingReconciliationItems,
      await call('get', `/reconciliations/${r.id}/items`, people.staffA),
    );
    expect(listed.items.map((i) => i.id)).toEqual([cheque.id]);
    expect(
      exact(
        BookkeepingReconciliation,
        await call('post', `/reconciliations/${r.id}/items`, people.staffA, {
          transactionIds: [cheque.id],
          cleared: true,
        }),
      ),
    ).toMatchObject({ clearedCount: 1, clearedBalanceCents: 42_000, differenceCents: 0 });
    // Nothing else on the closed month's line changes.
    await expect(
      asOwner(ids.firmA, (tx) =>
        tx.bookkeepingTransaction.update({ where: { id: cheque.id }, data: { amountCents: 1 } }),
      ),
    ).rejects.toThrow(/closed and locked/);
  });
});

describe('the plan from Services & Pricing (SH9)', () => {
  it('adding a client with a catalog service saves its id and name; another firm’s is 404', async () => {
    const [clientId, service] = await asOwner(
      ids.firmA,
      async (tx) =>
        [
          (
            await tx.client.create({
              data: { businessId: ids.firmA, displayName: `Fake SH9 ${run}` },
            })
          ).id,
          await tx.service.findUniqueOrThrow({
            where: { id: ids.serviceA },
            select: { id: true, name: true },
          }),
        ] as const,
    );
    const ws = await addClient(clientId, { catalogServiceId: service.id });
    expect(ws).toMatchObject({ plan: service.name, catalogServiceId: service.id });
    const other = await asOwner(ids.firmA, (tx) =>
      tx.client.create({ data: { businessId: ids.firmA, displayName: `Fake SH9 other ${run}` } }),
    );
    expectError(
      await call('post', '/clients', people.ownerA, {
        clientId: other.id,
        catalogServiceId: randomUUID(),
      }),
      404,
      'NOT_FOUND',
    );
    const serviceB = await asOwner(ids.firmB, (tx) =>
      tx.service.create({
        data: {
          businessId: ids.firmB,
          kind: 'BOOKKEEPING',
          name: `Fake B bookkeeping ${run}`,
          status: 'ACTIVE',
        },
      }),
    );
    expectError(
      await call('post', '/clients', people.ownerA, {
        clientId: other.id,
        catalogServiceId: serviceB.id,
      }),
      404,
      'NOT_FOUND',
    );
  });
});

describe("firm B never reaches firm A's books", () => {
  it('answers 404 for every record of firm A, read or change', async () => {
    const bk = await bkOf(clients.assigned);
    const periods = exact(
      BookkeepingPeriodList,
      await call('get', `/clients/${await bkFor(clients.close)}/periods?pageSize=1`, people.ownerA),
    );
    const report = exact(
      BookkeepingReportPage,
      await call('get', '/reports?pageSize=1', people.ownerA),
    ).items[0]!;
    const conn = (
      await asOwner(ids.firmA, (tx) =>
        tx.bookkeepingConnection.findFirstOrThrow({ where: { businessId: ids.firmA } }),
      )
    ).id;
    const account = (
      await asOwner(ids.firmA, (tx) =>
        tx.bookkeepingAccount.findFirstOrThrow({ where: { businessId: ids.firmA } }),
      )
    ).id;
    const recon = (
      await asOwner(ids.firmA, (tx) =>
        tx.bookkeepingReconciliation.findFirstOrThrow({ where: { businessId: ids.firmA } }),
      )
    ).id;
    const asB = (method: 'get' | 'post' | 'patch', path: string, body?: object) =>
      call(method, path, people.ownerB, body, ids.firmB);
    const attempts: Response[] = [
      await asB('get', `/clients/${bk}`),
      await asB('patch', `/clients/${bk}`, { alerts: { staleSync: false } }),
      await asB('post', `/clients/${bk}/status`, { status: 'OVERDUE' }),
      await asB('post', `/clients/${bk}/pause`, { reason: 'x' }),
      await asB('post', `/clients/${bk}/sync`, {}),
      await asB('get', `/clients/${bk}/activities`),
      await asB('get', `/clients/${bk}/connections`),
      await asB('get', `/clients/${bk}/accounts`),
      await asB('get', `/clients/${bk}/periods`),
      await asB('get', `/clients/${bk}/reports`),
      await asB('get', `/periods/${periods.items[0]!.id}`),
      await asB('post', `/periods/${periods.items[0]!.id}/start`, {}),
      await asB('get', `/periods/${periods.items[0]!.id}/reconciliations`),
      await asB('get', `/reports/${report.id}`),
      await asB('post', `/reports/${report.id}/start`, {}),
      await asB('patch', `/connections/${conn}`, { companyName: 'x' }),
      await asB('get', `/connections/${conn}/syncs`),
      await asB('patch', `/accounts/${account}`, { name: 'x' }),
      await asB('get', `/reconciliations/${recon}`),
      await asB('post', `/reconciliations/${recon}/ready`, {}),
    ];
    for (const res of attempts) expectError(res, 404, 'NOT_FOUND');
    // And B's own lists hold nothing of A's.
    const mine = exact(BookkeepingClientPage, await asB('get', '/clients'));
    expect(mine.items).toEqual([]);
  });
});

describe('every action is audited without client data in the log', () => {
  it('writes entity ids and counts, never names, balances or figures', async () => {
    const rows = await asOwner(ids.firmA, (tx) =>
      tx.auditLog.findMany({
        where: { businessId: ids.firmA, action: { startsWith: 'bookkeeping.' } },
      }),
    );
    expect(rows.length).toBeGreaterThan(40);
    const text = JSON.stringify(rows.map((r) => r.metadata));
    for (const secret of [
      'Fake Green Leaf',
      'Fake Conn Co',
      '2458000',
      'Check the owner draws',
      'Late invoice found',
      'Fake recon checking',
    ]) {
      expect(text).not.toContain(secret);
    }
    const actions = new Set(rows.map((r) => r.action));
    for (const a of [
      'bookkeeping.clients.listed',
      'bookkeeping.overview.viewed',
      'bookkeeping.settings.saved',
      'bookkeeping.clients.exported',
      'bookkeeping.reports.exported',
    ]) {
      expect(actions.has(a), a).toBe(true);
    }
  });
});
