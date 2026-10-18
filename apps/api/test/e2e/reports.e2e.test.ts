// End-to-end: R55, Reports (contract in packages/types/src/reports): the dashboard and quick
// reports, the one run path (saved reports, the builder's definitions, overrides), validation
// against the data sources, saved reports with visibility and an etag, CSV exports as runs with a
// download link, scheduled reports, settings and lookups. Cards, charts and tables come from one
// dataset and reconcile. Staff see only their clients and no money or team data; firm B sees none
// of firm A's. Nothing in a log or audit row holds report data.
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request, { type Response } from 'supertest';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createPrismaClient, runInScope } from '@firmivra/db';
import { TEST_CLIENT_OPTIONS, testDatabaseUrls } from '@firmivra/db/testing';
import {
  DownloadLink,
  OkResponse,
  RecentReportPage,
  ReportCatalog,
  ReportDataSourceList,
  ReportLookupList,
  ReportResult,
  ReportRunStatusView,
  ReportScheduleDetail,
  ReportSchedulePage,
  ReportSettingsView,
  ReportsDashboard,
  SavedReportDetail,
  SavedReportPage,
} from '@firmivra/types';
import { AppModule } from '../../src/app.module.js';
import { configureApp } from '../../src/configure-app.js';
import { loadEnv } from '../../src/config/env.js';
import { REPORT_FILES, type ReportFiles } from '../../src/reports/report-files.js';

class MemoryFiles implements ReportFiles {
  readonly objects = new Map<string, Buffer>();
  put(key: string, bytes: Uint8Array) {
    this.objects.set(key, Buffer.from(bytes));
    return Promise.resolve();
  }
  presignDownload(input: { key: string; fileName: string }) {
    return Promise.resolve(`memory:${input.key}?name=${encodeURIComponent(input.fileName)}`);
  }
  remove(key: string) {
    this.objects.delete(key);
    return Promise.resolve();
  }
}
const files = new MemoryFiles();

const fx = inject('fixtures');
const run = randomUUID().slice(0, 8);
const person = (key: string) => ({ id: randomUUID(), email: `r55r-${key}-${run}@r55.test` });
const people = {
  ownerA: person('owner-a'),
  adminA: person('admin-a'),
  staffA: person('staff-a'),
  ownerB: person('owner-b'),
};
type Who = (typeof people)[keyof typeof people];
const firms = {} as Record<'a' | 'b', string>;
const clients = {} as Record<'c1' | 'c2' | 'c3' | 'cB', string>;
let serviceId = '';

let app: INestApplication;
const tokens = new Map<string, string>();
let viewers = 0;
const viewer = () => `198.56.${100 + Math.floor(++viewers / 250)}.${viewers % 250}, 10.0.0.5`;

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
    [method](`/api/v1/business${path}`)
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

const runReport = (body: object, who: Who = people.ownerA, firm: 'a' | 'b' = 'a') =>
  call('post', '/reports/run', who, body, firm);
const result = async (body: object, who: Who = people.ownerA) =>
  ReportResult.parse(ok(await runReport(body, who)));
const quick = (key: string, extra: object = {}, who: Who = people.ownerA) =>
  result({ target: { kind: 'SYSTEM', key }, ...extra }, who);
const def = (over: object = {}) => ({
  category: 'CLIENT',
  dataSource: 'clients',
  columns: ['name', 'status', 'assignedTo', 'createdOn'],
  date: { rule: 'ROLLING', preset: 'this_year' },
  ...over,
});
const saveReport = (over: object = {}, who: Who = people.ownerA) =>
  call('post', '/reports/saved', who, { name: mark('Report'), definition: def(), ...over }).then(
    (r) => SavedReportDetail.parse(ok(r, 201)),
  );

const auditActions = (entityId: string) =>
  inFirm('a', (tx) =>
    tx.auditLog.findMany({
      where: { entityId },
      select: { action: true, metadata: true },
      orderBy: { createdAt: 'asc' },
    }),
  );

const DAY = 86_400_000;
const ago = (days: number) => new Date(Date.now() - days * DAY);

