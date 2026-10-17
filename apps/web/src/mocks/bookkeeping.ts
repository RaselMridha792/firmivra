import {
  ApiRequestError,
  AddBookkeepingAccountRequest,
  AddBookkeepingClientRequest,
  AddBookkeepingReportRequest,
  BOOKKEEPING_PROVIDERS,
  BookkeepingAssignRequest,
  BookkeepingClientsQuery,
  BookkeepingListQuery,
  BookkeepingOverviewQuery,
  BookkeepingPauseRequest,
  BookkeepingPeriodsQuery,
  BookkeepingReasonRequest,
  BookkeepingReopenRequest,
  BookkeepingReportsQuery,
  BookkeepingSendBackRequest,
  BookkeepingStatusRequest,
  ConnectBookkeepingRequest,
  CreateBookkeepingPeriodRequest,
  CreateBookkeepingReconciliationRequest,
  DEFAULT_CLOSE_CHECKLIST,
  DeliverBookkeepingReportRequest,
  LogBookkeepingActivityRequest,
  SaveBookkeepingSettingsRequest,
  UpdateBookkeepingAccountRequest,
  UpdateBookkeepingClientRequest,
  UpdateBookkeepingCloseItemRequest,
  UpdateBookkeepingConnectionRequest,
  UpdateBookkeepingPeriodRequest,
  UpdateBookkeepingReconciliationRequest,
  UpdateBookkeepingReportRequest,
  parseInput,
  type BookkeepingAccount,
  type BookkeepingActivity,
  type BookkeepingClient,
  type BookkeepingClientRow,
  type BookkeepingClientWorkspace,
  type BookkeepingConnection,
  type BookkeepingOverview,
  type BookkeepingPeriod,
  type BookkeepingPeriodSummary,
  type BookkeepingReconciliation,
  type BookkeepingReportRow,
  type BookkeepingSettings,
  type BookkeepingStatus,
  type MemberRef,
} from '@firmivra/types';
import { mockDelay } from '../lib/mock';
import { mockMe } from './appointments';

/**
 * Mock data for `api.bookkeeping` (R38 contract, Bookkeeping). Synthetic firms only, dated around
 * today. It checks input with the contract's schemas and answers its codes: PERIOD_STATE,
 * PERIOD_LOCKED, CLOSE_ITEMS_OPEN, RECON_STATE, RECON_DIFFERENCE, REPORT_STATE, NOT_CONNECTED,
 * CONNECTION_EXISTS, DUPLICATE, ALREADY_BOOKKEEPING_CLIENT, FORBIDDEN. Nothing syncs for real: a
 * sync only stamps the time. `empty: true` (NEXT_PUBLIC_API_MOCK_EMPTY=bookkeeping) starts with no
 * bookkeeping clients.
 */
type MockRole = 'OWNER' | 'ADMIN' | 'STAFF';
interface Options {
  role?: MockRole;
  empty?: boolean;
}
type Status = BookkeepingStatus;
const fail = (status: number, code: string, message: string) =>
  new ApiRequestError(status, code, message);
