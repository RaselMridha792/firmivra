import {
  AddPayrollClientRequest,
  AddPayrollReportRequest,
  CompletePayrollRunRequest,
  CreatePayrollRunRequest,
  CreatePayrollWorkerRequest,
  LogPayrollActivityRequest,
  parseInput,
  PayrollClientsQuery,
  type PayrollClient,
  type PayrollClientRow,
  type PayrollClientTab,
  type PayrollClientWorkspace,
  type PayrollIssue,
  PayrollIssuesQuery,
  PayrollLinesQuery,
  PayrollListQuery,
  PayrollOverviewQuery,
  PayrollFilingsQuery,
  PayrollReportsQuery,
  PayrollRunsQuery,
  PayrollWorkersQuery,
  PayrollYearEndQuery,
  type PayrollRun,
  type PayrollWorker,
  type PayrollYearEnd,
  PayrollFrequencyRequest,
  PayrollAssignRequest,
  PayrollPlanRequest,
  PayrollReasonRequest,
  PayrollRemoveServiceRequest,
  PayrollStatusRequest,
  ReopenPayrollRunRequest,
  ResolvePayrollIssueRequest,
  SavePayrollLinesRequest,
  SavePayrollSettingsRequest,
  SavePayrollYearEndRequest,
  SubmitPayrollRunRequest,
  UpdatePayrollClientRequest,
  UpdatePayrollRunRequest,
  UpdatePayrollWorkerRequest,
  PAYROLL_YEAR_END_STEPS,
} from '@firmivra/types';
import { mockDelay } from '../lib/mock';
import {
  type Options,
  type Rec,
  type Run,
  copy,
  daysBetween,
  fail,
  figuresOf,
  iso,
  linesFor,
  memberOf,
  nowIso,
  periodAt,
  PROVIDERS,
  providerRef,
  rowOf,
  seedStore,
  today,
  uuid,
} from './payroll-base';
import { mockMe } from './appointments';

/**
 * Mock data for `api.payroll` (R39 contract, Payroll). It checks input with the contract's schemas
 * and answers its codes: ALREADY_PAYROLL_CLIENT, NO_PAYROLL_SERVICE, PROVIDER_NOT_CONNECTED,
 * FREQUENCY_REQUIRED, RUN_EXISTS, RUN_STATE, RUN_BLOCKED, RUN_EMPTY, CLIENT_STATE,
 * NOT_THIS_CLIENTS, DUPLICATE. Figures are only what the lines support, never estimated. STAFF
 * cannot approve, reopen or remove a service (403). `empty: true`
 * (NEXT_PUBLIC_API_MOCK_EMPTY=payroll) starts with no payroll clients.
 */
const OPEN_RUN = [
  'DRAFT',
  'IN_PROGRESS',
  'READY_FOR_REVIEW',
  'APPROVED',
  'SUBMITTED',
  'PROCESSING',
  'NEEDS_ATTENTION',
];
const EDITABLE = ['NOT_STARTED', 'DRAFT', 'IN_PROGRESS', 'NEEDS_ATTENTION'];
// The clients the Clients mock offers (mocks/clients.ts): only a business has a payroll service.
const POOL = [
  {
    id: '0199b6a1-0000-7000-8000-000000000001',
    displayName: 'Jamie Sample',
    clientNumber: 1001,
    accountType: 'INDIVIDUAL' as const,
  },
  {
    id: '0199b6a1-0000-7000-8000-000000000002',
    displayName: 'Acme Widgets LLC (fake)',
    clientNumber: 1002,
    accountType: 'BUSINESS' as const,
  },
  {
    id: '0199b6a1-0000-7000-8000-000000000003',
    displayName: 'Riley Example',
    clientNumber: 1003,
    accountType: 'INDIVIDUAL' as const,
  },
];
const page = <T>(rows: T[], q: { page?: number; pageSize?: number }) => {
  const size = q.pageSize ?? 20;
  const at = q.page ?? 1;
  return {
    items: rows.slice((at - 1) * size, at * size),
    total: rows.length,
    page: at,
    pageSize: size,
  };
};
const pct = (now: number | null, before: number | null) =>
  now === null || before === null || before === 0
    ? null
    : Math.round(((now - before) / before) * 1000) / 10;