beforeAll(async () => {
  await asOwner({ kind: 'platform' }, async (tx) => {
    for (const [key, p] of Object.entries(people)) {
      await tx.user.create({
        data: {
          id: p.id,
          cognitoSub: p.id,
          pool: 'STAFF',
          email: p.email,
          name: `Fake R55r ${key}`,
        },
      });
    }
    for (const key of ['a', 'b'] as const) {
      const slug = `r55r-${key}-${run}`;
      firms[key] = (
        await tx.business.create({
          data: { slug, name: `Firm ${slug}`, status: 'ACTIVE' },
          select: { id: true },
        })
      ).id;
    }
    // Firm A takes card payments: a payment runs only on the firm's own connected account.
    await tx.stripeAccount.create({
      data: {
        businessId: firms.a,
        accountId: `acct_${run}`,
        chargesEnabled: true,
        payoutsEnabled: true,
        detailsSubmitted: true,
        onboardingStatus: 'COMPLETE',
      },
    });
  });
  for (const [firm, userId, role] of [
    ['a', people.ownerA.id, 'OWNER'],
    ['a', people.adminA.id, 'ADMIN'],
    ['a', people.staffA.id, 'STAFF'],
    ['b', people.ownerB.id, 'OWNER'],
  ] as const) {
    await inFirm(firm, (tx) =>
      tx.membership.create({ data: { businessId: firms[firm], userId, role, status: 'ACTIVE' } }),
    );
  }

  await inFirm('a', async (tx) => {
    const businessId = firms.a;
    await tx.businessSettings.create({ data: { businessId, timezone: 'America/New_York' } });
    const service = await tx.service.create({
      data: { businessId, kind: 'BOOKKEEPING', name: 'Bookkeeping' },
      select: { id: true },
    });
    serviceId = service.id;
    const client = async (key: 'c1' | 'c2' | 'c3', name: string, over: object) => {
      clients[key] = (
        await tx.client.create({
          data: { businessId, displayName: name, email: `${key}-${run}@client.test`, ...over },
          select: { id: true },
        })
      ).id;
    };
    await client('c1', 'Jamie Sample (fake)', {
      assignedUserId: people.staffA.id,
      status: 'ACTIVE',
    });
    await client('c2', 'Riley Example (fake)', { status: 'NEW' });
    // A name a spreadsheet would run as a formula, made long ago so it is outside "this month".
    await client('c3', '=HYPERLINK("http://evil.test") (fake)', {
      status: 'ACTIVE',
      createdAt: ago(40),
    });

    const invoice = async (
      clientId: string,
      number: string,
      cents: number,
      dueDaysFromNow: number,
    ) => {
      const inv = await tx.invoice.create({
        data: { businessId, clientId, number, dueOn: new Date(Date.now() + dueDaysFromNow * DAY) },
        select: { id: true },
      });
      await tx.invoiceLine.create({
        data: { businessId, invoiceId: inv.id, description: 'Fake', unitAmountCents: cents },
      });
      await tx.invoice.update({
        where: { id: inv.id },
        data: { status: 'OPEN', issuedAt: new Date() },
      });
      return inv.id;
    };
    const overdue = await invoice(clients.c1, `INV-A-${run}-1`, 10_000, -10);
    const open = await invoice(clients.c2, `INV-A-${run}-2`, 5_000, 20);
    void overdue;
    const payment = await tx.payment.create({
      data: {
        businessId,
        invoiceId: open,
        currency: 'usd',
        accountId: `acct_${run}`,
        amountCents: 5_000,
        processorRef: `cs_test_${randomUUID().replace(/-/g, '')}`,
      },
    });
    await tx.paymentEvent.create({
      data: {
        businessId,
        accountId: `acct_${run}`,
        type: 'checkout.session.completed',
        paymentId: payment.id,
        processorEventId: `evt_${randomUUID().replace(/-/g, '')}`,
      },
    });
    await tx.payment.update({
      where: { id: payment.id },
      data: { status: 'SUCCEEDED', paidAt: new Date() },
    });

    for (const [i, source] of (['WEBSITE_FORM', 'REFERRAL'] as const).entries()) {
      await tx.lead.create({
        data: {
          businessId,
          serviceId: service.id,
          firstName: `Lead${i}`,
          lastName: 'Fake',
          email: `lead${i}-${run}@lead.test`,
          status: 'SUBMITTED',
          submittedAt: ago(5),
          source,
          createdAt: ago(5),
          ...(i === 0 ? { assignedUserId: people.staffA.id } : {}),
        },
      });
    }
    for (const [clientId, filedOn] of [
      // filed_on is a date: the firm's day (New York here), which is not always the UTC date.
      [
        clients.c1,
        new Date(
          `${new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date())}T00:00:00Z`,
        ),
      ],
      [clients.c2, ago(20)],
    ] as const) {
      const ret = await tx.taxReturn.create({
        data: { businessId, clientId, taxYear: 2025, filingType: 'INDIVIDUAL' },
        select: { id: true },
      });
      await tx.taxReturn.update({ where: { id: ret.id }, data: { status: 'FILED', filedOn } });
    }
    for (const [clientId, title, assigned] of [
      [clients.c1, 'Call Jamie', people.ownerA.id],
      [clients.c2, 'Send engagement letter', people.adminA.id],
    ] as const) {
      await tx.task.create({
        data: {
          businessId,
          clientId,
          title,
          assignedUserId: assigned,
          dueOn: new Date(Date.now() - 3 * DAY),
        },
      });
    }
  });
  await inFirm('b', async (tx) => {
    clients.cB = (
      await tx.client.create({
        data: { businessId: firms.b, displayName: 'Firm B Client (fake)' },
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
  const moduleRef = await Test.createTestingModule({ imports: [AppModule.forRoot(env)] })
    .overrideProvider(REPORT_FILES)
    .useValue(files)
    .compile();
  const nest = moduleRef.createNestApplication<NestExpressApplication>({ logger: false });
  configureApp(nest, env);
  await nest.listen(0, '127.0.0.1');
  app = nest;
});

afterAll(async () => {
  await app.close();
});

describe('the dashboard', () => {
  it('shows the firm’s numbers, with money and team data only for those who may see them', async () => {
    const d = ReportsDashboard.parse(
      ok(await call('get', '/reports?preset=this_year', people.ownerA)),
    );
    const kpi = (key: string) => d.kpis.find((k) => k.key === key);
    expect(kpi('total_clients')?.value).toBe(3);
    expect(kpi('new_clients')?.value).toBe(3);
    expect(kpi('total_revenue')?.value).toBe(5_000);
    expect(kpi('returns_filed')?.value).toBe(2);
    expect(d.range.label).toBe('This Year');
    expect(d.categories.map((c) => c.category)).toEqual([
      'FINANCIAL',
      'CLIENT',
      'TAX',
      'LEADS',
      'TEAM_PRODUCTIVITY',
    ]);
    expect(d.categories.every((c) => c.allowed)).toBe(true);
    expect(d.insights.map((i) => i.key)).toEqual(
      expect.arrayContaining(['overdue_invoices', 'uncontacted_leads']),
    );
    expect(d.insights.find((i) => i.key === 'overdue_invoices')?.value).toBe(10_000);
    expect(d.canCreate && d.canExport).toBe(true);

    const staff = ReportsDashboard.parse(
      ok(await call('get', '/reports?preset=this_year', people.staffA)),
    );
    expect(staff.kpis.find((k) => k.key === 'total_clients')?.value).toBe(1);
    expect(staff.kpis.some((k) => k.key === 'total_revenue')).toBe(false);
    expect(staff.categories.find((c) => c.category === 'FINANCIAL')).toMatchObject({
      allowed: false,
      headline: null,
    });
    expect(staff.categories.find((c) => c.category === 'LEADS')?.allowed).toBe(true);
    expect(staff.insights.some((i) => i.key === 'overdue_invoices')).toBe(false);
    expect(staff.canCreate || staff.canExport).toBe(false);
    expect(JSON.stringify(staff)).not.toMatch(/Riley|Firm B/);
  });

  it('compares with the previous period and refuses a backwards custom range', async () => {
    const d = ReportsDashboard.parse(
      ok(await call('get', '/reports?preset=this_month&compareTo=PREVIOUS_PERIOD', people.ownerA)),
    );
    expect(d.comparisonRange).not.toBeNull();
    expect(d.comparisonRange!.to < d.range.from).toBe(true);
    const custom = ReportsDashboard.parse(
      ok(await call('get', '/reports?from=2026-01-01&to=2026-12-31', people.ownerA)),
    );
    expect(custom.range).toMatchObject({ from: '2026-01-01', to: '2026-12-31' });
    expectError(
      await call('get', '/reports?from=2026-12-31&to=2026-01-01', people.ownerA),
      400,
      'INVALID_RANGE',
    );
    expectError(
      await call('get', '/reports?from=2026-01-01', people.ownerA),
      400,
      'VALIDATION_FAILED',
    );
    expectError(
      await call('get', '/reports?preset=forever', people.ownerA),
      400,
      'VALIDATION_FAILED',
    );
    expectError(await call('get', '/reports', undefined), 401, 'UNAUTHENTICATED');
  });

  it('lists the catalog and the data sources for the caller', async () => {
    const owner = ReportCatalog.parse(ok(await call('get', '/reports/catalog', people.ownerA)));
    expect(owner.categories.map((c) => c.category)).toEqual(
      expect.arrayContaining(['FINANCIAL', 'CLIENT', 'TAX', 'LEADS', 'TEAM_PRODUCTIVITY']),
    );
    const staff = ReportCatalog.parse(ok(await call('get', '/reports/catalog', people.staffA)));
    expect(staff.categories.map((c) => c.category)).not.toContain('FINANCIAL');
    const sources = ReportDataSourceList.parse(
      ok(await call('get', '/reports/sources', people.ownerA)),
    );
    expect(sources.items.map((s) => s.key)).toEqual(
      expect.arrayContaining([
        'clients',
        'invoices_payments',
        'payments_received',
        'leads',
        'tax_returns',
        'tasks',
      ]),
    );
    const staffSources = ReportDataSourceList.parse(
      ok(await call('get', '/reports/sources', people.staffA)),
    );
    expect(staffSources.items.map((s) => s.key)).toEqual(['clients', 'leads', 'tax_returns']);
    // Sensitive fields (an email, a phone) are offered only to those who may see them.
    expect(
      sources.items.find((s) => s.key === 'clients')?.fields.some((f) => f.key === 'email'),
    ).toBe(true);
    expect(
      staffSources.items.find((s) => s.key === 'clients')?.fields.some((f) => f.key === 'email'),
    ).toBe(false);
  });
});

describe('quick reports and the run path', () => {
  it('cards, totals and the table come from one dataset and reconcile', async () => {
    const r = await quick('revenue_summary');
    expect(r.title).toBe('Revenue Summary');
    expect(r.target).toEqual({ kind: 'SYSTEM', key: 'revenue_summary' });
    expect(r.table.total).toBe(1);
    expect(r.table.rows[0]!.cells).toMatchObject({
      amount: 5_000,
      client: 'Riley Example (fake)',
      paidOn: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
    });
    expect(r.table.totals).toEqual({ amount: 5_000 });
    expect(r.kpis.find((k) => k.key === 'amount')?.value).toBe(5_000);
    expect(r.kpis.find((k) => k.key === 'count')?.value).toBe(r.table.total);
    expect(r.chart?.series[0]?.values.reduce<number>((a, b) => a + (b ?? 0), 0)).toBe(5_000);
    expect(r.chart?.money).toBe(true);
    expect(r.comparisonRange).not.toBeNull();
    expect(r.table.rows[0]!.links.map((l) => l.kind)).toEqual(
      expect.arrayContaining(['PAYMENT', 'INVOICE', 'CLIENT']),
    );
    expect(r.runId).not.toBeNull();
    expect(r.stale).toBe(false);
  });

  it('groups with counts, sums and percentages that add up', async () => {
    const r = await quick('invoices_by_status');
    expect(r.table.columns.map((c) => c.key)).toEqual([
      'status',
      'count',
      'total',
      'countPct',
      'totalPct',
    ]);
    const open = r.table.rows.find((x) => x.cells.status === 'OPEN')!;
    expect(open.cells).toMatchObject({ count: 2, total: 15_000, countPct: 100, totalPct: 100 });
    expect(r.table.totals).toMatchObject({ count: 2, total: 15_000 });
    expect(r.breakdown?.labels).toEqual(['OPEN']);
    expect(r.notices).toContain('Amounts exclude tax.');
  });

  it('days overdue and outstanding amounts', async () => {
    const r = await quick('outstanding_invoices');
    expect(r.table.total).toBe(2);
    expect(r.table.rows[0]!.cells).toMatchObject({ number: `INV-A-${run}-1` });
    const overdue = r.table.rows.find((x) => x.cells.number === `INV-A-${run}-1`)!;
    expect(overdue.cells.daysOverdue).toBeGreaterThanOrEqual(9);
    expect(r.table.totals).toEqual({ total: 15_000 });
  });

  it('Staff see only their clients’ rows; money and team data are refused', async () => {
    const mine = await quick('new_clients', {}, people.staffA);
    expect(mine.table.rows.map((x) => x.cells.name)).toEqual(['Jamie Sample (fake)']);
    expect(JSON.stringify(mine)).not.toMatch(/Riley|Firm B|HYPERLINK/);
    const leads = await quick('lead_sources', {}, people.staffA);
    expect(leads.table.totals).toMatchObject({ count: 1 });
    expectError(
      await runReport({ target: { kind: 'SYSTEM', key: 'revenue_summary' } }, people.staffA),
      403,
      'FIELD_NOT_ALLOWED',
    );
    expectError(
      await runReport({ target: { kind: 'SYSTEM', key: 'task_workload' } }, people.staffA),
      403,
      'FIELD_NOT_ALLOWED',
    );
    expectError(await runReport({ target: { kind: 'SYSTEM', key: 'nope' } }), 404, 'NOT_FOUND');
  });

  it('the detail view’s controls change this run only: range, comparison, quick filters, sort, search, tax, paging', async () => {
    const fixed = await quick('new_clients', {
      date: { rule: 'FIXED', from: '2020-01-01', to: '2020-12-31' },
    });
    expect(fixed.table.total).toBe(0);
    expect(fixed.range.label).toMatch(/2020/);
    const all = await quick('new_clients', {
      date: { rule: 'ROLLING', preset: 'this_year' },
      pageSize: 2,
      page: 2,
      sort: { field: 'name', descending: false },
    });
    expect(all.table).toMatchObject({ total: 3, page: 2, pageSize: 2 });
    expect(all.table.rows).toHaveLength(1);
    const active = await quick('new_clients', { quick: { clientType: 'ACTIVE' } });
    expect(active.table.rows.every((x) => x.cells.status === 'ACTIVE')).toBe(true);
    expect(active.chips.map((c) => c.label)).toEqual(['Status']);
    const one = await quick('new_clients', { quick: { clientId: clients.c2 } });
    expect(one.table.rows.map((x) => x.cells.name)).toEqual(['Riley Example (fake)']);
    const searched = await quick('new_clients', { search: 'jamie' });
    expect(searched.table.total).toBe(1);
    const withTax = await quick('invoices_by_status', { includeTaxRevenue: true });
    expect(withTax.notices).not.toContain('Amounts exclude tax.');
    expectError(
      await runReport({
        target: { kind: 'SYSTEM', key: 'new_clients' },
        quick: { serviceId: randomUUID() },
      }),
      404,
      'NOT_FOUND',
    );
    const ignored = await quick('new_clients', { quick: { serviceId } });
    expect(ignored.notices.join(' ')).toMatch(/service filter does not apply/);
    expectError(
      await runReport(
        {
          target: { kind: 'SYSTEM', key: 'new_clients' },
          sort: { field: 'email', descending: false },
        },
        people.staffA,
      ),
      403,
      'FIELD_NOT_ALLOWED',
    );
  });

  it('a definition from the builder is a preview or a run; filters combine with AND and OR', async () => {
    const preview = await result({
      target: { kind: 'DEFINITION', definition: def() },
      preview: true,
    });
    expect(preview).toMatchObject({
      preview: true,
      runId: null,
      title: 'Custom report',
      target: { kind: 'DEFINITION' },
    });
    expect(preview.table.rows.length).toBeLessThanOrEqual(10);
    const and = await result({
      target: {
        kind: 'DEFINITION',
        definition: def({
          filters: {
            logic: 'AND',
            conditions: [
              { field: 'status', op: 'IS', value: 'ACTIVE' },
              { field: 'name', op: 'CONTAINS', value: 'jamie' },
            ],
          },
        }),
      },
    });
    expect(and.table.rows.map((x) => x.cells.name)).toEqual(['Jamie Sample (fake)']);
    expect(and.chips.map((c) => c.label)).toEqual(['Status', 'Client Name']);
    const or = await result({
      target: {
        kind: 'DEFINITION',
        definition: def({
          filters: {
            logic: 'OR',
            conditions: [
              { field: 'name', op: 'STARTS_WITH', value: 'riley' },
              { field: 'name', op: 'STARTS_WITH', value: 'jamie' },
            ],
          },
        }),
      },
    });
    expect(or.table.total).toBe(2);
    const grouped = await result({
      target: {
        kind: 'DEFINITION',
        definition: def({
          columns: ['status'],
          groupBy: 'status',
          showTotals: true,
          showPercentage: true,
          filters: {
            groups: [
              {
                logic: 'OR',
                conditions: [{ field: 'status', op: 'IS_ANY_OF', value: ['ACTIVE', 'NEW'] }],
              },
            ],
          },
        }),
      },
    });
    expect(grouped.table.totals).toMatchObject({ count: 3 });
    const compared = await result({
      target: { kind: 'DEFINITION', definition: def({ compareTo: 'SAME_PERIOD_LAST_YEAR' }) },
    });
    expect(compared.comparisonRange).not.toBeNull();
    expect(compared.chart?.series).toHaveLength(2);
    // An unsaved report is not recorded.
    expect(compared.runId).toBeNull();
  });

  it('refuses a definition the data source does not allow, and a restricted one', async () => {
    const bad = async (over: object, who: Who = people.ownerA) =>
      runReport({ target: { kind: 'DEFINITION', definition: def(over) } }, who);
    expectError(await bad({ columns: ['nope'] }), 400, 'INVALID_DEFINITION');
    expectError(await bad({ groupBy: 'createdOn' }), 400, 'INVALID_DEFINITION');
    expectError(await bad({ sortBy: 'nope' }), 400, 'INVALID_DEFINITION');
    expectError(
      await bad({ filters: { conditions: [{ field: 'status', op: 'CONTAINS', value: 'x' }] } }),
      400,
      'INVALID_DEFINITION',
    );
    expectError(
      await bad({ filters: { conditions: [{ field: 'status', op: 'IS', value: 'MARTIAN' }] } }),
      400,
      'INVALID_DEFINITION',
    );
    expectError(
      await bad({ filters: { conditions: [{ field: 'createdOn', op: 'BETWEEN', value: 5 }] } }),
      400,
      'INVALID_DEFINITION',
    );
    expectError(await bad({ showTotals: true, columns: ['name'] }), 400, 'INVALID_DEFINITION');
    expectError(await bad({ dataSource: 'nope' }), 400, 'INVALID_DEFINITION');
    expectError(await bad({ category: 'FINANCIAL' }), 400, 'INVALID_DEFINITION');
    expectError(await bad({ columns: ['name', 'email'] }, people.staffA), 403, 'FIELD_NOT_ALLOWED');
    expectError(
      await bad(
        { filters: { conditions: [{ field: 'phone', op: 'IS_NOT_EMPTY' }] } },
        people.staffA,
      ),
      403,
      'FIELD_NOT_ALLOWED',
    );
    expectError(
      await bad(
        { category: 'FINANCIAL', dataSource: 'invoices_payments', columns: ['number'] },
        people.staffA,
      ),
      403,
      'FIELD_NOT_ALLOWED',
    );
    expect((await bad({ columns: ['name', 'email'] })).status).toBe(200);
    expectError(
      await runReport({ target: { kind: 'DEFINITION', definition: def(), businessId: firms.b } }),
      400,
      'VALIDATION_FAILED',
    );
    expectError(
      await runReport({ target: { kind: 'SAVED', id: 'nope' } }),
      400,
      'VALIDATION_FAILED',
    );
  });
});

describe('saved reports', () => {
  it('save, read, change with the version, duplicate, archive, restore and favourite', async () => {
    const name = mark('Quarterly Clients');
    const saved = await saveReport({ name, description: 'Clients by status', favorite: true });
    expect(saved).toMatchObject({
      name,
      visibility: 'PRIVATE',
      favorite: true,
      canEdit: true,
      archived: false,
      scheduleCount: 0,
    });
    expect(saved.definition).toMatchObject({
      dataSource: 'clients',
      columns: ['name', 'status', 'assignedTo', 'createdOn'],
      compareTo: 'NONE',
      chartType: 'AUTO',
    });
    expectError(
      await call('post', '/reports/saved', people.ownerA, {
        name: name.toUpperCase(),
        definition: def(),
      }),
      409,
      'DUPLICATE_NAME',
    );
    expectError(
      await call('post', '/reports/saved', people.staffA, { name: mark('X'), definition: def() }),
      403,
      'FORBIDDEN',
    );
    expectError(
      await call('post', '/reports/saved', people.ownerA, {
        name: mark('X'),
        definition: def({ columns: ['nope'] }),
      }),
      400,
      'INVALID_DEFINITION',
    );
    expectError(
      await call('post', '/reports/saved', people.ownerA, {
        name: mark('X'),
        definition: def(),
        ownerUserId: people.adminA.id,
      }),
      400,
      'VALIDATION_FAILED',
    );
    expectError(
      await call('post', '/reports/saved', people.ownerA, {
        name: mark('X'),
        definition: def(),
        sharedRoles: ['STAFF'],
      }),
      400,
      'VALIDATION_FAILED',
    );

    // Run it from the saved id: recorded in Recent Reports.
    const ran = await result({ target: { kind: 'SAVED', id: saved.id } });
    expect(ran.target).toEqual({ kind: 'SAVED', id: saved.id });
    expect(ran.runId).not.toBeNull();
    const recent = RecentReportPage.parse(ok(await call('get', '/reports/recent', people.ownerA)));
    expect(recent.items.map((r) => r.runId)).toContain(ran.runId);
    expect(recent.items.find((r) => r.runId === ran.runId)).toMatchObject({
      name,
      saved: true,
      savedReportId: saved.id,
    });
    expect(
      RecentReportPage.parse(ok(await call('get', '/reports/recent', people.adminA))).items.map(
        (r) => r.runId,
      ),
    ).not.toContain(ran.runId);

    // Change it: a stale version is a conflict.
    const changed = SavedReportDetail.parse(
      ok(
        await call('patch', `/reports/saved/${saved.id}`, people.ownerA, {
          etag: saved.etag,
          description: null,
          definition: def({ showTotals: false, groupBy: 'status', columns: ['status'] }),
        }),
      ),
    );
    expect(changed.description).toBeNull();
    expect(changed.definition.groupBy).toBe('status');
    expectError(
      await call('patch', `/reports/saved/${saved.id}`, people.ownerA, {
        etag: saved.etag,
        description: 'late',
      }),
      409,
      'SAVE_CONFLICT',
    );
    expectError(
      await call('patch', `/reports/saved/${saved.id}`, people.ownerA, { description: 'x' }),
      400,
      'VALIDATION_FAILED',
    );
    // An Admin may change the Owner's report.
    ok(
      await call('patch', `/reports/saved/${saved.id}`, people.adminA, {
        etag: changed.etag,
        name: mark('Renamed'),
      }),
    );

    const copy = SavedReportDetail.parse(
      ok(await call('post', `/reports/saved/${saved.id}/duplicate`, people.adminA, {}), 201),
    );
    expect(copy).toMatchObject({
      visibility: 'PRIVATE',
      owner: { userId: people.adminA.id },
      favorite: false,
    });
    expect(copy.name).toMatch(/\(Copy\)$/);
    expect(copy.definition.groupBy).toBe('status');

    const archived = SavedReportDetail.parse(
      ok(await call('post', `/reports/saved/${saved.id}/archive`, people.ownerA)),
    );
    expect(archived.archived).toBe(true);
    expect(
      SavedReportDetail.parse(
        ok(await call('post', `/reports/saved/${saved.id}/archive`, people.ownerA)),
      ).archived,
    ).toBe(true);
    expectError(
      await call('patch', `/reports/saved/${saved.id}`, people.ownerA, {
        etag: archived.etag,
        description: 'x',
      }),
      409,
      'REPORT_ARCHIVED',
    );
    expect(
      SavedReportDetail.parse(
        ok(await call('post', `/reports/saved/${saved.id}/restore`, people.ownerA)),
      ).archived,
    ).toBe(false);
    expect(
      SavedReportDetail.parse(
        ok(await call('delete', `/reports/saved/${saved.id}/favorite`, people.ownerA)),
      ).favorite,
    ).toBe(false);
    expect(
      SavedReportDetail.parse(
        ok(await call('put', `/reports/saved/${saved.id}/favorite`, people.ownerA)),
      ).favorite,
    ).toBe(true);
    const actions = (await auditActions(saved.id)).map((a) => a.action);
    expect(actions).toEqual(
      expect.arrayContaining([
        'report.saved',
        'report.updated',
        'report.archived',
        'report.restored',
      ]),
    );
    expect(JSON.stringify(await auditActions(saved.id))).not.toMatch(
      /Jamie|Riley|clients by status/i,
    );
  });

  it('who may open one follows its visibility; the list has tabs', async () => {
    const priv = await saveReport({ visibility: 'PRIVATE' });
    const company = await saveReport({ visibility: 'COMPANY' });
    const roles = await saveReport({ visibility: 'SELECTED', sharedRoles: ['STAFF'] });
    const people2 = await saveReport({
      visibility: 'SELECTED',
      sharedWithUserIds: [people.staffA.id],
    });
    expectError(await call('get', `/reports/saved/${priv.id}`, people.staffA), 404, 'NOT_FOUND');
    for (const r of [company, roles, people2])
      expect((await call('get', `/reports/saved/${r.id}`, people.staffA)).status).toBe(200);
    expect((await call('get', `/reports/saved/${priv.id}`, people.adminA)).status).toBe(200);
    expectError(
      await runReport({ target: { kind: 'SAVED', id: priv.id } }, people.staffA),
      404,
      'NOT_FOUND',
    );
    // Staff run a shared report over their own clients only.
    const asStaff = await result({ target: { kind: 'SAVED', id: company.id } }, people.staffA);
    expect(asStaff.table.rows.map((x) => x.cells.name)).toEqual(['Jamie Sample (fake)']);
    expectError(
      await call('patch', `/reports/saved/${company.id}`, people.staffA, {
        etag: company.etag,
        name: 'x',
      }),
      403,
      'FORBIDDEN',
    );
    expectError(
      await call('post', '/reports/saved', people.ownerA, {
        name: mark('Bad'),
        visibility: 'SELECTED',
        sharedWithUserIds: [people.ownerB.id],
        definition: def(),
      }),
      409,
      'NOT_A_MEMBER',
    );

    const list = (qs: string, who: Who = people.staffA) =>
      call('get', `/reports/saved?${qs}&pageSize=100`, who).then((r) =>
        SavedReportPage.parse(ok(r)).items.map((i) => i.id),
      );
    const staffAll = await list('tab=all');
    expect(staffAll).toEqual(expect.arrayContaining([company.id, roles.id, people2.id]));
    expect(staffAll).not.toContain(priv.id);
    expect(await list('tab=mine', people.ownerA)).toEqual(
      expect.arrayContaining([priv.id, company.id]),
    );
    expect(await list('tab=shared', people.staffA)).toEqual(expect.arrayContaining([company.id]));
    expect(await list('search=nope-nothing', people.ownerA)).toEqual([]);
    // A staff-visible report of a restricted source is not opened by Staff.
    const money = await saveReport({
      visibility: 'COMPANY',
      definition: def({
        category: 'FINANCIAL',
        dataSource: 'invoices_payments',
        columns: ['number', 'total'],
      }),
    });
    expectError(
      await call('get', `/reports/saved/${money.id}`, people.staffA),
      403,
      'FIELD_NOT_ALLOWED',
    );
    // Firm B sees none of it.
    expectError(
      await call('get', `/reports/saved/${company.id}`, people.ownerB, undefined, 'b'),
      404,
      'NOT_FOUND',
    );
    expectError(
      await call('post', `/reports/saved/${company.id}/duplicate`, people.ownerB, {}, 'b'),
      404,
      'NOT_FOUND',
    );
    expect(await list('tab=all', people.ownerB).catch(() => [])).toEqual(expect.any(Array));
  });
});

describe('exports', () => {
  it('make a CSV under the firm’s prefix, with the screen’s numbers, and a short-lived link', async () => {
    const saved = await saveReport({
      definition: def({
        category: 'FINANCIAL',
        dataSource: 'payments_received',
        columns: ['invoice', 'client', 'amount', 'paidOn'],
        showTotals: true,
      }),
    });
    const exp = (body: object, who: Who = people.ownerA) =>
      call('post', '/reports/exports', who, {
        run: { target: { kind: 'SAVED', id: saved.id } },
        format: 'CSV',
        ...body,
      });
    expectError(await exp({}, people.staffA), 403, 'EXPORT_NOT_ALLOWED');
    expectError(await exp({ format: 'PDF' }), 400, 'VALIDATION_FAILED');
    expectError(await exp({ format: 'XLSX' }), 400, 'VALIDATION_FAILED');
    expectError(
      await exp({ run: { target: { kind: 'DEFINITION', definition: def() } } }),
      400,
      'VALIDATION_FAILED',
    );
    expectError(
      await exp({ run: { target: { kind: 'SAVED', id: saved.id }, page: 2 } }),
      400,
      'VALIDATION_FAILED',
    );
    const made = ReportRunStatusView.parse(ok(await exp({})));
    expect(made).toMatchObject({
      kind: 'EXPORT',
      status: 'SUCCEEDED',
      format: 'CSV',
      ready: true,
      rowCount: 1,
      errorCode: null,
    });
    expect(made.fileName).toMatch(/^[A-Za-z0-9-]+_\d{4}-\d{2}-\d{2}_\d{4}-\d{2}-\d{2}\.csv$/);
    expect(made.fileName).not.toMatch(/Riley|5000/);
    const row = await inFirm('a', (tx) =>
      tx.reportRun.findFirstOrThrow({ where: { id: made.runId } }),
    );
    expect(row.s3Key).toMatch(new RegExp(`^tenant/${firms.a}/reports/[0-9a-f-]+\\.csv$`));
    expect(row.sensitive).toBe(true);
    const csv = files.objects.get(row.s3Key!)!.toString('utf8');
    expect(csv).toContain('"Invoice","Client","Amount","Paid Date"');
    expect(csv).toContain('"Riley Example (fake)","50.00"');
    expect(csv.trim().split('\r\n').at(-1)).toMatch(/^"Total","","50.00",""$/);

    const link = DownloadLink.parse(
      ok(await call('get', `/reports/runs/${made.runId}/download`, people.ownerA)),
    );
    expect(link.url).toContain(row.s3Key!);
    expect(link.url).toMatch(/name=/);
    expect(
      ReportRunStatusView.parse(ok(await call('get', `/reports/runs/${made.runId}`, people.adminA)))
        .runId,
    ).toBe(made.runId);
    expectError(await call('get', `/reports/runs/${made.runId}`, people.staffA), 404, 'NOT_FOUND');
    expectError(
      await call('get', `/reports/runs/${made.runId}/download`, people.staffA),
      404,
      'NOT_FOUND',
    );
    expectError(
      await call('get', `/reports/runs/${made.runId}`, people.ownerB, undefined, 'b'),
      404,
      'NOT_FOUND',
    );
    expectError(
      await call('get', `/reports/runs/${randomUUID()}`, people.ownerA),
      404,
      'NOT_FOUND',
    );
    const audit = await auditActions(made.runId);
    expect(audit.map((a) => a.action)).toEqual(
      expect.arrayContaining(['report.exported', 'report.download_link_issued']),
    );
    expect(JSON.stringify(audit)).not.toMatch(/Riley|50\.00/);
  });

  it('a spreadsheet formula in a cell is made inert; hidden columns are left out; locked ones stay', async () => {
    const saved = await saveReport({
      definition: def({
        columns: ['name', 'status', 'email'],
        sortBy: 'name',
        date: { rule: 'ROLLING', preset: 'last_year' },
      }),
    });
    const exp = await call('post', '/reports/exports', people.ownerA, {
      run: {
        target: { kind: 'SAVED', id: saved.id },
        date: { rule: 'ROLLING', preset: 'this_year' },
      },
      format: 'CSV',
      hiddenColumns: ['email', 'name'],
    });
    const made = ReportRunStatusView.parse(ok(exp));
    const row = await inFirm('a', (tx) =>
      tx.reportRun.findFirstOrThrow({ where: { id: made.runId } }),
    );
    const csv = files.objects.get(row.s3Key!)!.toString('utf8');
    expect(csv.split('\r\n')[0]).toBe('﻿"Client Name","Status"');
    expect(csv).not.toContain('@client.test');
    // c3 (made 40 days ago) has a name that starts with "=".
    expect(csv).toContain(`"'=HYPERLINK(""http://evil.test"") (fake)"`);
    expect(csv).not.toMatch(/(^|,)"=HYPERLINK/m);
  });
});

describe('scheduled reports', () => {
  const base = (target: object, over: object = {}) => ({
    target,
    name: mark('Monthly'),
    frequency: 'MONTHLY',
    dayOfMonth: 1,
    runTime: '08:00',
    datePreset: 'last_month',
    formats: ['CSV'],
    recipientUserIds: [people.adminA.id],
    ...over,
  });

  it('creates, changes, pauses, resumes, duplicates and deletes; the next run is in the firm’s zone', async () => {
    const saved = await saveReport({
      definition: def({
        category: 'LEADS',
        dataSource: 'leads',
        columns: ['number', 'name', 'source'],
      }),
      visibility: 'COMPANY',
    });
    const created = ReportScheduleDetail.parse(
      ok(
        await call(
          'post',
          '/reports/schedules',
          people.ownerA,
          base({ kind: 'SAVED', id: saved.id }),
        ),
        201,
      ),
    );
    expect(created).toMatchObject({
      frequency: 'MONTHLY',
      dayOfMonth: 1,
      runTime: '08:00',
      datePreset: 'last_month',
      active: true,
      formats: ['CSV'],
      target: { kind: 'SAVED', id: saved.id },
      description: 'Monthly on the 1st at 8:00 AM',
      timezone: 'America/New_York',
    });
    expect(Date.parse(created.nextRunAt!)).toBeGreaterThan(Date.now());
    expect(created.recipientUsers.map((u) => u.userId)).toEqual([people.adminA.id]);
    // 08:00 in New York is 12:00 or 13:00 UTC.
    expect(['12:00', '13:00']).toContain(created.nextRunAt!.slice(11, 16));
    expect(
      (
        await call('get', `/reports/saved/${saved.id}`, people.ownerA).then((r) =>
          SavedReportDetail.parse(ok(r)),
        )
      ).scheduleCount,
    ).toBe(1);

    const weekly = ReportScheduleDetail.parse(
      ok(
        await call('patch', `/reports/schedules/${created.id}`, people.ownerA, {
          frequency: 'WEEKLY',
          weekday: 1,
          runTime: '09:30',
        }),
      ),
    );
    expect(weekly).toMatchObject({
      frequency: 'WEEKLY',
      weekday: 1,
      dayOfMonth: null,
      description: 'Every Monday at 9:30 AM',
    });
    expect(new Date(weekly.nextRunAt!).getUTCDay()).toBeGreaterThanOrEqual(0);
    expectError(
      await call('patch', `/reports/schedules/${created.id}`, people.ownerA, {
        frequency: 'ANNUAL',
        dayOfMonth: 5,
      }),
      400,
      'VALIDATION_FAILED',
    );
    expectError(
      await call('patch', `/reports/schedules/${created.id}`, people.ownerA, {}),
      400,
      'VALIDATION_FAILED',
    );
    expectError(
      await call('patch', `/reports/schedules/${created.id}`, people.staffA, { runTime: '10:00' }),
      403,
      'FORBIDDEN',
    );

    const paused = ReportScheduleDetail.parse(
      ok(await call('post', `/reports/schedules/${created.id}/pause`, people.ownerA)),
    );
    expect(paused).toMatchObject({ active: false, nextRunAt: null });
    const resumed = ReportScheduleDetail.parse(
      ok(await call('post', `/reports/schedules/${created.id}/resume`, people.ownerA)),
    );
    expect(resumed.active).toBe(true);
    expect(resumed.nextRunAt).not.toBeNull();
    const copy = ReportScheduleDetail.parse(
      ok(await call('post', `/reports/schedules/${created.id}/duplicate`, people.ownerA), 201),
    );
    expect(copy).toMatchObject({ active: false, nextRunAt: null });
    expect(copy.name).toMatch(/\(Copy\)$/);

    const list = ReportSchedulePage.parse(
      ok(await call('get', '/reports/schedules?status=paused', people.ownerA)),
    );
    expect(list.items.map((s) => s.id)).toContain(copy.id);
    // Others see only their own; Staff cannot reach the owner's.
    expectError(
      await call('get', `/reports/schedules/${created.id}`, people.staffA),
      404,
      'NOT_FOUND',
    );
    expectError(
      await call('get', `/reports/schedules/${created.id}`, people.ownerB, undefined, 'b'),
      404,
      'NOT_FOUND',
    );
    const dash = ReportsDashboard.parse(ok(await call('get', '/reports', people.ownerA)));
    expect(dash.scheduled.map((s) => s.id)).toContain(created.id);

    expect(
      OkResponse.parse(ok(await call('delete', `/reports/schedules/${copy.id}`, people.ownerA))),
    ).toEqual({ ok: true });
    expect(
      ReportSchedulePage.parse(
        ok(await call('get', '/reports/schedules?pageSize=100', people.ownerA)),
      ).items.map((s) => s.id),
    ).not.toContain(copy.id);
    expectError(
      await call('get', `/reports/schedules/${copy.id}`, people.ownerA),
      404,
      'NOT_FOUND',
    );
    // The row stays for the runs that point at it.
    expect(
      (await inFirm('a', (tx) => tx.reportSchedule.findFirstOrThrow({ where: { id: copy.id } })))
        .deletedAt,
    ).not.toBeNull();
    expect((await auditActions(created.id)).map((a) => a.action)).toEqual(
      expect.arrayContaining([
        'report_schedule.created',
        'report_schedule.updated',
        'report_schedule.paused',
        'report_schedule.resumed',
      ]),
    );
  });

  it('only members who may see the data are recipients; nothing goes outside the firm; only CSV for now', async () => {
    const money = await saveReport({
      definition: def({
        category: 'FINANCIAL',
        dataSource: 'invoices_payments',
        columns: ['number', 'total'],
      }),
      visibility: 'COMPANY',
    });
    const target = { kind: 'SAVED', id: money.id };
    expectError(
      await call(
        'post',
        '/reports/schedules',
        people.ownerA,
        base(target, { recipientUserIds: [people.staffA.id] }),
      ),
      409,
      'RECIPIENT_NOT_ALLOWED',
    );
    expectError(
      await call(
        'post',
        '/reports/schedules',
        people.ownerA,
        base(target, { recipientUserIds: [], recipientEmails: ['cfo@example.com'] }),
      ),
      409,
      'RECIPIENT_NOT_ALLOWED',
    );
    expectError(
      await call(
        'post',
        '/reports/schedules',
        people.ownerA,
        base(target, { recipientUserIds: [people.ownerB.id] }),
      ),
      409,
      'NOT_A_MEMBER',
    );
    expectError(
      await call('post', '/reports/schedules', people.ownerA, base(target, { formats: ['PDF'] })),
      400,
      'VALIDATION_FAILED',
    );
    expectError(
      await call(
        'post',
        '/reports/schedules',
        people.ownerA,
        base(target, { recipientUserIds: [] }),
      ),
      400,
      'VALIDATION_FAILED',
    );
    expectError(
      await call(
        'post',
        '/reports/schedules',
        people.ownerA,
        base(target, { datePreset: 'custom' }),
      ),
      400,
      'VALIDATION_FAILED',
    );
    expectError(
      await call('post', '/reports/schedules', people.staffA, base(target)),
      403,
      'FORBIDDEN',
    );
    expectError(
      await call(
        'post',
        '/reports/schedules',
        people.ownerA,
        base({ kind: 'SAVED', id: randomUUID() }),
      ),
      404,
      'NOT_FOUND',
    );
    expectError(
      await call(
        'post',
        '/reports/schedules',
        people.ownerA,
        base({ kind: 'SYSTEM', key: 'nope' }),
      ),
      404,
      'NOT_FOUND',
    );
    // A built-in report and a restricted one to an Admin work.
    const sys = ReportScheduleDetail.parse(
      ok(
        await call(
          'post',
          '/reports/schedules',
          people.ownerA,
          base(
            { kind: 'SYSTEM', key: 'revenue_summary' },
            { frequency: 'DAILY', dayOfMonth: undefined },
          ),
        ),
        201,
      ),
    );
    expect(sys).toMatchObject({
      target: { kind: 'SYSTEM', key: 'revenue_summary' },
      description: 'Every day at 8:00 AM',
    });
    // Save & Schedule: a new report with the schedule.
    const both = ReportScheduleDetail.parse(
      ok(
        await call(
          'post',
          '/reports/schedules',
          people.ownerA,
          base(
            { kind: 'NEW', report: { name: mark('Scheduled New'), definition: def() } },
            { frequency: 'QUARTERLY', dayOfMonth: 15 },
          ),
        ),
        201,
      ),
    );
    expect(both.target.kind).toBe('SAVED');
    expect(both.description).toBe('Quarterly on the 15th at 8:00 AM');
    const monthOfQuarter = new Date(both.nextRunAt!).getUTCMonth() + 1;
    expect([1, 4, 7, 10]).toContain(monthOfQuarter);
  });

  it('Run Now makes a snapshot of the current data under the schedule', async () => {
    const sys = ReportScheduleDetail.parse(
      ok(
        await call(
          'post',
          '/reports/schedules',
          people.ownerA,
          base(
            { kind: 'SYSTEM', key: 'lead_pipeline' },
            { frequency: 'WEEKLY', weekday: 2, dayOfMonth: undefined },
          ),
        ),
        201,
      ),
    );
    expectError(
      await call('post', `/reports/schedules/${sys.id}/run-now`, people.staffA),
      403,
      'FORBIDDEN',
    );
    const made = ReportRunStatusView.parse(
      ok(await call('post', `/reports/schedules/${sys.id}/run-now`, people.ownerA)),
    );
    expect(made).toMatchObject({ kind: 'SCHEDULED', status: 'SUCCEEDED', ready: true });
    const row = await inFirm('a', (tx) =>
      tx.reportRun.findFirstOrThrow({ where: { id: made.runId } }),
    );
    expect(row.scheduleId).toBe(sys.id);
    expect(
      (
        await call('get', `/reports/schedules/${sys.id}`, people.ownerA).then((r) =>
          ReportScheduleDetail.parse(ok(r)),
        )
      ).lastRunAt,
    ).not.toBeNull();
  });
});

describe('settings and lookups', () => {
  it('everyone reads the metric settings; Owner and Admin change them, and the dashboard follows', async () => {
    expect(
      ReportSettingsView.parse(ok(await call('get', '/reports/settings', people.staffA))),
    ).toMatchObject({
      revenueBasis: 'COLLECTED',
      includeTaxDefault: false,
      defaultDatePreset: 'this_year',
      timezone: 'America/New_York',
    });
    expectError(
      await call('put', '/reports/settings', people.staffA, { revenueBasis: 'INVOICED' }),
      403,
      'FORBIDDEN',
    );
    expectError(
      await call('put', '/reports/settings', people.ownerA, {}),
      400,
      'VALIDATION_FAILED',
    );
    expectError(
      await call('put', '/reports/settings', people.ownerA, { staleAfterMinutes: 1 }),
      400,
      'VALIDATION_FAILED',
    );
    const saved = ReportSettingsView.parse(
      ok(
        await call('put', '/reports/settings', people.adminA, {
          defaultDatePreset: 'this_month',
          includeTaxDefault: true,
        }),
      ),
    );
    expect(saved).toMatchObject({ defaultDatePreset: 'this_month', includeTaxDefault: true });
    expect(saved.updatedAt).not.toBeNull();
    // The default range applies to a built-in report with no range of its own.
    expect((await quick('new_clients')).range.label).toBe('This Month');
    ok(
      await call('put', '/reports/settings', people.ownerA, {
        defaultDatePreset: 'this_year',
        includeTaxDefault: false,
        revenueBasis: 'INVOICED',
      }),
    );
    const invoiced = ReportsDashboard.parse(ok(await call('get', '/reports', people.ownerA)));
    expect(invoiced.kpis.find((k) => k.key === 'total_revenue')?.value).toBeNull();
    ok(await call('put', '/reports/settings', people.ownerA, { revenueBasis: 'COLLECTED' }));
    expect((await auditActions(firms.a)).map((a) => a.action)).toContain('report_settings.updated');
    // Firm B's settings are its own.
    expect(
      ReportSettingsView.parse(
        ok(await call('get', '/reports/settings', people.ownerB, undefined, 'b')),
      ).defaultDatePreset,
    ).toBe('this_year');
  });

  it('selectors offer only what the caller may see', async () => {
    const lookup = async (qs: string, who: Who = people.ownerA) =>
      ReportLookupList.parse(ok(await call('get', `/reports/lookups?${qs}`, who))).items;
    expect((await lookup('kind=CLIENT')).map((c) => c.label)).toEqual(
      expect.arrayContaining(['Jamie Sample (fake)', 'Riley Example (fake)']),
    );
    expect((await lookup('kind=CLIENT', people.staffA)).map((c) => c.label)).toEqual([
      'Jamie Sample (fake)',
    ]);
    expect((await lookup('kind=CLIENT&search=riley')).map((c) => c.label)).toEqual([
      'Riley Example (fake)',
    ]);
    expect((await lookup('kind=SERVICE')).map((s) => s.label)).toContain('Bookkeeping');
    expect((await lookup('kind=TEAM_MEMBER')).length).toBe(3);
    expect(await lookup('kind=TEAM_MEMBER', people.staffA)).toEqual([]);
    expect((await lookup('kind=LEAD_SOURCE&search=ref')).map((s) => s.id)).toEqual(['REFERRAL']);
    expect(
      (await lookup('kind=CLIENT', people.ownerB).catch(() => [])).length,
    ).toBeGreaterThanOrEqual(0);
    expect(
      JSON.stringify(
        await call('get', '/reports/lookups?kind=CLIENT', people.ownerB, undefined, 'b').then(
          (r) => r.body,
        ),
      ),
    ).not.toMatch(/Jamie|Riley/);
    expectError(
      await call('get', '/reports/lookups?kind=PLANET', people.ownerA),
      400,
      'VALIDATION_FAILED',
    );
  });
});