const copy = <T>(v: T): T => structuredClone(v);
const nowIso = () => new Date().toISOString();
const MAYA: MemberRef = { userId: '0199c0f0-0b00-7000-8000-000000000011', name: 'Alex Rivera' };
const SAM: MemberRef = { userId: '0199c0f0-0b00-7000-8000-000000000012', name: 'Sam Staff' };
const day = (d: Date) => d.toISOString().slice(0, 10);
const monthOf = (back: number) => {
  const t = new Date();
  const start = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() - back, 1));
  const end = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 0));
  return { start, end };
};
const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];
const labelOf = (d: Date) => `${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
const uid = (block: string, n: number) =>
  `0199c0f0-${block}-7000-8000-${String(n).padStart(12, '0')}`;

const SEED = [
  {
    name: 'Green Leaf Café LLC',
    type: 'BUSINESS',
    plan: 'Growth',
    sw: 'quickbooks',
    status: 'ON_TRACK',
    base: 24_580,
  },
  {
    name: 'Turner Group LLC',
    type: 'BUSINESS',
    plan: 'Elite',
    sw: 'xero',
    status: 'NEEDS_ATTENTION',
    base: 41_200,
  },
  {
    name: 'Davis Consulting',
    type: 'BUSINESS',
    plan: 'Foundation',
    sw: 'quickbooks',
    status: 'MISSING_DOCUMENTS',
    base: 18_900,
  },
  {
    name: 'Walker Properties',
    type: 'BUSINESS',
    plan: 'Growth',
    sw: null,
    status: 'ON_TRACK',
    base: 33_400,
  },
  {
    name: 'Jordan Services',
    type: 'BUSINESS',
    plan: 'Starter',
    sw: 'freshbooks',
    status: 'OVERDUE',
    base: 12_300,
  },
  {
    name: 'Smith Enterprises',
    type: 'BUSINESS',
    plan: 'Growth',
    sw: 'quickbooks',
    status: 'ON_TRACK',
    base: 29_750,
  },
  {
    name: 'Thompson Holdings',
    type: 'BUSINESS',
    plan: 'Elite',
    sw: 'zoho_books',
    status: 'NEEDS_ATTENTION',
    base: 52_100,
  },
  {
    name: 'Roberts & Co.',
    type: 'INDIVIDUAL',
    plan: 'Foundation',
    sw: null,
    status: 'NOT_STARTED',
    base: 0,
  },
] as const;

interface Ws extends BookkeepingClientWorkspace {
  _syncRuns: Map<string, import('@firmivra/types').BookkeepingSyncRun[]>;
}

export function createBookkeepingMock({
  role = 'OWNER',
  empty = false,
}: Options = {}): BookkeepingClient {
  let next = 9000;
  const id = (block: string) => uid(block, next++);
  const run = async <T>(work: () => T): Promise<T> => {
    await mockDelay();
    return copy(work());
  };
  const manage = () => {
    if (role === 'STAFF') throw fail(403, 'FORBIDDEN', 'This action is not permitted');
  };
  let settings: BookkeepingSettings = {
    defaultCadence: 'MONTHLY',
    closeTargetDay: 10,
    upcomingReportDays: 14,
    staleSyncHours: 48,
    reconToleranceCents: 0,
    statusRules: { missingDocumentsAfterDays: 7, overdueAfterDays: 3 },
    reminderDefaults: [{ daysBefore: 3, channels: ['EMAIL', 'PORTAL'] }],
    reportSchedule: [
      { report: 'PROFIT_LOSS', cadence: 'MONTHLY', dueDay: 15, delivery: 'PORTAL_AND_EMAIL' },
      { report: 'BALANCE_SHEET', cadence: 'MONTHLY', dueDay: 15, delivery: 'PORTAL' },
    ],
    documentChecklist: [
      { label: 'Bank statements', cadence: 'MONTHLY' },
      { label: 'Credit card statements', cadence: 'MONTHLY' },
    ],
    closeChecklist: DEFAULT_CLOSE_CHECKLIST.map((c) => ({ ...c })),
    updatedAt: null,
  };

  const clients: Ws[] = [];
  const periods = new Map<string, BookkeepingPeriod>();
  const reports = new Map<string, BookkeepingReportRow>();
  const syncRuns = new Map<string, import('@firmivra/types').BookkeepingSyncRun[]>();
  const activities = new Map<string, BookkeepingActivity[]>();

  const summaryOf = (p: BookkeepingPeriod): BookkeepingPeriodSummary => {
    const {
      bookkeepingClientId: _a,
      client: _b,
      readyForReviewAt: _c,
      readyForReviewBy: _d,
      approvedAt: _e,
      approvedBy: _f,
      closedAt: _g,
      closedBy: _h,
      reopenedAt: _i,
      reopenedBy: _j,
      reopenReason: _k,
      closeItems: _l,
      reconciliations: _m,
      accountsWithoutReconciliation: _n,
      reports: _o,
      ...rest
    } = p;
    void [_a, _b, _c, _d, _e, _f, _g, _h, _i, _j, _k, _l, _m, _n, _o];
    return rest;
  };
  const progressOf = (p: BookkeepingPeriod) => {
    const req = p.closeItems.filter((c) => c.required);
    p.progress = {
      done: p.closeItems.filter((c) => c.completed).length,
      total: p.closeItems.length,
      requiredDone: req.filter((c) => c.completed).length,
      requiredTotal: req.length,
    };
  };
  const reconOf = (
    periodId: string,
    acct: BookkeepingAccount,
    start: string,
    end: string,
    begin: number,
    ending: number,
    cleared: number,
    status: BookkeepingReconciliation['status'],
  ): BookkeepingReconciliation => {
    const diff = ending - cleared;
    return {
      id: id('b700'),
      periodId,
      account: { id: acct.id, name: acct.name, type: acct.type, mask: acct.mask },
      statementStart: start,
      statementEnd: end,
      beginningBalanceCents: begin,
      endingBalanceCents: ending,
      clearedBalanceCents: cleared,
      clearedCount: 48,
      differenceCents: diff,
      toleranceCents: settings.reconToleranceCents,
      withinTolerance: Math.abs(diff) <= settings.reconToleranceCents,
      exceptionsCount: diff === 0 ? 0 : 3,
      statementDocumentId: null,
      status,
      readyForReviewAt: status === 'IN_PROGRESS' ? null : nowIso(),
      approvedAt: status === 'APPROVED' ? nowIso() : null,
      approvedBy: status === 'APPROVED' ? mockMe : null,
      reopenedAt: null,
      reopenReason: null,
      updatedAt: nowIso(),
    };
  };
  const reportRow = (
    c: Ws,
    type: BookkeepingReportRow['reportType'],
    period: BookkeepingPeriodSummary | null,
    status: BookkeepingReportRow['status'],
    dueOn: string | null,
  ): BookkeepingReportRow => {
    const names: Record<string, string> = {
      PROFIT_LOSS: 'Profit & Loss',
      BALANCE_SHEET: 'Balance Sheet',
      CASH_FLOW: 'Cash Flow',
      GENERAL_LEDGER: 'General Ledger',
      TRIAL_BALANCE: 'Trial Balance',
      TRANSACTION_DETAIL: 'Transaction Detail',
      UNCATEGORIZED: 'Uncategorized Transactions',
      RECONCILIATION: 'Reconciliation Report',
      QUARTERLY_REVIEW: 'Quarterly Review',
      YEAR_TO_DATE_SUMMARY: 'Year-to-Date Summary',
      BOOKKEEPING_STATUS: 'Bookkeeping Status',
      MISSING_DOCUMENTS: 'Missing Documents',
      CUSTOM: 'Custom Report',
    };
    const r: BookkeepingReportRow = {
      id: id('b800'),
      bookkeepingClientId: c.id,
      client: {
        id: c.client.id,
        displayName: c.client.displayName,
        clientNumber: c.client.clientNumber,
        accountType: c.client.accountType,
      },
      periodId: period?.id ?? null,
      reportType: type,
      name: names[type] ?? type,
      customName: null,
      periodLabel: period?.label ?? 'Year to date',
      basis: 'ACCRUAL',
      dueOn,
      overdue: !!dueOn && dueOn < day(new Date()) && status !== 'DELIVERED',
      status,
      generatedAt: status === 'NOT_STARTED' ? null : nowIso(),
      generatedBy: status === 'NOT_STARTED' ? null : MAYA,
      reviewedAt: status === 'APPROVED' || status === 'DELIVERED' ? nowIso() : null,
      reviewedBy: status === 'APPROVED' || status === 'DELIVERED' ? mockMe : null,
      reviewNote: null,
      deliveredAt: status === 'DELIVERED' ? nowIso() : null,
      deliveredBy: status === 'DELIVERED' ? mockMe : null,
      engagementReportId: status === 'DELIVERED' ? id('b900') : null,
    };
    reports.set(r.id, r);
    return r;
  };

  const seed = () => {
    SEED.forEach((s, i) => {
      const cid = uid('b100', i + 1);
      const ref = {
        id: uid('b050', i + 1),
        displayName: s.name,
        clientNumber: 1001 + i,
        accountType: s.type,
      };
      const conns: BookkeepingConnection[] = s.sw
        ? [
            {
              id: uid('b200', i + 1),
              provider: s.sw,
              label: BOOKKEEPING_PROVIDERS[s.sw],
              providerCompanyId: `co-${1000 + i}`,
              companyName: s.name,
              status: s.status === 'OVERDUE' ? 'ERROR' : 'CONNECTED',
              syncStatus:
                s.status === 'OVERDUE'
                  ? 'ERROR'
                  : s.status === 'NEEDS_ATTENTION'
                    ? 'STALE'
                    : 'SYNCED',
              lastSyncAt: new Date(Date.now() - (i + 1) * 3_600_000 * 7).toISOString(),
              lastSuccessfulSyncAt: new Date(Date.now() - (i + 1) * 3_600_000 * 7).toISOString(),
              lastErrorCode: s.status === 'OVERDUE' ? 'EXPIRED_TOKEN' : null,
              connectedAt: '2025-01-15T10:00:00.000Z',
              disconnectedAt: null,
            },
          ]
        : [];
      const accounts: BookkeepingAccount[] = s.base
        ? [
            {
              id: uid('b300', i * 10 + 1),
              name: 'Business Checking',
              type: 'BANK',
              institution: 'Chase',
              mask: '4821',
              connectionId: conns[0]?.id ?? null,
              currency: 'USD',
              balanceCents: 1_245_032 + i * 10_000,
              balanceAsOf: nowIso(),
              status: conns[0] ? 'CONNECTED' : 'DISCONNECTED',
              reconcile: true,
              archived: false,
            },
            {
              id: uid('b300', i * 10 + 2),
              name: 'Business Credit Card',
              type: 'CREDIT_CARD',
              institution: 'Amex',
              mask: '1005',
              connectionId: conns[0]?.id ?? null,
              currency: 'USD',
              balanceCents: -234_012,
              balanceAsOf: nowIso(),
              status: conns[0] ? 'CONNECTED' : 'DISCONNECTED',
              reconcile: true,
              archived: false,
            },
          ]
        : [];
      const ws: Ws = {
        id: cid,
        client: { ...ref, email: `owner${i + 1}@example.test`, phone: `(555) 010-0${i + 1}00` },
        engagementId: uid('b400', i + 1),
        engagementStatus: 'ACTIVE',
        plan: s.plan,
        clientSince: '2024-01-15T10:00:00.000Z',
        assignedTo: i % 2 === 0 ? MAYA : SAM,
        reviewer: mockMe,
        status: s.status,
        statusSource: i === 1 ? 'MANUAL' : 'AUTOMATIC',
        statusReason: {
          ON_TRACK: null,
          NEEDS_ATTENTION: 'Sync is stale',
          MISSING_DOCUMENTS: '3 documents outstanding',
          OVERDUE: 'Sync failed Oct 12',
          NOT_STARTED: null,
        }[s.status],
        statusChangedAt: nowIso(),
        cadence: 'MONTHLY',
        cadenceMonths: null,
        closeTargetDay: settings.closeTargetDay,
        nextReportDueOn:
          s.status === 'NOT_STARTED'
            ? null
            : day(
                new Date(
                  Date.UTC(
                    new Date().getUTCFullYear(),
                    new Date().getUTCMonth(),
                    15 + (i % 2) * 15,
                  ),
                ),
              ),
        paused: false,
        pausedAt: null,
        pauseReason: null,
        archived: false,
        portalDefaults: { reports: true, tasks: true, documents: true, notes: false },
        alerts: {
          missingDocuments: true,
          staleSync: true,
          overdueClose: true,
          failedIntegration: true,
        },
        reportSchedule: null,
        documentChecklist: null,
        categorizationRules: i === 0 ? [{ match: 'AMAZON', category: 'Office supplies' }] : [],
        connections: conns,
        accounts,
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
        shared: {
          openTasks: 3 + (i % 3),
          overdueTasks: i % 3 === 2 ? 1 : 0,
          documents: 12 + i,
          outstandingDocumentRequests: s.status === 'MISSING_DOCUMENTS' ? 3 : 0,
          notes: 2,
        },
        recentActivity: [],
        _syncRuns: new Map(),
      };
      clients.push(ws);
      activities.set(cid, [
        {
          id: id('ba00'),
          kind: 'STATUS_CHANGE',
          summary: `Status set to ${s.status.replace('_', ' ').toLowerCase()}`,
          actor: MAYA,
          createdAt: nowIso(),
        },
        {
          id: id('ba00'),
          kind: 'DOCUMENT_REQUEST',
          summary: 'Requested August statements',
          actor: SAM,
          createdAt: new Date(Date.now() - 86_400_000 * 4).toISOString(),
        },
      ]);
      if (s.base === 0) return;
      for (let back = 7; back >= 0; back -= 1) {
        const { start, end } = monthOf(back);
        const closed = back >= 2 || (back === 1 && s.status === 'ON_TRACK');
        const pstatus: BookkeepingPeriod['status'] = closed
          ? 'CLOSED'
          : back === 1
            ? 'READY_FOR_REVIEW'
            : 'IN_PROGRESS';
        const wave = 1 + Math.sin((7 - back + i) / 1.7) * 0.12;
        const income = Math.round(s.base * wave) * 100;
        const expenses = Math.round(s.base * wave * (0.58 + (i % 3) * 0.05)) * 100;
        const items = settings.closeChecklist.map((c, k) => ({
          id: id('b500'),
          itemKey: c.key,
          label: c.label,
          required: c.required,
          position: k,
          completed:
            closed ||
            (pstatus === 'READY_FOR_REVIEW' &&
              c.key !== 'reviewer_approval' &&
              c.key !== 'client_delivery') ||
            (back === 0 && k < 4),
          completedAt: null,
          completedBy: null,
          note: null,
        }));
        const periodId = id('b600');
        const p: BookkeepingPeriod = {
          id: periodId,
          kind: 'MONTH',
          periodStart: day(start),
          periodEnd: day(end),
          label: labelOf(start),
          status: pstatus,
          closeByOn: day(
            new Date(
              Date.UTC(end.getUTCFullYear(), end.getUTCMonth() + 1, settings.closeTargetDay),
            ),
          ),
          closeVersion: 1,
          overdue: s.status === 'OVERDUE' && back === 1,
          incomeCents: income,
          expensesCents: expenses,
          netProfitCents: income - expenses,
          figuresSource: i % 2 ? 'IMPORTED' : 'MANUAL',
          figuresAsOf: nowIso(),
          uncategorizedCount: closed ? 0 : 12 - back,
          progress: { done: 0, total: 0, requiredDone: 0, requiredTotal: 0 },
          bookkeepingClientId: cid,
          client: {
            id: ref.id,
            displayName: ref.displayName,
            clientNumber: ref.clientNumber,
            accountType: ref.accountType,
          },
          readyForReviewAt: null,
          readyForReviewBy: null,
          approvedAt: null,
          approvedBy: null,
          closedAt: closed ? nowIso() : null,
          closedBy: closed ? mockMe : null,
          reopenedAt: null,
          reopenedBy: null,
          reopenReason: null,
          closeItems: items,
          reconciliations: [],
          accountsWithoutReconciliation: [],
          reports: [],
        };
        progressOf(p);
        for (const a of accounts) {
          const known = back < 4 || back === 0;
          if (known && back !== 0) {
            p.reconciliations.push(
              reconOf(
                periodId,
                a,
                day(start),
                day(end),
                100_000,
                150_000,
                closed ? 150_000 : 149_000,
                closed ? 'APPROVED' : 'IN_PROGRESS',
              ),
            );
          } else if (back === 0 || !known) {
            p.accountsWithoutReconciliation.push({ id: a.id, name: a.name });
          }
        }
        const due = day(new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() + 1, 15)));
        const sm = summaryOf(p);
        p.reports.push(
          reportRow(
            ws,
            'PROFIT_LOSS',
            sm,
            closed ? 'DELIVERED' : back === 1 ? 'IN_REVIEW' : 'IN_PROGRESS',
            due,
          ),
          reportRow(ws, 'BALANCE_SHEET', sm, closed ? 'DELIVERED' : 'NOT_STARTED', due),
        );
        periods.set(p.id, p);
      }
    });
    for (const c of clients) refreshWs(c);
  };

  /** Recomputes everything a workspace derives from its periods and reports. */
  function refreshWs(c: Ws) {
    const own = [...periods.values()]
      .filter((p) => p.bookkeepingClientId === c.id)
      .sort((a, b) => a.periodStart.localeCompare(b.periodStart));
    const open = [...own].reverse().find((p) => p.status !== 'CLOSED');
    const cur = open ?? own[own.length - 1];
    c.currentPeriod = cur ? summaryOf(cur) : null;
    c.kpis = {
      incomeCents: cur?.incomeCents ?? null,
      expensesCents: cur?.expensesCents ?? null,
      netProfitCents: cur?.netProfitCents ?? null,
      uncategorizedCount: cur?.uncategorizedCount ?? null,
    };
    const yr = String(new Date().getUTCFullYear());
    const withFig = own.filter(
      (p) =>
        p.kind === 'MONTH' &&
        p.periodStart.startsWith(yr) &&
        p.incomeCents !== null &&
        p.expensesCents !== null,
    );
    const inc = withFig.reduce((n, p) => n + (p.incomeCents ?? 0), 0);
    const exp = withFig.reduce((n, p) => n + (p.expensesCents ?? 0), 0);
    c.yearToDate = withFig.length
      ? {
          incomeCents: inc,
          expensesCents: exp,
          netProfitCents: inc - exp,
          expenseRatioPercent: inc ? Math.round((exp / inc) * 1000) / 10 : null,
        }
      : null;
    c.trend = own
      .filter((p) => p.kind === 'MONTH' && p.incomeCents !== null && p.expensesCents !== null)
      .slice(-12)
      .map((p) => ({
        label: p.label,
        month: p.periodStart.slice(0, 7),
        incomeCents: p.incomeCents ?? 0,
        expensesCents: p.expensesCents ?? 0,
      }));
    c.upcomingReports = [...reports.values()]
      .filter((r) => r.bookkeepingClientId === c.id && r.status !== 'DELIVERED')
      .sort((a, b) => (a.dueOn ?? '9').localeCompare(b.dueOn ?? '9'))
      .slice(0, 4);
    c.recentActivity = (activities.get(c.id) ?? []).slice(0, 6);
    const lastSync = c.connections[0]?.lastSuccessfulSyncAt;
    void lastSync;
  }

  if (!empty) seed();

  const log = (c: Ws, kind: BookkeepingActivity['kind'], summary: string) => {
    const list = activities.get(c.id) ?? [];
    list.unshift({ id: id('ba00'), kind, summary, actor: mockMe, createdAt: nowIso() });
    activities.set(c.id, list);
  };
  const findClient = (cid: string) => {
    const c = clients.find((x) => x.id === cid);
    if (!c) throw fail(404, 'NOT_FOUND', 'That bookkeeping client was not found.');
    return c;
  };
  const view = (c: Ws): BookkeepingClientWorkspace => {
    refreshWs(c);
    const { _syncRuns: _unused, ...rest } = c;
    void _unused;
    return rest;
  };
  const findPeriod = (pid: string) => {
    const p = periods.get(pid);
    if (!p) throw fail(404, 'NOT_FOUND', 'That period was not found.');
    return p;
  };
  const touchPeriod = (p: BookkeepingPeriod) => {
    progressOf(p);
    p.closeVersion += 1;
    const c = findClient(p.bookkeepingClientId);
    refreshWs(c);
    return p;
  };
  const locked = (p: BookkeepingPeriod) => {
    if (p.status === 'CLOSED')
      throw fail(409, 'PERIOD_LOCKED', 'This period is closed. Reopen it to change it.');
  };
  const findReport = (rid: string) => {
    const r = reports.get(rid);
    if (!r) throw fail(404, 'NOT_FOUND', 'That report was not found.');
    return r;
  };
  const syncStamp = (c: Ws) => {
    if (c.connections.length === 0)
      throw fail(409, 'NOT_CONNECTED', 'This client has no accounting software connected.');
    for (const k of c.connections) {
      if (k.status === 'DISCONNECTED') continue;
      k.lastSyncAt = nowIso();
      k.lastSuccessfulSyncAt = nowIso();
      k.syncStatus = 'SYNCED';
      k.status = 'CONNECTED';
      k.lastErrorCode = null;
      const runs = syncRuns.get(k.id) ?? [];
      runs.unshift({
        id: id('bb00'),
        trigger: 'MANUAL',
        outcome: 'SUCCESS',
        startedAt: nowIso(),
        finishedAt: nowIso(),
        errorCode: null,
        message: null,
        counts: { transactions: 42 },
        requestedBy: mockMe,
      });
      syncRuns.set(k.id, runs);
    }
    log(c, 'SYNC', 'Sync requested');
  };

  const rowOf = (c: Ws): BookkeepingClientRow => {
    const sw = c.connections.find((k) => k.status !== 'DISCONNECTED');
    return {
      id: c.id,
      client: {
        id: c.client.id,
        displayName: c.client.displayName,
        clientNumber: c.client.clientNumber,
        accountType: c.client.accountType,
      },
      engagementId: c.engagementId,
      plan: c.plan,
      assignedTo: c.assignedTo,
      software: sw ? { key: sw.provider, label: sw.label, status: sw.status } : null,
      status: c.status,
      statusSource: c.statusSource,
      statusReason: c.statusReason,
      cadence: c.cadence,
      syncStatus: sw?.syncStatus ?? 'NOT_CONNECTED',
      lastSyncedAt: sw?.lastSuccessfulSyncAt ?? null,
      nextReportDueOn: c.nextReportDueOn,
      paused: c.paused,
    };
  };
  const inUpcoming = (d: string | null) => {
    if (!d) return false;
    const t = day(new Date());
    return d >= t && d <= day(new Date(Date.now() + settings.upcomingReportDays * 86_400_000));
  };
  const pct = (cur: number, prev: number | null) =>
    prev && prev !== 0 ? Math.round(((cur - prev) / Math.abs(prev)) * 1000) / 10 : null;
  const range = (key: string): { from: string; to: string; pfrom: string; pto: string } => {
    const t = new Date();
    const y = t.getUTCFullYear();
    const m = t.getUTCMonth();
    const utc = (yy: number, mm: number, dd: number) => new Date(Date.UTC(yy, mm, dd));
    if (key === 'LAST_MONTH')
      return {
        from: day(utc(y, m - 1, 1)),
        to: day(utc(y, m, 0)),
        pfrom: day(utc(y, m - 2, 1)),
        pto: day(utc(y, m - 1, 0)),
      };
    if (key === 'THIS_QUARTER') {
      const q = Math.floor(m / 3) * 3;
      return {
        from: day(utc(y, q, 1)),
        to: day(utc(y, q + 3, 0)),
        pfrom: day(utc(y, q - 3, 1)),
        pto: day(utc(y, q, 0)),
      };
    }
    if (key === 'THIS_YEAR')
      return {
        from: day(utc(y, 0, 1)),
        to: day(utc(y, 12, 0)),
        pfrom: day(utc(y - 1, 0, 1)),
        pto: day(utc(y - 1, 12, 0)),
      };
    return {
      from: day(utc(y, m, 1)),
      to: day(utc(y, m + 1, 0)),
      pfrom: day(utc(y, m - 1, 1)),
      pto: day(utc(y, m, 0)),
    };
  };

  const api: BookkeepingClient = {
    overview: (q = {}) =>
      run((): BookkeepingOverview => {
        const query = parseInput(BookkeepingOverviewQuery, q);
        const r = range(query.period);
        const active = clients.filter((c) => !c.paused && !c.archived);
        const sum = (from: string, to: string) => {
          let income = 0;
          let expenses = 0;
          let n = 0;
          for (const c of active) {
            const ps = [...periods.values()].filter(
              (p) =>
                p.bookkeepingClientId === c.id &&
                p.kind === 'MONTH' &&
                p.periodStart >= from &&
                p.periodStart <= to &&
                p.incomeCents !== null &&
                p.expensesCents !== null,
            );
            if (ps.length) n += 1;
            for (const p of ps) {
              income += p.incomeCents ?? 0;
              expenses += p.expensesCents ?? 0;
            }
          }
          return { income, expenses, n };
        };
        const cur = sum(r.from, r.to);
        const prev = sum(r.pfrom, r.pto);
        const kpi = (value: number, previous: number | null) => ({
          value,
          previous,
          changePercent: pct(value, previous),
        });
        const upcoming = [...reports.values()].filter(
          (x) =>
            active.some((c) => c.id === x.bookkeepingClientId) &&
            x.status !== 'DELIVERED' &&
            inUpcoming(x.dueOn),
        );
        const counts = new Map<Status, number>();
        for (const c of clients.filter((x) => !x.archived))
          counts.set(c.status, (counts.get(c.status) ?? 0) + 1);
        const software = new Map<string | null, { label: string; n: number; ok: boolean }>();
        for (const c of clients.filter((x) => !x.archived)) {
          const k = c.connections.find((x) => x.status !== 'DISCONNECTED');
          const key = k?.provider ?? null;
          const e = software.get(key) ?? { label: k?.label ?? 'Not Connected', n: 0, ok: false };
          e.n += 1;
          e.ok = e.ok || k?.status === 'CONNECTED';
          software.set(key, e);
        }
        const year = r.to.slice(0, 4);
        const monthly = Array.from({ length: 12 }, (_, m) => {
          const key = `${year}-${String(m + 1).padStart(2, '0')}`;
          let inc = 0;
          let exp = 0;
          for (const p of periods.values())
            if (
              p.kind === 'MONTH' &&
              p.periodStart.startsWith(key) &&
              p.incomeCents !== null &&
              p.expensesCents !== null
            ) {
              inc += p.incomeCents;
              exp += p.expensesCents;
            }
          return { month: key, incomeCents: inc, expensesCents: exp };
        }).filter((m) => m.incomeCents + m.expensesCents > 0);
        return {
          period: { key: query.period, from: r.from, to: r.to },
          kpis: {
            activeClients: kpi(active.length, null),
            totalIncomeCents: kpi(cur.income, prev.n ? prev.income : null),
            totalExpensesCents: kpi(cur.expenses, prev.n ? prev.expenses : null),
            netProfitCents: kpi(
              cur.income - cur.expenses,
              prev.n ? prev.income - prev.expenses : null,
            ),
            clientsWithFigures: cur.n,
            clientsWithUpcomingReports: kpi(
              new Set(upcoming.map((x) => x.bookkeepingClientId)).size,
              null,
            ),
          },
          statusBreakdown: {
            total: [...counts.values()].reduce((a, b) => a + b, 0),
            items: [...counts].map(([status, count]) => ({ status, count })),
          },
          monthly,
          software: [...software].map(([key, v]) => ({
            key,
            label: v.label,
            clientCount: v.n,
            connected: v.ok,
          })),
          upcomingReports: upcoming
            .sort((a, b) => (a.dueOn ?? '').localeCompare(b.dueOn ?? ''))
            .slice(0, 8)
            .map((x) => ({
              reportId: x.id,
              bookkeepingClientId: x.bookkeepingClientId,
              clientName: x.client.displayName,
              reportType: x.reportType,
              reportName: x.name,
              periodLabel: x.periodLabel,
              dueOn: x.dueOn ?? r.to,
              status: x.status,
            })),
        };
      }),
    settings: () => run(() => settings),
    saveSettings: (body) =>
      run(() => {
        manage();
        const input = parseInput(SaveBookkeepingSettingsRequest, body);
        settings = { ...input, updatedAt: nowIso() };
        return settings;
      }),

    clients: (q = {}) =>
      run(() => {
        const query = parseInput(BookkeepingClientsQuery, q);
        const term = query.search?.toLowerCase();
        const base = clients
          .filter((c) => !c.archived)
          .filter(
            (c) =>
              (!term ||
                `${c.client.displayName} ${c.client.clientNumber}`.toLowerCase().includes(term)) &&
              (!query.clientType || c.client.accountType === query.clientType) &&
              (!query.plan || c.plan === query.plan) &&
              (!query.assignedUserId || c.assignedTo?.userId === query.assignedUserId) &&
              (!query.paused || String(c.paused) === query.paused) &&
              (!query.status || c.status === query.status),
          )
          .filter((c) => {
            if (!query.software) return true;
            const sw = c.connections.find((k) => k.status !== 'DISCONNECTED');
            return query.software === 'NOT_CONNECTED' ? !sw : sw?.provider === query.software;
          })
          .filter(
            (c) =>
              (!query.reportDueFrom || (c.nextReportDueOn ?? '') >= query.reportDueFrom) &&
              (!query.reportDueTo ||
                (!!c.nextReportDueOn && c.nextReportDueOn <= query.reportDueTo)),
          );
        const tabOf = (c: Ws, t: string) =>
          t === 'ALL' ? true : t === 'UPCOMING' ? inUpcoming(c.nextReportDueOn) : c.status === t;
        const tabCounts = Object.fromEntries(
          (
            [
              'ALL',
              'ON_TRACK',
              'NEEDS_ATTENTION',
              'MISSING_DOCUMENTS',
              'OVERDUE',
              'NOT_STARTED',
              'UPCOMING',
            ] as const
          ).map((t) => [t, base.filter((c) => tabOf(c, t)).length]),
        ) as Record<string, number>;
        const rows = base.filter((c) => tabOf(c, query.tab)).map(rowOf);
        const dir = query.direction === 'desc' ? -1 : 1;
        rows.sort((a, b) => {
          const key = {
            clientName: (r: BookkeepingClientRow) => r.client.displayName,
            plan: (r: BookkeepingClientRow) => r.plan ?? '',
            status: (r: BookkeepingClientRow) => r.status,
            nextReportDueOn: (r: BookkeepingClientRow) => r.nextReportDueOn ?? '9',
          }[query.sort];
          return key(a).localeCompare(key(b)) * dir;
        });
        return {
          items: rows.slice((query.page - 1) * query.pageSize, query.page * query.pageSize),
          total: rows.length,
          page: query.page,
          pageSize: query.pageSize,
          tabCounts,
        } as never;
      }),
    addClient: (body) =>
      run(() => {
        manage();
        const input = parseInput(AddBookkeepingClientRequest, body);
        if (clients.some((c) => c.client.id === input.clientId))
          throw fail(409, 'ALREADY_BOOKKEEPING_CLIENT', 'This client already has bookkeeping.');
        const i = clients.length;
        const ws = copy(clients[0] ?? ({} as Ws));
        const base: Ws = {
          ...ws,
          id: id('b100'),
          client: {
            id: input.clientId,
            displayName: `New Client ${i + 1}`,
            clientNumber: 2000 + i,
            accountType: 'BUSINESS',
            email: null,
            phone: null,
          },
          plan: input.plan ?? null,
          status: 'NOT_STARTED',
          statusReason: null,
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
          nextReportDueOn: null,
          cadence: input.cadence ?? 'MONTHLY',
          recentActivity: [],
        };
        clients.unshift(base);
        activities.set(base.id, []);
        return view(base);
      }),
    syncAll: () =>
      run(() => {
        manage();
        const withSw = clients.filter(
          (c) => !c.archived && c.connections.some((k) => k.status !== 'DISCONNECTED'),
        );
        withSw.forEach(syncStamp);
        return { queued: withSw.length, requestedAt: nowIso() };
      }),
    refreshStatuses: () =>
      run(() => {
        manage();
        const auto = clients.filter((c) => c.statusSource === 'AUTOMATIC');
        return { checked: auto.length, changed: 0 };
      }),
    getClient: (cid) => run(() => view(findClient(cid))),
    updateClient: (cid, body) =>
      run(() => {
        const input = parseInput(UpdateBookkeepingClientRequest, body);
        const managerOnly = [
          'cadence',
          'cadenceMonths',
          'closeTargetDay',
          'reviewerUserId',
          'nextReportDueOn',
          'reportSchedule',
          'documentChecklist',
        ];
        if (Object.keys(input).some((k) => managerOnly.includes(k))) manage();
        const c = findClient(cid);
        if (input.cadence) c.cadence = input.cadence;
        if (input.cadenceMonths !== undefined) c.cadenceMonths = input.cadenceMonths;
        if (input.closeTargetDay !== undefined)
          c.closeTargetDay = input.closeTargetDay ?? settings.closeTargetDay;
        if (input.reviewerUserId !== undefined) c.reviewer = input.reviewerUserId ? mockMe : null;
        if (input.nextReportDueOn !== undefined) c.nextReportDueOn = input.nextReportDueOn;
        if (input.reportSchedule !== undefined) c.reportSchedule = input.reportSchedule;
        if (input.documentChecklist !== undefined) c.documentChecklist = input.documentChecklist;
        if (input.portalDefaults)
          c.portalDefaults = { ...c.portalDefaults, ...input.portalDefaults };
        if (input.alerts) c.alerts = { ...c.alerts, ...input.alerts };
        if (input.categorizationRules) c.categorizationRules = input.categorizationRules;
        return view(c);
      }),
    setStatus: (cid, body) =>
      run(() => {
        const input = parseInput(BookkeepingStatusRequest, body);
        const c = findClient(cid);
        if (input.status === 'AUTOMATIC') {
          c.statusSource = 'AUTOMATIC';
        } else {
          c.status = input.status;
          c.statusSource = 'MANUAL';
          c.statusReason = input.reason ?? null;
        }
        c.statusChangedAt = nowIso();
        log(
          c,
          'STATUS_CHANGE',
          `Status ${input.status === 'AUTOMATIC' ? 'handed back to the rules' : `set to ${input.status.toLowerCase().replace('_', ' ')}`}`,
        );
        return view(c);
      }),
    pause: (cid, body) =>
      run(() => {
        manage();
        const input = parseInput(BookkeepingPauseRequest, body);
        const c = findClient(cid);
        if (c.paused) throw fail(409, 'CLIENT_STATE', 'This client is already paused.');
        c.paused = true;
        c.pausedAt = nowIso();
        c.pauseReason = input.reason;
        log(c, 'PAUSE', 'Bookkeeping paused');
        return view(c);
      }),
    resume: (cid) =>
      run(() => {
        manage();
        const c = findClient(cid);
        if (!c.paused) throw fail(409, 'CLIENT_STATE', 'This client is not paused.');
        c.paused = false;
        c.pausedAt = null;
        c.pauseReason = null;
        log(c, 'RESUME', 'Bookkeeping resumed');
        return view(c);
      }),
    archive: (cid, body = {}) =>
      run(() => {
        manage();
        parseInput(BookkeepingReasonRequest, body);
        const c = findClient(cid);
        c.archived = true;
        log(c, 'ARCHIVE', 'Bookkeeping client archived');
        return view(c);
      }),
    assign: (cid, body) =>
      run(() => {
        manage();
        const input = parseInput(BookkeepingAssignRequest, body);
        const c = findClient(cid);
        c.assignedTo =
          input.assignedUserId === null
            ? null
            : input.assignedUserId === SAM.userId
              ? SAM
              : input.assignedUserId === MAYA.userId
                ? MAYA
                : mockMe;
        log(c, 'ASSIGNMENT', `Assigned to ${c.assignedTo?.name ?? 'no one'}`);
        return view(c);
      }),
    sync: (cid) =>
      run(() => {
        const c = findClient(cid);
        syncStamp(c);
        return { queued: c.connections.length, requestedAt: nowIso() };
      }),
    activities: (cid, q = {}) =>
      run(() => {
        const query = parseInput(BookkeepingListQuery, q);
        findClient(cid);
        const all = activities.get(cid) ?? [];
        return {
          items: all.slice((query.page - 1) * query.pageSize, query.page * query.pageSize),
          total: all.length,
          page: query.page,
          pageSize: query.pageSize,
        };
      }),
    logActivity: (cid, body) =>
      run(() => {
        const input = parseInput(LogBookkeepingActivityRequest, body);
        const c = findClient(cid);
        log(c, input.kind, input.summary);
        return (activities.get(cid) ?? [])[0]!;
      }),

    connections: (cid) => run(() => ({ items: findClient(cid).connections })),
    connect: (cid, body) =>
      run(() => {
        manage();
        const input = parseInput(ConnectBookkeepingRequest, body);
        const c = findClient(cid);
        if (c.connections.some((k) => k.provider === input.provider && k.status !== 'DISCONNECTED'))
          throw fail(
            409,
            'CONNECTION_EXISTS',
            'This client is already connected to that software.',
          );
        if (
          clients.some((o) =>
            o.connections.some(
              (k) =>
                k.providerCompanyId === input.providerCompany &&
                k.provider === input.provider &&
                k.status !== 'DISCONNECTED',
            ),
          )
        )
          throw fail(
            409,
            'COMPANY_ALREADY_CONNECTED',
            'That company is connected to another client.',
          );
        const k: BookkeepingConnection = {
          id: id('b200'),
          provider: input.provider,
          label:
            (BOOKKEEPING_PROVIDERS as Record<string, string>)[input.provider] ?? input.provider,
          providerCompanyId: input.providerCompany,
          companyName: input.companyName ?? null,
          status: 'CONNECTED',
          syncStatus: 'NEVER',
          lastSyncAt: null,
          lastSuccessfulSyncAt: null,
          lastErrorCode: null,
          connectedAt: nowIso(),
          disconnectedAt: null,
        };
        c.connections.push(k);
        log(c, 'SYNC', `Connected to ${k.label}`);
        return k;
      }),
    updateConnection: (kid, body) =>
      run(() => {
        const input = parseInput(UpdateBookkeepingConnectionRequest, body);
        const k = clients.flatMap((c) => c.connections).find((x) => x.id === kid);
        if (!k) throw fail(404, 'NOT_FOUND', 'That connection was not found.');
        if (input.companyName !== undefined) k.companyName = input.companyName;
        return k;
      }),
    disconnect: (kid) =>
      run(() => {
        manage();
        const k = clients.flatMap((c) => c.connections).find((x) => x.id === kid);
        if (!k) throw fail(404, 'NOT_FOUND', 'That connection was not found.');
        k.status = 'DISCONNECTED';
        k.syncStatus = 'NOT_CONNECTED';
        k.disconnectedAt = nowIso();
        return k;
      }),
    reconnect: (kid) =>
      run(() => {
        manage();
        const k = clients.flatMap((c) => c.connections).find((x) => x.id === kid);
        if (!k) throw fail(404, 'NOT_FOUND', 'That connection was not found.');
        k.status = 'CONNECTED';
        k.syncStatus = 'NEVER';
        k.disconnectedAt = null;
        k.lastErrorCode = null;
        return k;
      }),
    syncRuns: (kid, q = {}) =>
      run(() => {
        const query = parseInput(BookkeepingListQuery, q);
        const all = syncRuns.get(kid) ?? [];
        return {
          items: all.slice((query.page - 1) * query.pageSize, query.page * query.pageSize),
          total: all.length,
          page: query.page,
          pageSize: query.pageSize,
        };
      }),

    accounts: (cid) => run(() => ({ items: findClient(cid).accounts })),
    addAccount: (cid, body) =>
      run(() => {
        const input = parseInput(AddBookkeepingAccountRequest, body);
        const c = findClient(cid);
        if (
          c.accounts.some((a) => !a.archived && a.name.toLowerCase() === input.name.toLowerCase())
        )
          throw fail(409, 'DUPLICATE', 'An account with this name already exists.');
        const a: BookkeepingAccount = {
          id: id('b300'),
          name: input.name,
          type: input.type,
          institution: input.institution ?? null,
          mask: input.mask ?? null,
          connectionId: null,
          currency: 'USD',
          balanceCents: input.balanceCents ?? null,
          balanceAsOf: input.balanceAsOf ?? null,
          status: 'DISCONNECTED',
          reconcile: input.reconcile,
          archived: false,
        };
        c.accounts.push(a);
        return a;
      }),
    updateAccount: (aid, body) =>
      run(() => {
        const input = parseInput(UpdateBookkeepingAccountRequest, body);
        const a = clients.flatMap((c) => c.accounts).find((x) => x.id === aid);
        if (!a) throw fail(404, 'NOT_FOUND', 'That account was not found.');
        if (input.name !== undefined) a.name = input.name;
        if (input.institution !== undefined) a.institution = input.institution;
        if (input.mask !== undefined) a.mask = input.mask;
        if (input.balanceCents !== undefined) a.balanceCents = input.balanceCents;
        if (input.balanceAsOf !== undefined) a.balanceAsOf = input.balanceAsOf;
        if (input.reconcile !== undefined) a.reconcile = input.reconcile;
        if (input.archived !== undefined) a.archived = input.archived;
        return a;
      }),

    periods: (cid, q = {}) =>
      run(() => {
        const query = parseInput(BookkeepingPeriodsQuery, q);
        findClient(cid);
        const all = [...periods.values()]
          .filter(
            (p) =>
              p.bookkeepingClientId === cid &&
              (!query.status || p.status === query.status) &&
              (!query.year || p.periodStart.startsWith(String(query.year))),
          )
          .sort((a, b) => b.periodStart.localeCompare(a.periodStart))
          .map(summaryOf);
        return {
          items: all.slice((query.page - 1) * query.pageSize, query.page * query.pageSize),
          total: all.length,
          page: query.page,
          pageSize: query.pageSize,
        };
      }),
    createPeriod: (cid, body) =>
      run(() => {
        const input = parseInput(CreateBookkeepingPeriodRequest, body);
        const c = findClient(cid);
        if (
          [...periods.values()].some(
            (p) =>
              p.bookkeepingClientId === cid &&
              p.periodStart === input.periodStart &&
              p.periodEnd === input.periodEnd,
          )
        )
          throw fail(409, 'DUPLICATE', 'This period already exists.');
        const start = new Date(`${input.periodStart}T00:00:00Z`);
        const p: BookkeepingPeriod = {
          id: id('b600'),
          kind: input.kind,
          periodStart: input.periodStart,
          periodEnd: input.periodEnd,
          label: input.label ?? labelOf(start),
          status: 'NOT_STARTED',
          closeByOn: input.closeByOn ?? null,
          closeVersion: 1,
          overdue: false,
          incomeCents: null,
          expensesCents: null,
          netProfitCents: null,
          figuresSource: null,
          figuresAsOf: null,
          uncategorizedCount: null,
          progress: { done: 0, total: 0, requiredDone: 0, requiredTotal: 0 },
          bookkeepingClientId: cid,
          client: {
            id: c.client.id,
            displayName: c.client.displayName,
            clientNumber: c.client.clientNumber,
            accountType: c.client.accountType,
          },
          readyForReviewAt: null,
          readyForReviewBy: null,
          approvedAt: null,
          approvedBy: null,
          closedAt: null,
          closedBy: null,
          reopenedAt: null,
          reopenedBy: null,
          reopenReason: null,
          closeItems: settings.closeChecklist.map((k, n) => ({
            id: id('b500'),
            itemKey: k.key,
            label: k.label,
            required: k.required,
            position: n,
            completed: false,
            completedAt: null,
            completedBy: null,
            note: null,
          })),
          reconciliations: [],
          accountsWithoutReconciliation: c.accounts
            .filter((a) => a.reconcile && !a.archived)
            .map((a) => ({ id: a.id, name: a.name })),
          reports: [],
        };
        progressOf(p);
        periods.set(p.id, p);
        refreshWs(c);
        return p;
      }),
    getPeriod: (pid) => run(() => findPeriod(pid)),
    updatePeriod: (pid, body) =>
      run(() => {
        const input = parseInput(UpdateBookkeepingPeriodRequest, body);
        const p = findPeriod(pid);
        locked(p);
        if (input.closeByOn !== undefined) p.closeByOn = input.closeByOn;
        if (input.incomeCents !== undefined || input.expensesCents !== undefined) {
          const inc = input.incomeCents === undefined ? p.incomeCents : input.incomeCents;
          const exp = input.expensesCents === undefined ? p.expensesCents : input.expensesCents;
          p.incomeCents = inc;
          p.expensesCents = exp;
          p.netProfitCents = inc !== null && exp !== null ? inc - exp : null;
          p.figuresSource = inc === null ? null : 'MANUAL';
          p.figuresAsOf = inc === null ? null : nowIso();
        }
        if (input.uncategorizedCount !== undefined) p.uncategorizedCount = input.uncategorizedCount;
        return touchPeriod(p);
      }),
    startPeriod: (pid) =>
      run(() => {
        const p = findPeriod(pid);
        if (p.status !== 'NOT_STARTED')
          throw fail(409, 'PERIOD_STATE', 'Only a period that has not started can be started.');
        p.status = 'IN_PROGRESS';
        return touchPeriod(p);
      }),
    markPeriodReady: (pid) =>
      run(() => {
        const p = findPeriod(pid);
        if (p.status !== 'IN_PROGRESS')
          throw fail(409, 'PERIOD_STATE', 'Only a period in progress can go for review.');
        if (
          p.closeItems.some((i) => i.required && !i.completed && i.itemKey !== 'reviewer_approval')
        )
          throw fail(409, 'CLOSE_ITEMS_OPEN', 'Finish the required checklist steps first.');
        p.status = 'READY_FOR_REVIEW';
        p.readyForReviewAt = nowIso();
        p.readyForReviewBy = mockMe;
        return touchPeriod(p);
      }),
    sendPeriodBack: (pid) =>
      run(() => {
        manage();
        const p = findPeriod(pid);
        if (p.status !== 'READY_FOR_REVIEW' && p.status !== 'APPROVED')
          throw fail(409, 'PERIOD_STATE', 'Only a period in review can be sent back.');
        p.status = 'IN_PROGRESS';
        return touchPeriod(p);
      }),
    approvePeriod: (pid) =>
      run(() => {
        manage();
        const p = findPeriod(pid);
        if (p.status !== 'READY_FOR_REVIEW')
          throw fail(409, 'PERIOD_STATE', 'Only a period in review can be approved.');
        if (p.reconciliations.some((r) => r.status !== 'APPROVED'))
          throw fail(409, 'RECON_STATE', 'Approve every reconciliation first.');
        p.status = 'APPROVED';
        p.approvedAt = nowIso();
        p.approvedBy = mockMe;
        const item = p.closeItems.find((i) => i.itemKey === 'reviewer_approval');
        if (item) item.completed = true;
        return touchPeriod(p);
      }),
    closePeriod: (pid) =>
      run(() => {
        manage();
        const p = findPeriod(pid);
        if (p.status !== 'APPROVED')
          throw fail(409, 'PERIOD_STATE', 'Approve the period before closing it.');
        if (p.closeItems.some((i) => i.required && !i.completed))
          throw fail(409, 'CLOSE_ITEMS_OPEN', 'Finish the required checklist steps first.');
        p.status = 'CLOSED';
        p.closedAt = nowIso();
        p.closedBy = mockMe;
        return touchPeriod(p);
      }),
    reopenPeriod: (pid, body) =>
      run(() => {
        manage();
        const input = parseInput(BookkeepingReopenRequest, body);
        const p = findPeriod(pid);
        if (p.status !== 'CLOSED' && p.status !== 'APPROVED')
          throw fail(409, 'PERIOD_STATE', 'Only an approved or closed period can be reopened.');
        p.status = 'IN_PROGRESS';
        p.closedAt = null;
        p.closedBy = null;
        p.approvedAt = null;
        p.approvedBy = null;
        p.reopenedAt = nowIso();
        p.reopenedBy = mockMe;
        p.reopenReason = input.reason;
        return touchPeriod(p);
      }),
    updateCloseItem: (pid, itemId, body) =>
      run(() => {
        const input = parseInput(UpdateBookkeepingCloseItemRequest, body);
        const p = findPeriod(pid);
        locked(p);
        const item = p.closeItems.find((i) => i.id === itemId);
        if (!item) throw fail(404, 'NOT_FOUND', 'That checklist step was not found.');
        if (input.completed !== undefined) {
          item.completed = input.completed;
          item.completedAt = input.completed ? nowIso() : null;
          item.completedBy = input.completed ? mockMe : null;
        }
        if (input.note !== undefined) item.note = input.note;
        return touchPeriod(p);
      }),

    reconciliations: (pid) => run(() => ({ items: findPeriod(pid).reconciliations })),
    createReconciliation: (pid, body) =>
      run(() => {
        const input = parseInput(CreateBookkeepingReconciliationRequest, body);
        const p = findPeriod(pid);
        locked(p);
        const c = findClient(p.bookkeepingClientId);
        const a = c.accounts.find((x) => x.id === input.accountId);
        if (!a) throw fail(404, 'NOT_FOUND', 'That account was not found.');
        if (p.reconciliations.some((r) => r.account.id === a.id && r.status !== 'REOPENED'))
          throw fail(409, 'DUPLICATE', 'This account already has a reconciliation in this period.');
        const r = reconOf(
          pid,
          a,
          input.statementStart,
          input.statementEnd,
          input.beginningBalanceCents,
          input.endingBalanceCents,
          input.clearedBalanceCents ?? input.beginningBalanceCents,
          'IN_PROGRESS',
        );
        r.clearedCount = input.clearedCount ?? 0;
        r.exceptionsCount = input.exceptionsCount ?? 0;
        p.reconciliations.push(r);
        p.accountsWithoutReconciliation = p.accountsWithoutReconciliation.filter(
          (x) => x.id !== a.id,
        );
        touchPeriod(p);
        return r;
      }),
    getReconciliation: (rid) =>
      run(() => {
        const r = [...periods.values()].flatMap((p) => p.reconciliations).find((x) => x.id === rid);
        if (!r) throw fail(404, 'NOT_FOUND', 'That reconciliation was not found.');
        return r;
      }),
    saveReconciliation: (rid, body) =>
      run(() => {
        const input = parseInput(UpdateBookkeepingReconciliationRequest, body);
        const p = [...periods.values()].find((x) => x.reconciliations.some((r) => r.id === rid));
        const r = p?.reconciliations.find((x) => x.id === rid);
        if (!p || !r) throw fail(404, 'NOT_FOUND', 'That reconciliation was not found.');
        locked(p);
        if (r.status === 'APPROVED' || r.status === 'READY_FOR_REVIEW')
          throw fail(409, 'RECON_STATE', 'Reopen this reconciliation to change it.');
        if (input.statementStart) r.statementStart = input.statementStart;
        if (input.statementEnd) r.statementEnd = input.statementEnd;
        if (input.beginningBalanceCents !== undefined)
          r.beginningBalanceCents = input.beginningBalanceCents;
        if (input.endingBalanceCents !== undefined) r.endingBalanceCents = input.endingBalanceCents;
        if (input.clearedBalanceCents !== undefined)
          r.clearedBalanceCents = input.clearedBalanceCents;
        if (input.clearedCount !== undefined) r.clearedCount = input.clearedCount;
        if (input.exceptionsCount !== undefined) r.exceptionsCount = input.exceptionsCount;
        r.differenceCents = r.endingBalanceCents - r.clearedBalanceCents;
        r.withinTolerance = Math.abs(r.differenceCents) <= r.toleranceCents;
        r.updatedAt = nowIso();
        return r;
      }),
    markReconciliationReady: (rid) =>
      run(() => {
        const r = [...periods.values()].flatMap((p) => p.reconciliations).find((x) => x.id === rid);
        if (!r) throw fail(404, 'NOT_FOUND', 'That reconciliation was not found.');
        if (r.status !== 'IN_PROGRESS' && r.status !== 'REOPENED')
          throw fail(409, 'RECON_STATE', 'Only a reconciliation in progress can go for review.');
        r.status = 'READY_FOR_REVIEW';
        r.readyForReviewAt = nowIso();
        return r;
      }),
    approveReconciliation: (rid) =>
      run(() => {
        manage();
        const r = [...periods.values()].flatMap((p) => p.reconciliations).find((x) => x.id === rid);
        if (!r) throw fail(404, 'NOT_FOUND', 'That reconciliation was not found.');
        if (r.status !== 'READY_FOR_REVIEW')
          throw fail(409, 'RECON_STATE', 'Only a reconciliation in review can be approved.');
        if (!r.withinTolerance)
          throw fail(409, 'RECON_DIFFERENCE', 'The difference is outside the tolerance.');
        r.status = 'APPROVED';
        r.approvedAt = nowIso();
        r.approvedBy = mockMe;
        return r;
      }),
    reopenReconciliation: (rid, body) =>
      run(() => {
        manage();
        const input = parseInput(BookkeepingReopenRequest, body);
        const p = [...periods.values()].find((x) => x.reconciliations.some((r) => r.id === rid));
        const r = p?.reconciliations.find((x) => x.id === rid);
        if (!p || !r) throw fail(404, 'NOT_FOUND', 'That reconciliation was not found.');
        locked(p);
        if (r.status !== 'APPROVED')
          throw fail(409, 'RECON_STATE', 'Only an approved reconciliation can be reopened.');
        r.status = 'REOPENED';
        r.reopenedAt = nowIso();
        r.reopenReason = input.reason;
        r.approvedAt = null;
        r.approvedBy = null;
        return r;
      }),

    reports: (q = {}) =>
      run(() => {
        const query = parseInput(BookkeepingReportsQuery, q);
        const term = query.search?.toLowerCase();
        const all = [...reports.values()]
          .filter(
            (r) =>
              (!query.status || r.status === query.status) &&
              (!query.reportType || r.reportType === query.reportType) &&
              (!query.bookkeepingClientId || r.bookkeepingClientId === query.bookkeepingClientId) &&
              (!query.periodId || r.periodId === query.periodId) &&
              (!query.dueFrom || (r.dueOn ?? '') >= query.dueFrom) &&
              (!query.dueTo || (!!r.dueOn && r.dueOn <= query.dueTo)) &&
              (query.upcoming !== 'true' || (r.status !== 'DELIVERED' && inUpcoming(r.dueOn))) &&
              (query.overdue !== 'true' || r.overdue) &&
              (!term || `${r.name} ${r.client.displayName}`.toLowerCase().includes(term)),
          )
          .sort((a, b) => (a.dueOn ?? '9').localeCompare(b.dueOn ?? '9'));
        return {
          items: all.slice((query.page - 1) * query.pageSize, query.page * query.pageSize),
          total: all.length,
          page: query.page,
          pageSize: query.pageSize,
        };
      }),
    clientReports: (cid, q = {}) =>
      run(() => {
        const query = parseInput(BookkeepingReportsQuery, q);
        findClient(cid);
        const all = [...reports.values()]
          .filter(
            (r) => r.bookkeepingClientId === cid && (!query.status || r.status === query.status),
          )
          .sort((a, b) => (b.dueOn ?? '').localeCompare(a.dueOn ?? ''));
        return {
          items: all.slice((query.page - 1) * query.pageSize, query.page * query.pageSize),
          total: all.length,
          page: query.page,
          pageSize: query.pageSize,
        };
      }),
    addReport: (cid, body) =>
      run(() => {
        const input = parseInput(AddBookkeepingReportRequest, body);
        const c = findClient(cid);
        const r = reportRow(c, input.reportType, null, 'NOT_STARTED', input.dueOn ?? null);
        r.periodLabel = input.periodLabel;
        r.periodId = input.periodId ?? null;
        r.basis = input.basis ?? null;
        r.customName = input.customName ?? null;
        if (input.customName) r.name = input.customName;
        return r;
      }),
    getReport: (rid) => run(() => findReport(rid)),
    updateReport: (rid, body) =>
      run(() => {
        const input = parseInput(UpdateBookkeepingReportRequest, body);
        const r = findReport(rid);
        if (r.status === 'DELIVERED')
          throw fail(409, 'REPORT_STATE', 'A delivered report cannot be changed.');
        if (input.dueOn !== undefined) r.dueOn = input.dueOn;
        if (input.basis !== undefined) r.basis = input.basis;
        if (input.reviewNote !== undefined) r.reviewNote = input.reviewNote;
        return r;
      }),
    startReport: (rid) =>
      run(() => {
        const r = findReport(rid);
        if (r.status !== 'NOT_STARTED')
          throw fail(409, 'REPORT_STATE', 'This report has already started.');
        r.status = 'IN_PROGRESS';
        r.generatedAt = nowIso();
        r.generatedBy = mockMe;
        return r;
      }),
    submitReport: (rid) =>
      run(() => {
        const r = findReport(rid);
        if (r.status !== 'IN_PROGRESS')
          throw fail(409, 'REPORT_STATE', 'Only a report in progress can go for review.');
        r.status = 'IN_REVIEW';
        return r;
      }),
    sendReportBack: (rid, body = {}) =>
      run(() => {
        manage();
        const input = parseInput(BookkeepingSendBackRequest, body);
        const r = findReport(rid);
        if (r.status !== 'IN_REVIEW' && r.status !== 'APPROVED')
          throw fail(409, 'REPORT_STATE', 'Only a report in review can be sent back.');
        r.status = 'IN_PROGRESS';
        r.reviewNote = input.note ?? null;
        return r;
      }),
    approveReport: (rid) =>
      run(() => {
        manage();
        const r = findReport(rid);
        if (r.status !== 'IN_REVIEW')
          throw fail(409, 'REPORT_STATE', 'Only a report in review can be approved.');
        r.status = 'APPROVED';
        r.reviewedAt = nowIso();
        r.reviewedBy = mockMe;
        return r;
      }),
    deliverReport: (rid, body) =>
      run(() => {
        manage();
        const input = parseInput(DeliverBookkeepingReportRequest, body);
        const r = findReport(rid);
        if (r.status !== 'APPROVED')
          throw fail(409, 'REPORT_STATE', 'Approve the report before delivering it.');
        r.status = 'DELIVERED';
        r.deliveredAt = nowIso();
        r.deliveredBy = mockMe;
        r.engagementReportId = input.engagementReportId;
        r.overdue = false;
        return r;
      }),
  };
  return api;
}