export function createPayrollMock({ role = 'OWNER', empty = false }: Options = {}): PayrollClient {
  const store = seedStore(empty);
  const id = (block: string) => uuid(block, store.next++);
  const run = async <T>(work: () => T): Promise<T> => {
    await mockDelay();
    return copy(work());
  };
  const elevated = () => {
    if (role === 'STAFF') throw fail(403, 'FORBIDDEN', 'This action is not permitted');
  };
  const rec = (clientId: string) => {
    const r = store.clients.find((c) => c.id === clientId);
    if (!r) throw fail(404, 'NOT_FOUND', 'That payroll client was not found.');
    return r;
  };
  const runOf = (runId: string) => {
    for (const c of store.clients) {
      const r = c.runs.find((x) => x.id === runId);
      if (r) return { rec: c, run: r };
    }
    throw fail(404, 'NOT_FOUND', 'That payroll run was not found.');
  };
  const log = (
    r: Rec,
    field: string,
    oldValue: string | null,
    newValue: string | null,
    reason: string | null = null,
  ) =>
    r.changes.unshift({
      id: id('9a20'),
      field,
      oldValue,
      newValue,
      reason,
      changedBy: mockMe,
      changedAt: nowIso(),
    });

  const nextRunOf = (r: Rec) =>
    r.runs
      .filter((x) => x.status !== 'COMPLETED')
      .sort((a, b) => a.payDate.localeCompare(b.payDate))[0];
  const schedule = (r: Rec) => {
    if (r.nextPayrollOverride) return { on: r.nextPayrollOverride, source: 'schedule' as const };
    const n = nextRunOf(r);
    if (r.providerKey && n) return { on: n.payDate, source: 'provider' as const };
    if (r.frequency)
      return { on: periodAt(r.frequency, today(), 0).pay, source: 'schedule' as const };
    return { on: null, source: null };
  };
  const syncOf = (r: Rec): PayrollClientRow['syncStatus'] => {
    if (!r.providerKey) return 'NOT_CONNECTED';
    if (!r.lastSyncedAt) return 'NEVER';
    return Date.now() - Date.parse(r.lastSyncedAt) > store.settings.staleAfterHours * 3_600_000
      ? 'STALE'
      : 'SYNCED';
  };
  const reevaluate = (r: Rec) => {
    if (r.status === 'ON_HOLD' || r.status === 'ARCHIVED') return;
    const open = r.runs.filter((x) => OPEN_RUN.includes(x.status));
    r.status = !r.providerKey
      ? 'NOT_STARTED'
      : open.some((x) => x.status === 'NEEDS_ATTENTION')
        ? 'ACTION_REQUIRED'
        : open.some((x) => x.payDate < today() && !['SUBMITTED', 'PROCESSING'].includes(x.status))
          ? 'PAST_DUE'
          : open.length
            ? 'PROCESSING'
            : 'ON_TRACK';
  };
  const employees = (r: Rec) =>
    r.workers.filter((w) => w.workerType !== 'CONTRACTOR' && w.status !== 'INACTIVE').length;
  const rowOfClient = (r: Rec): PayrollClientRow => {
    const s = schedule(r);
    return {
      id: r.id,
      client: r.client,
      engagementId: r.engagementId,
      provider: providerRef(r.providerKey),
      frequency: r.frequency,
      employeeCount: employees(r),
      status: r.status,
      nextPayrollOn: s.on,
      nextPayrollSource: s.source,
      lastRunOn:
        r.runs
          .filter((x) => x.status === 'COMPLETED')
          .map((x) => x.payDate)
          .sort()
          .pop() ?? null,
      syncStatus: syncOf(r),
      lastSyncedAt: r.lastSyncedAt,
      assignedTo: r.assignedTo,
    };
  };
  const active = () => store.clients.filter((r) => r.status !== 'ARCHIVED');
  const tabOf = (r: Rec, tab: PayrollClientTab) => {
    const row = rowOfClient(r);
    if (tab === 'ALL') return true;
    if (tab === 'UPCOMING')
      return (
        row.nextPayrollOn !== null &&
        daysBetween(today(), row.nextPayrollOn) <= 14 &&
        daysBetween(today(), row.nextPayrollOn) >= 0
      );
    return r.status === tab;
  };
  const figuresOfLatest = (r: Rec) => {
    const done = r.runs
      .filter((x) => x.status === 'COMPLETED')
      .sort((a, b) => a.payDate.localeCompare(b.payDate));
    const last = done[done.length - 1];
    const prev = done[done.length - 2];
    return { last, prev };
  };
  const workspace = (r: Rec): PayrollClientWorkspace => {
    const s = schedule(r);
    const { last, prev } = figuresOfLatest(r);
    const current = r.runs.find((x) => OPEN_RUN.includes(x.status)) ?? null;
    const f = last ? figuresOf(last) : null;
    const pf = prev ? figuresOf(prev) : null;
    const upcoming = r.runs
      .filter((x) => x.status !== 'COMPLETED')
      .sort((a, b) => a.payDate.localeCompare(b.payDate))
      .slice(0, 4);
    const w = r.workers.filter((x) => x.status !== 'INACTIVE');
    return {
      id: r.id,
      client: r.client,
      engagementId: r.engagementId,
      plan: r.plan,
      status: r.status,
      frequency: r.frequency,
      industry: r.industry,
      provider: providerRef(r.providerKey),
      serviceSince: r.serviceSince,
      nextPayrollOn: s.on,
      nextPayrollSource: s.source,
      lastRunOn: last?.payDate ?? null,
      lastSyncedAt: r.lastSyncedAt,
      lastSyncAttemptAt: r.lastSyncAttemptAt,
      syncStatus: syncOf(r),
      assignedTo: r.assignedTo,
      pausedAt: r.pausedAt,
      archivedAt: r.archivedAt,
      employeeCount: employees(r),
      employeeCountAt: r.lastSyncedAt,
      workers: {
        fullTime: w.filter((x) => x.workerType === 'FULL_TIME').length,
        partTime: w.filter((x) => x.workerType === 'PART_TIME').length,
        contractors: w.filter((x) => x.workerType === 'CONTRACTOR').length,
        onLeave: w.filter((x) => x.status === 'ON_LEAVE').length,
      },
      currentRun: current ? rowOf(r, current) : null,
      latestRun:
        last && f
          ? {
              run: rowOf(r, last),
              figures: f,
              changeVsPrevious: {
                grossPercent: pct(f.grossCents, pf?.grossCents ?? null),
                taxesPercent: pct(
                  (f.employeeTaxesCents ?? 0) + (f.employerTaxesCents ?? 0),
                  pf ? (pf.employeeTaxesCents ?? 0) + (pf.employerTaxesCents ?? 0) : null,
                ),
                netPercent: pct(f.netCents, pf?.netCents ?? null),
              },
            }
          : null,
      upcomingRuns: upcoming.map((x) => rowOf(r, x)),
      recentWorkers: [...r.workers]
        .sort((a, b) => (b.lastChangeAt ?? '').localeCompare(a.lastChangeAt ?? ''))
        .slice(0, 5),
      openRunIssues: current
        ? current.issues.filter((i) => !i.resolvedAt && i.severity !== 'INFO').length
        : 0,
      createdAt: r.createdAt,
    };
  };
  const runView = (r: Rec, x: Run): PayrollRun => {
    const f = figuresOf(x);
    const blocked = x.issues.some((i) => !i.resolvedAt && i.severity === 'ERROR');
    void blocked;
    const edit = EDITABLE.includes(x.status);
    return {
      id: x.id,
      payrollClientId: r.id,
      client: r.client,
      provider: providerRef(r.providerKey),
      periodStart: x.periodStart,
      periodEnd: x.periodEnd,
      payDate: x.payDate,
      frequency: x.frequency,
      status: x.status,
      step: x.step,
      includeContractors: x.includeContractors,
      providerStatus: x.providerStatus,
      providerConfirmation: x.providerConfirmation,
      figures: f,
      lineCounts: {
        total: x.lines.length,
        ready: x.lines.filter((l) => l.status === 'READY').length,
        warning: x.lines.filter((l) => l.status === 'WARNING').length,
        error: x.lines.filter((l) => l.status === 'ERROR').length,
        pendingChange: x.lines.filter((l) => l.status === 'PENDING_CHANGE').length,
        excluded: x.lines.filter((l) => l.status === 'EXCLUDED').length,
      },
      issueCounts: {
        info: x.issues.filter((i) => !i.resolvedAt && i.severity === 'INFO').length,
        warning: x.issues.filter((i) => !i.resolvedAt && i.severity === 'WARNING').length,
        error: x.issues.filter((i) => !i.resolvedAt && i.severity === 'ERROR').length,
      },
      preparedBy: x.preparedBy,
      readyAt: x.readyAt,
      approvedAt: x.approvedAt,
      approvedBy: x.approvedBy,
      submittedAt: x.submittedAt,
      submittedBy: x.submittedBy,
      reopenedAt: x.reopenedAt,
      reopenReason: x.reopenReason,
      completedAt: x.completedAt,
      actions: {
        canEdit: edit,
        canMarkReady: edit && x.status !== 'NOT_STARTED',
        canApprove: x.status === 'READY_FOR_REVIEW' && role !== 'STAFF',
        canSubmit: x.status === 'APPROVED' && role !== 'STAFF',
        canReopen:
          ['READY_FOR_REVIEW', 'APPROVED', 'SUBMITTED', 'NEEDS_ATTENTION'].includes(x.status) &&
          role !== 'STAFF',
      },
      recentRuns: r.runs
        .filter((y) => y.status === 'COMPLETED')
        .sort((a, b) => b.payDate.localeCompare(a.payDate))
        .slice(0, 3)
        .map((y) => rowOf(r, y)),
      createdAt: x.createdAt,
      updatedAt: x.updatedAt,
    };
  };
  const touch = (r: Rec, x: Run) => {
    x.updatedAt = nowIso();
    reevaluate(r);
    return runView(r, x);
  };
  const needEdit = (x: Run) => {
    if (!EDITABLE.includes(x.status)) {
      throw fail(409, 'RUN_STATE', 'This run is no longer being prepared. Reopen it first.');
    }
  };
  /** The checks a run goes through before review: blocking errors, warnings and notes. */
  const regenerate = (r: Rec, x: Run) => {
    const keep = new Map(x.issues.map((i) => [`${i.code}|${i.workerId ?? ''}`, i]));
    const next: PayrollIssue[] = [];
    const add = (
      severity: PayrollIssue['severity'],
      code: string,
      message: string,
      workerId: string | null,
      name: string | null,
    ) => {
      const old = keep.get(`${code}|${workerId ?? ''}`);
      next.push({
        id: old?.id ?? id('9a30'),
        severity,
        code,
        message,
        workerId,
        workerName: name,
        resolvedAt: old?.resolvedAt ?? null,
        resolvedBy: old?.resolvedBy ?? null,
        createdAt: old?.createdAt ?? nowIso(),
      });
    };
    for (const l of x.lines) {
      const w = r.workers.find((y) => y.id === l.worker.id);
      if (l.status === 'EXCLUDED') continue;
      if (w && w.directDepositReady === false) {
        add(
          'ERROR',
          'BANK_NOT_VALIDATED',
          `${l.worker.displayName}: the bank account is not validated.`,
          w.id,
          l.worker.displayName,
        );
      }
      if (l.overtimePayCents > 0) {
        add(
          'WARNING',
          'OVERTIME_REVIEW',
          `${l.worker.displayName} has overtime hours. Review for accuracy.`,
          l.worker.id,
          l.worker.displayName,
        );
      }
      if (w?.status === 'PENDING_SETUP' || l.status === 'PENDING_CHANGE') {
        add(
          'INFO',
          'NEW_HIRE_PENDING',
          `${l.worker.displayName} is a new hire pending approval.`,
          l.worker.id,
          l.worker.displayName,
        );
      }
      if (l.hours > 200) {
        add(
          'ERROR',
          'INVALID_HOURS',
          `${l.worker.displayName}: ${l.hours} hours is not valid for one period.`,
          l.worker.id,
          l.worker.displayName,
        );
      }
    }
    x.issues = next;
    for (const l of x.lines) {
      const hit = next.find((i) => i.workerId === l.worker.id && !i.resolvedAt);
      if (l.status !== 'EXCLUDED' && l.status !== 'PENDING_CHANGE') {
        l.status =
          hit?.severity === 'ERROR' ? 'ERROR' : hit?.severity === 'WARNING' ? 'WARNING' : 'READY';
      }
    }
  };
  const lineList = (x: Run, query: ReturnType<typeof PayrollLinesQuery.parse>) => {
    const term = query.search?.toLowerCase();
    const tabOfLine = (t: string, l: Run['lines'][number]) =>
      t === 'ALL' ||
      (t === 'FULL_TIME' && l.worker.workerType === 'FULL_TIME') ||
      (t === 'PART_TIME' && l.worker.workerType === 'PART_TIME') ||
      (t === 'CONTRACTORS' && l.worker.workerType === 'CONTRACTOR') ||
      (t === 'ON_LEAVE' && l.worker.status === 'ON_LEAVE');
    const rows = x.lines.filter(
      (l) =>
        tabOfLine(query.tab, l) &&
        (!query.status || l.status === query.status) &&
        (!term || l.worker.displayName.toLowerCase().includes(term)),
    );
    const count = (t: string) => x.lines.filter((l) => tabOfLine(t, l)).length;
    return {
      ...page(rows, query),
      tabCounts: {
        ALL: count('ALL'),
        FULL_TIME: count('FULL_TIME'),
        PART_TIME: count('PART_TIME'),
        ON_LEAVE: count('ON_LEAVE'),
        CONTRACTORS: count('CONTRACTORS'),
      },
    };
  };

  return {
    overview: (q = {}) =>
      run(() => {
        const query = parseInput(PayrollOverviewQuery, q);
        const t = new Date(`${today()}T12:00:00Z`);
        const y = t.getUTCFullYear();
        const m = t.getUTCMonth();
        const day = (yy: number, mm: number, d: number) => iso(Date.UTC(yy, mm, d, 12));
        const q0 = Math.floor(m / 3) * 3;
        const range = {
          THIS_MONTH: [day(y, m, 1), day(y, m + 1, 0), day(y, m - 1, 1), day(y, m, 0)],
          LAST_MONTH: [day(y, m - 1, 1), day(y, m, 0), day(y, m - 2, 1), day(y, m - 1, 0)],
          THIS_QUARTER: [day(y, q0, 1), day(y, q0 + 3, 0), day(y, q0 - 3, 1), day(y, q0, 0)],
          THIS_YEAR: [day(y, 0, 1), day(y, 11, 31), day(y - 1, 0, 1), day(y - 1, 11, 31)],
        }[query.period];
        const [from, to, pFrom, pTo] = range as [string, string, string, string];
        const clients = active();
        const done = (a: string, b: string) =>
          clients.flatMap((c) =>
            c.runs
              .filter((r) => r.status === 'COMPLETED' && r.payDate >= a && r.payDate <= b)
              .map((r) => ({ c, r })),
          );
        const cur = done(from, to);
        const prev = done(pFrom, pTo);
        const sum = (list: typeof cur, f: (x: Run) => number | null) =>
          list.reduce((n, { r }) => n + (f(r) ?? 0), 0);
        const kpi = (value: number, previous: number | null) => ({
          value,
          previous,
          changePercent:
            previous && previous > 0 ? Math.round(((value - previous) / previous) * 100) : null,
        });
        const gross = (r: Run) => figuresOf(r).grossCents;
        const attention = (cs: Rec[]) =>
          cs.filter((c) => c.status === 'ACTION_REQUIRED' || c.status === 'PAST_DUE').length;
        const total = clients.filter((c) => c.status !== 'ON_HOLD');
        const byStatus = [
          'ON_TRACK',
          'PROCESSING',
          'ACTION_REQUIRED',
          'PAST_DUE',
          'NOT_STARTED',
        ] as const;
        const months = new Map<string, { gross: number; taxes: number }>();
        for (const c of clients) {
          for (const r of c.runs.filter((x) => x.status === 'COMPLETED')) {
            const f = figuresOf(r);
            const k = r.payDate.slice(0, 7);
            const v = months.get(k) ?? { gross: 0, taxes: 0 };
            v.gross += f.grossCents ?? 0;
            v.taxes += (f.employeeTaxesCents ?? 0) + (f.deductionsCents ?? 0);
            months.set(k, v);
          }
        }
        const providers = new Map<string | null, { gross: number; clients: number }>();
        for (const c of clients) {
          const v = providers.get(c.providerKey) ?? { gross: 0, clients: 0 };
          v.clients += 1;
          v.gross += c.runs
            .filter((r) => r.status === 'COMPLETED' && r.payDate >= from && r.payDate <= to)
            .reduce((n, r) => n + (gross(r) ?? 0), 0);
          providers.set(c.providerKey, v);
        }
        const grossTotal = [...providers.values()].reduce((n, v) => n + v.gross, 0);
        const upcoming = clients
          .filter((c) => c.status !== 'ON_HOLD' && c.providerKey)
          .map((c) => ({ c, s: schedule(c) }))
          .filter(
            (x): x is { c: Rec; s: { on: string; source: 'provider' | 'schedule' } } =>
              x.s.on !== null,
          )
          .sort((a, b) => a.s.on.localeCompare(b.s.on))
          .slice(0, 5);
        return {
          period: { key: query.period, from, to },
          kpis: {
            activeClients: kpi(total.length, null),
            totalProcessedCents: kpi(sum(cur, gross), prev.length ? sum(prev, gross) : null),
            totalEmployees: kpi(
              clients.reduce((n, c) => n + employees(c), 0),
              null,
            ),
            runs: kpi(cur.length, prev.length || null),
            needAttention: kpi(attention(clients), null),
          },
          statusBreakdown: {
            total: total.length,
            items: byStatus.map((status) => ({
              status,
              count: total.filter((c) => c.status === status).length,
            })),
          },
          volume: [...months]
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([month, v]) => ({
              month,
              grossCents: v.gross,
              taxesAndDeductionsCents: v.taxes,
            })),
          byProvider: {
            totalCents: grossTotal,
            items: [...providers]
              .filter(([, v]) => v.gross > 0)
              .map(([key, v]) => ({
                key,
                label: key ? (PROVIDERS[key] ?? key) : 'Not connected',
                grossCents: v.gross,
                sharePercent: grossTotal ? Math.round((v.gross / grossTotal) * 100) : 0,
              })),
          },
          providers: [...providers].map(([key, v]) => ({
            key,
            label: key ? (PROVIDERS[key] ?? key) : 'Not Connected',
            clientCount: v.clients,
            connected: key !== null,
          })),
          upcomingRuns: upcoming.map(({ c, s }) => ({
            payrollClientId: c.id,
            clientName: c.client.displayName,
            frequency: c.frequency,
            nextPayrollOn: s.on,
          })),
        };
      }),
    clients: (q = {}) =>
      run(() => {
        const query = parseInput(PayrollClientsQuery, q);
        const term = query.search?.toLowerCase();
        const base = active().filter(
          (c) =>
            (!query.clientType || c.client.accountType === query.clientType) &&
            (!query.providerKey || c.providerKey === query.providerKey) &&
            (!query.frequency || c.frequency === query.frequency) &&
            (!query.status || c.status === query.status) &&
            (!query.assignedUserId || c.assignedTo?.userId === query.assignedUserId) &&
            (!query.syncStatus || syncOf(c) === query.syncStatus) &&
            (!term || c.client.displayName.toLowerCase().includes(term)) &&
            (!query.nextFrom || (schedule(c).on ?? '') >= query.nextFrom) &&
            (!query.nextTo || (schedule(c).on ?? '9999') <= query.nextTo),
        );
        const rows = base.filter((c) => tabOf(c, query.tab)).map(rowOfClient);
        const key = {
          clientName: (r: PayrollClientRow) => r.client.displayName,
          provider: (r: PayrollClientRow) => r.provider?.label ?? '',
          frequency: (r: PayrollClientRow) => r.frequency ?? '',
          employees: (r: PayrollClientRow) => r.employeeCount ?? 0,
          status: (r: PayrollClientRow) => r.status,
          nextPayrollOn: (r: PayrollClientRow) => r.nextPayrollOn ?? '9999',
          lastRunOn: (r: PayrollClientRow) => r.lastRunOn ?? '',
        }[query.sort];
        rows.sort((a, b) => {
          const x = key(a);
          const y = key(b);
          const c = x < y ? -1 : x > y ? 1 : 0;
          return query.direction === 'desc' ? -c : c;
        });
        const tabs: PayrollClientTab[] = [
          'ALL',
          'ON_TRACK',
          'PROCESSING',
          'ACTION_REQUIRED',
          'PAST_DUE',
          'NOT_STARTED',
          'UPCOMING',
        ];
        return {
          ...page(rows, query),
          tabCounts: Object.fromEntries(
            tabs.map((t) => [t, base.filter((c) => tabOf(c, t)).length]),
          ) as Record<PayrollClientTab, number>,
        };
      }),
    addClient: (body) =>
      run(() => {
        const input = parseInput(AddPayrollClientRequest, body);
        const known =
          POOL.find((c) => c.id === input.clientId) ??
          store.clients.find((c) => c.client.id === input.clientId)?.client;
        if (!known) throw fail(404, 'NOT_FOUND', 'That client was not found.');
        if (store.clients.some((c) => c.client.id === known.id)) {
          throw fail(409, 'ALREADY_PAYROLL_CLIENT', 'This client already has payroll.');
        }
        if (known.accountType === 'INDIVIDUAL') {
          throw fail(409, 'NO_PAYROLL_SERVICE', 'Add a payroll service to this client first.');
        }
        if (input.providerKey && !PROVIDERS[input.providerKey]) {
          throw fail(409, 'PROVIDER_NOT_CONNECTED', 'That provider is not connected.');
        }
        const r: Rec = {
          id: id('9c00'),
          client: known,
          engagementId: id('1e00'),
          plan: null,
          status: input.providerKey ? 'ON_TRACK' : 'NOT_STARTED',
          frequency: input.frequency ?? null,
          industry: input.industry ?? null,
          providerKey: input.providerKey ?? null,
          serviceSince: input.serviceSince ?? today(),
          nextPayrollOverride: null,
          lastSyncedAt: null,
          lastSyncAttemptAt: null,
          assignedTo: memberOf(input.assignedUserId ?? store.settings.defaultAssignee?.userId),
          pausedAt: null,
          archivedAt: null,
          workers: [],
          runs: [],
          filings: [],
          reports: [],
          activities: [],
          changes: [],
          yearEnd: {},
          createdAt: nowIso(),
        };
        store.clients.unshift(r);
        return workspace(r);
      }),
    getClient: (clientId) => run(() => workspace(rec(clientId))),
    updateClient: (clientId, body) =>
      run(() => {
        const input = parseInput(UpdatePayrollClientRequest, body);
        const r = rec(clientId);
        if (input.providerKey !== undefined) {
          if (input.providerKey && !PROVIDERS[input.providerKey]) {
            throw fail(409, 'PROVIDER_NOT_CONNECTED', 'That provider is not connected.');
          }
          log(r, 'provider', r.providerKey, input.providerKey);
          r.providerKey = input.providerKey;
        }
        if (input.frequency !== undefined) {
          log(r, 'frequency', r.frequency, input.frequency);
          r.frequency = input.frequency;
        }
        if (input.industry !== undefined) r.industry = input.industry;
        if (input.assignedUserId !== undefined) r.assignedTo = memberOf(input.assignedUserId);
        if (input.nextPayrollOn !== undefined) r.nextPayrollOverride = input.nextPayrollOn;
        reevaluate(r);
        return workspace(r);
      }),
    setStatus: (clientId, body) =>
      run(() => {
        const input = parseInput(PayrollStatusRequest, body);
        const r = rec(clientId);
        if (r.status === 'ON_HOLD' || r.status === 'ARCHIVED') {
          throw fail(409, 'CLIENT_STATE', 'Resume the service before changing its status.');
        }
        log(r, 'status', r.status, input.status, input.reason ?? null);
        r.status = input.status;
        return workspace(r);
      }),
    pause: (clientId, body = {}) =>
      run(() => {
        const input = parseInput(PayrollReasonRequest, body);
        const r = rec(clientId);
        if (r.status === 'ON_HOLD' || r.status === 'ARCHIVED') {
          throw fail(409, 'CLIENT_STATE', 'This payroll service is already paused or archived.');
        }
        log(r, 'status', r.status, 'ON_HOLD', input.reason ?? null);
        r.status = 'ON_HOLD';
        r.pausedAt = nowIso();
        return workspace(r);
      }),
    resume: (clientId) =>
      run(() => {
        const r = rec(clientId);
        if (r.status !== 'ON_HOLD')
          throw fail(409, 'CLIENT_STATE', 'Only a paused service can be resumed.');
        r.status = 'ON_TRACK';
        r.pausedAt = null;
        reevaluate(r);
        log(r, 'status', 'ON_HOLD', r.status);
        return workspace(r);
      }),
    archive: (clientId, body = {}) =>
      run(() => {
        const input = parseInput(PayrollReasonRequest, body);
        const r = rec(clientId);
        if (r.status === 'ARCHIVED')
          throw fail(409, 'CLIENT_STATE', 'This payroll client is already archived.');
        log(r, 'status', r.status, 'ARCHIVED', input.reason ?? null);
        r.status = 'ARCHIVED';
        r.archivedAt = nowIso();
        return workspace(r);
      }),
    removeService: (clientId, body) =>
      run(() => {
        elevated();
        const input = parseInput(PayrollRemoveServiceRequest, body);
        const r = rec(clientId);
        log(r, 'service', 'payroll', null, input.reason);
        const view = workspace(r);
        store.clients = store.clients.filter((c) => c.id !== r.id);
        return view;
      }),
    assign: (clientId, body) =>
      run(() => {
        const input = parseInput(PayrollAssignRequest, body);
        const r = rec(clientId);
        log(
          r,
          'assignedTo',
          r.assignedTo?.name ?? null,
          memberOf(input.assignedUserId)?.name ?? null,
        );
        r.assignedTo = memberOf(input.assignedUserId);
        return workspace(r);
      }),
    setFrequency: (clientId, body) =>
      run(() => {
        const input = parseInput(PayrollFrequencyRequest, body);
        const r = rec(clientId);
        log(r, 'frequency', r.frequency, input.frequency);
        r.frequency = input.frequency;
        return workspace(r);
      }),
    setPlan: (clientId, body) =>
      run(() => {
        const input = parseInput(PayrollPlanRequest, body);
        const r = rec(clientId);
        log(r, 'plan', r.plan, input.plan);
        r.plan = input.plan;
        return workspace(r);
      }),
    changes: (clientId, q = {}) =>
      run(() => {
        const query = parseInput(PayrollListQuery, q);
        return page(rec(clientId).changes, query);
      }),
    sync: (clientId) =>
      run(() => {
        const r = rec(clientId);
        if (!r.providerKey)
          throw fail(409, 'PROVIDER_NOT_CONNECTED', 'Connect a payroll provider first.');
        r.lastSyncAttemptAt = nowIso();
        r.lastSyncedAt = nowIso();
        return { queued: true as const, requestedAt: nowIso() };
      }),
    activities: (clientId, q = {}) =>
      run(() => {
        const query = parseInput(PayrollListQuery, q);
        return page(rec(clientId).activities, query);
      }),
    logActivity: (clientId, body) =>
      run(() => {
        const input = parseInput(LogPayrollActivityRequest, body);
        const r = rec(clientId);
        const a = {
          id: id('9a10'),
          kind: input.kind,
          summary: input.summary,
          occurredAt: input.occurredAt ?? nowIso(),
          loggedBy: mockMe,
        };
        r.activities.unshift(a);
        return a;
      }),
    workers: (clientId, q = {}) =>
      run(() => {
        const query = parseInput(PayrollWorkersQuery, q);
        const r = rec(clientId);
        const term = query.search?.toLowerCase();
        const inTab = (t: string, w: PayrollWorker) =>
          t === 'ALL' ||
          (t === 'FULL_TIME' && w.workerType === 'FULL_TIME') ||
          (t === 'PART_TIME' && w.workerType === 'PART_TIME') ||
          (t === 'CONTRACTORS' && w.workerType === 'CONTRACTOR') ||
          (t === 'ON_LEAVE' && w.status === 'ON_LEAVE');
        const rows = r.workers.filter(
          (w) =>
            inTab(query.tab, w) &&
            (!query.status || w.status === query.status) &&
            (!term || w.displayName.toLowerCase().includes(term)),
        );
        const count = (t: string) => r.workers.filter((w) => inTab(t, w)).length;
        return {
          ...page(rows, query),
          tabCounts: {
            ALL: count('ALL'),
            FULL_TIME: count('FULL_TIME'),
            PART_TIME: count('PART_TIME'),
            ON_LEAVE: count('ON_LEAVE'),
            CONTRACTORS: count('CONTRACTORS'),
          },
        };
      }),
    addWorker: (clientId, body) =>
      run(() => {
        const input = parseInput(CreatePayrollWorkerRequest, body);
        const r = rec(clientId);
        if (
          r.workers.some((w) => w.displayName.toLowerCase() === input.displayName.toLowerCase())
        ) {
          throw fail(409, 'DUPLICATE', 'A worker with this name already exists.');
        }
        const w: PayrollWorker = {
          id: id('9a00'),
          displayName: input.displayName,
          workerType: input.workerType,
          status: input.status,
          payType: input.payType ?? null,
          rateCents: input.rateCents ?? null,
          department: input.department ?? null,
          jobTitle: input.jobTitle ?? null,
          startedOn: input.startedOn ?? null,
          directDepositReady: input.directDepositReady ?? null,
          source: 'manual',
          lastChangeAt: nowIso(),
          lastChangeNote: input.changeNote ?? 'Added',
        };
        r.workers.unshift(w);
        return w;
      }),
    updateWorker: (clientId, workerId, body) =>
      run(() => {
        const input = parseInput(UpdatePayrollWorkerRequest, body);
        const r = rec(clientId);
        const w = r.workers.find((x) => x.id === workerId);
        if (!w) throw fail(404, 'NOT_FOUND', 'That worker was not found.');
        const { changeNote, ...fields } = input;
        Object.assign(w, fields, {
          lastChangeAt: nowIso(),
          lastChangeNote: changeNote ?? 'Updated',
        });
        return w;
      }),
    runs: (q = {}) =>
      run(() => {
        const query = parseInput(PayrollRunsQuery, q);
        const rows = active()
          .flatMap((c) => c.runs.map((r) => rowOf(c, r)))
          .filter(
            (r) =>
              (!query.status || r.status === query.status) &&
              (!query.payrollClientId || r.payrollClientId === query.payrollClientId) &&
              (!query.payFrom || r.payDate >= query.payFrom) &&
              (!query.payTo || r.payDate <= query.payTo) &&
              (!query.upcoming || r.status !== 'COMPLETED'),
          )
          .sort((a, b) => b.payDate.localeCompare(a.payDate));
        return page(rows, query);
      }),
    clientRuns: (clientId, q = {}) =>
      run(() => {
        const query = parseInput(PayrollListQuery, q);
        const r = rec(clientId);
        return page(
          r.runs.map((x) => rowOf(r, x)).sort((a, b) => b.payDate.localeCompare(a.payDate)),
          query,
        );
      }),
    createRun: (clientId, body) =>
      run(() => {
        const input = parseInput(CreatePayrollRunRequest, body);
        const r = rec(clientId);
        if (!r.providerKey)
          throw fail(409, 'PROVIDER_NOT_CONNECTED', 'Connect a payroll provider first.');
        const freq = input.frequency ?? r.frequency;
        if (!freq) throw fail(409, 'FREQUENCY_REQUIRED', 'Choose how often this client is paid.');
        if (r.status === 'ON_HOLD' || r.status === 'ARCHIVED') {
          throw fail(409, 'CLIENT_STATE', 'This payroll service is paused or archived.');
        }
        const same = r.runs.find(
          (x) => x.periodStart === input.periodStart && x.periodEnd === input.periodEnd,
        );
        if (same && same.status !== 'NOT_STARTED') {
          throw fail(409, 'RUN_EXISTS', 'A run for this period already exists.');
        }
        const make = same ?? {
          id: id('9d00'),
          clientId: r.id,
          periodStart: input.periodStart,
          periodEnd: input.periodEnd,
          payDate: input.payDate,
          frequency: freq,
          status: 'NOT_STARTED' as Run['status'],
          step: 1,
          includeContractors: input.includeContractors,
          providerStatus: null,
          providerConfirmation: null,
          lines: [],
          issues: [],
          employeeTaxesCents: null,
          employerTaxesCents: null,
          employerBenefitsCents: null,
          preparedBy: null,
          readyAt: null,
          approvedAt: null,
          approvedBy: null,
          submittedAt: null,
          submittedBy: null,
          reopenedAt: null,
          reopenReason: null,
          completedAt: null,
          createdAt: nowIso(),
          updatedAt: nowIso(),
        };
        make.payDate = input.payDate;
        make.frequency = freq;
        make.includeContractors = input.includeContractors;
        make.status = input.start ? 'IN_PROGRESS' : 'DRAFT';
        make.preparedBy = mockMe;
        make.lines = linesFor(r.workers, freq, input.includeContractors, 1);
        if (r.workers.length === 0)
          throw fail(409, 'RUN_EMPTY', 'Add employees before starting a run.');
        if (!same) r.runs.push(make);
        regenerate(r, make);
        return touch(r, make);
      }),
    getRun: (runId) =>
      run(() => {
        const { rec: r, run: x } = runOf(runId);
        return runView(r, x);
      }),
    updateRun: (runId, body) =>
      run(() => {
        const input = parseInput(UpdatePayrollRunRequest, body);
        const { rec: r, run: x } = runOf(runId);
        needEdit(x);
        if (input.step !== undefined) x.step = input.step;
        if (input.payDate !== undefined) x.payDate = input.payDate;
        if (input.frequency !== undefined) x.frequency = input.frequency;
        if (input.includeContractors !== undefined) {
          x.includeContractors = input.includeContractors;
          if (!input.includeContractors)
            x.lines = x.lines.filter((l) => l.worker.workerType !== 'CONTRACTOR');
          else if (!x.lines.some((l) => l.worker.workerType === 'CONTRACTOR')) {
            x.lines.push(
              ...linesFor(
                r.workers.filter((w) => w.workerType === 'CONTRACTOR'),
                x.frequency,
                true,
                1,
              ),
            );
          }
        }
        if (input.employeeTaxesCents !== undefined) x.employeeTaxesCents = input.employeeTaxesCents;
        if (input.employerTaxesCents !== undefined) x.employerTaxesCents = input.employerTaxesCents;
        if (input.employerBenefitsCents !== undefined)
          x.employerBenefitsCents = input.employerBenefitsCents;
        if (x.status === 'NOT_STARTED') x.status = 'IN_PROGRESS';
        return touch(r, x);
      }),
    runLines: (runId, q = {}) =>
      run(() => {
        const query = parseInput(PayrollLinesQuery, q);
        return lineList(runOf(runId).run, query);
      }),
    saveRunLines: (runId, body) =>
      run(() => {
        const input = parseInput(SavePayrollLinesRequest, body);
        const { rec: r, run: x } = runOf(runId);
        needEdit(x);
        for (const l of input.lines) {
          const w = r.workers.find((y) => y.id === l.workerId);
          if (!w) throw fail(409, 'NOT_THIS_CLIENTS', 'That worker is not on this client.');
          const total =
            l.regularPayCents + l.overtimePayCents + l.otherEarningsCents - l.deductionsCents;
          const next = {
            hours: l.hours,
            regularPayCents: l.regularPayCents,
            overtimePayCents: l.overtimePayCents,
            otherEarningsCents: l.otherEarningsCents,
            deductionsCents: l.deductionsCents,
            totalPayCents: Math.max(0, total),
            status: l.status ?? 'READY',
            note: l.note ?? null,
          };
          const old = x.lines.find((y) => y.worker.id === w.id);
          if (old) Object.assign(old, next);
          else {
            x.lines.push({
              id: id('9b00'),
              worker: {
                id: w.id,
                displayName: w.displayName,
                workerType: w.workerType,
                status: w.status,
                payType: w.payType,
                rateCents: w.rateCents,
              },
              ...next,
            });
          }
        }
        if (x.status === 'NOT_STARTED') x.status = 'IN_PROGRESS';
        regenerate(r, x);
        touch(r, x);
        return lineList(x, parseInput(PayrollLinesQuery, {}));
      }),
    runIssues: (runId, q = {}) =>
      run(() => {
        const query = parseInput(PayrollIssuesQuery, q);
        const { run: x } = runOf(runId);
        return {
          items: x.issues.filter(
            (i) =>
              (!query.severity || i.severity === query.severity) &&
              (query.open === undefined || (query.open === 'true') === !i.resolvedAt),
          ),
        };
      }),
    checkRun: (runId) =>
      run(() => {
        const { rec: r, run: x } = runOf(runId);
        regenerate(r, x);
        return { items: x.issues };
      }),
    resolveIssue: (runId, issueId, body) =>
      run(() => {
        const input = parseInput(ResolvePayrollIssueRequest, body);
        const { rec: r, run: x } = runOf(runId);
        needEdit(x);
        const issue = x.issues.find((i) => i.id === issueId);
        if (!issue) throw fail(404, 'NOT_FOUND', 'That issue was not found.');
        issue.resolvedAt = input.resolved ? nowIso() : null;
        issue.resolvedBy = input.resolved ? mockMe : null;
        regenerate(r, x);
        return issue;
      }),
    saveDraft: (runId) =>
      run(() => {
        const { rec: r, run: x } = runOf(runId);
        needEdit(x);
        if (x.status === 'NOT_STARTED') throw fail(409, 'RUN_STATE', 'Start the run first.');
        x.status = 'DRAFT';
        return touch(r, x);
      }),
    markReady: (runId) =>
      run(() => {
        const { rec: r, run: x } = runOf(runId);
        needEdit(x);
        if (x.lines.length === 0) throw fail(409, 'RUN_EMPTY', 'The run has no employees.');
        regenerate(r, x);
        if (x.issues.some((i) => !i.resolvedAt && i.severity === 'ERROR')) {
          throw fail(409, 'RUN_BLOCKED', 'Resolve the errors before review.');
        }
        x.status = 'READY_FOR_REVIEW';
        x.step = 5;
        x.readyAt = nowIso();
        return touch(r, x);
      }),
    approve: (runId) =>
      run(() => {
        elevated();
        const { rec: r, run: x } = runOf(runId);
        if (x.status !== 'READY_FOR_REVIEW')
          throw fail(409, 'RUN_STATE', 'Mark the run ready for review first.');
        x.status = 'APPROVED';
        x.approvedAt = nowIso();
        x.approvedBy = mockMe;
        return touch(r, x);
      }),
    submit: (runId, body) =>
      run(() => {
        elevated();
        const input = parseInput(SubmitPayrollRunRequest, body);
        const { rec: r, run: x } = runOf(runId);
        if (x.status !== 'APPROVED') throw fail(409, 'RUN_STATE', 'Approve the run first.');
        if (!r.providerKey)
          throw fail(409, 'PROVIDER_NOT_CONNECTED', 'Connect a payroll provider first.');
        x.status = 'SUBMITTED';
        x.submittedAt = nowIso();
        x.submittedBy = mockMe;
        x.providerConfirmation = input.providerConfirmation;
        x.providerStatus = input.providerStatus ?? 'processing';
        return touch(r, x);
      }),
    complete: (runId, body = {}) =>
      run(() => {
        const input = parseInput(CompletePayrollRunRequest, body);
        const { rec: r, run: x } = runOf(runId);
        if (x.status !== 'SUBMITTED' && x.status !== 'PROCESSING') {
          throw fail(409, 'RUN_STATE', 'Only a submitted run can be completed.');
        }
        x.status = 'COMPLETED';
        x.completedAt = nowIso();
        x.providerStatus = input.providerStatus ?? 'paid';
        return touch(r, x);
      }),
    reopen: (runId, body) =>
      run(() => {
        elevated();
        const input = parseInput(ReopenPayrollRunRequest, body);
        const { rec: r, run: x } = runOf(runId);
        if (!['READY_FOR_REVIEW', 'APPROVED', 'SUBMITTED', 'NEEDS_ATTENTION'].includes(x.status)) {
          throw fail(409, 'RUN_STATE', 'This run cannot be reopened.');
        }
        x.status = 'IN_PROGRESS';
        x.step = 2;
        x.reopenedAt = nowIso();
        x.reopenReason = input.reason;
        x.approvedAt = null;
        x.approvedBy = null;
        return touch(r, x);
      }),
    filings: (clientId, q = {}) =>
      run(() => {
        const query = parseInput(PayrollFilingsQuery, q);
        const r = rec(clientId);
        const rows = r.filings.filter(
          (f) =>
            (!query.status || f.status === query.status) &&
            (!query.year || f.periodEnd.startsWith(String(query.year))),
        );
        return {
          items: rows,
          counts: {
            upcoming: r.filings.filter((f) => f.status === 'UPCOMING' || f.status === 'IN_PROGRESS')
              .length,
            filed: r.filings.filter((f) => f.status === 'FILED' || f.status === 'PAID').length,
            needsAttention: r.filings.filter(
              (f) => f.status === 'NEEDS_ATTENTION' || f.status === 'FAILED',
            ).length,
          },
        };
      }),
    reports: (clientId, q = {}) =>
      run(() => {
        const query = parseInput(PayrollReportsQuery, q);
        const r = rec(clientId);
        return page(
          r.reports.filter(
            (x) =>
              (!query.kind || x.kind === query.kind) && (!query.runId || x.runId === query.runId),
          ),
          query,
        );
      }),
    addReport: (clientId, body) =>
      run(() => {
        const input = parseInput(AddPayrollReportRequest, body);
        const r = rec(clientId);
        const report = {
          id: id('9f00'),
          kind: input.kind,
          runId: input.runId ?? null,
          periodStart: input.periodStart,
          periodEnd: input.periodEnd,
          version:
            r.reports.filter((x) => x.kind === input.kind && x.periodStart === input.periodStart)
              .length + 1,
          documentId: input.documentId,
          source: 'import' as const,
          pulledAt: nowIso(),
          requestedBy: mockMe,
        };
        r.reports.unshift(report);
        return report;
      }),
    yearEnd: (clientId, q = {}) =>
      run(() => {
        const query = parseInput(PayrollYearEndQuery, q);
        const r = rec(clientId);
        const year = query.taxYear ?? new Date().getFullYear();
        return (
          r.yearEnd[year] ??
          ({
            taxYear: year,
            status: 'NOT_STARTED',
            items: PAYROLL_YEAR_END_STEPS.map((step) => ({ step, state: 'NOT_STARTED' as const })),
            exceptionsNote: null,
            reconciledAt: null,
            deliveredAt: null,
            deliveredBy: null,
            updatedAt: null,
          } satisfies PayrollYearEnd)
        );
      }),
    saveYearEnd: (clientId, taxYear, body) =>
      run(() => {
        const input = parseInput(SavePayrollYearEndRequest, body);
        const r = rec(clientId);
        const cur: PayrollYearEnd = r.yearEnd[taxYear] ?? {
          taxYear,
          status: 'NOT_STARTED',
          items: PAYROLL_YEAR_END_STEPS.map((step) => ({ step, state: 'NOT_STARTED' as const })),
          exceptionsNote: null,
          reconciledAt: null,
          deliveredAt: null,
          deliveredBy: null,
          updatedAt: null,
        };
        if (input.items) {
          for (const i of input.items) {
            const hit = cur.items.find((x) => x.step === i.step);
            if (hit) hit.state = i.state;
          }
        }
        if (input.exceptionsNote !== undefined) cur.exceptionsNote = input.exceptionsNote;
        const states = cur.items.map((x) => x.state);
        cur.status = states.every((s) => s === 'DONE')
          ? 'DELIVERED'
          : states.some((s) => s !== 'NOT_STARTED')
            ? 'IN_PROGRESS'
            : 'NOT_STARTED';
        if (cur.status === 'DELIVERED') {
          cur.deliveredAt = nowIso();
          cur.deliveredBy = mockMe;
        }
        cur.updatedAt = nowIso();
        r.yearEnd[taxYear] = cur;
        return cur;
      }),
    settings: () => run(() => store.settings),
    saveSettings: (body) =>
      run(() => {
        elevated();
        const input = parseInput(SavePayrollSettingsRequest, body);
        store.settings = {
          defaultAssignee: memberOf(input.defaultAssigneeId),
          reminderDaysBefore: input.reminderDaysBefore,
          staleAfterHours: input.staleAfterHours,
          updatedAt: nowIso(),
        };
        return store.settings;
      }),
  };
}
