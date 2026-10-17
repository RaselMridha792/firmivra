import { ConflictException, ForbiddenException, BadRequestException } from '@nestjs/common';
import type { Database, TxClient } from '@firmivra/db';
import {
  BOOKKEEPING_PROVIDERS,
  type BookkeepingAlerts,
  type BookkeepingErrorCode,
  type BookkeepingOverviewPeriod,
  type BookkeepingPeriodKind,
  type BookkeepingReportType,
  type BookkeepingStatus,
  type BookkeepingSyncStatus,
  type ReportCadence,
  type StatusRules,
} from '@firmivra/types';
import { notFound } from '../workspaces/common.js';

export { day, notFound, toDay } from '../workspaces/common.js';

const conflict = (code: BookkeepingErrorCode, message: string) =>
  new ConflictException({ code, message });

/** The errors of the bookkeeping routes (codes in packages/types/src/bookkeeping). */
export const errors = {
  notFound,
  forbidden: () =>
    new ForbiddenException({ code: 'FORBIDDEN', message: 'This action is not permitted' }),
  alreadyBookkeepingClient: () =>
    conflict('ALREADY_BOOKKEEPING_CLIENT', 'This client is already a bookkeeping client'),
  noBookkeepingService: () =>
    conflict(
      'NO_BOOKKEEPING_SERVICE',
      'Add an active Bookkeeping service to Services & Pricing before adding bookkeeping clients',
    ),
  clientState: (message: string) => conflict('CLIENT_STATE', message),
  notConnected: () =>
    conflict('NOT_CONNECTED', 'Connect accounting software for this client first'),
  connectionExists: () =>
    conflict('CONNECTION_EXISTS', 'This client already has a connection to this provider'),
  companyConnected: () =>
    conflict('COMPANY_ALREADY_CONNECTED', 'This provider company is already connected to a client'),
  periodState: (message: string) => conflict('PERIOD_STATE', message),
  periodLocked: () => conflict('PERIOD_LOCKED', 'The period is closed and locked. Reopen it first'),
  closeItemsOpen: () =>
    conflict('CLOSE_ITEMS_OPEN', 'Complete the required close steps before closing the period'),
  reconState: (message: string) => conflict('RECON_STATE', message),
  reconDifference: () =>
    conflict('RECON_DIFFERENCE', 'The difference is outside the tolerance. Resolve it first'),
  reportState: (message: string) => conflict('REPORT_STATE', message),
  reportNotPublished: () =>
    conflict(
      'REPORT_NOT_PUBLISHED',
      'Publish the report for the client before marking it delivered',
    ),
  notThisClients: (what: string) =>
    conflict('NOT_THIS_CLIENTS', `The ${what} does not belong to this bookkeeping client`),
  duplicate: (message: string) => conflict('DUPLICATE', message),
  /** A request that passed the contract but cannot be stored. */
  invalid: (path: string, message: string) =>
    new BadRequestException({
      code: 'VALIDATION_FAILED',
      message: 'The request is not valid',
      details: [{ path, message }],
    }),
};

/** One transaction in the firm's scope. */
export const inFirm = <T>(
  database: Database,
  businessId: string,
  fn: (tx: TxClient) => Promise<T>,
): Promise<T> => database.withScope({ kind: 'business', businessId }, fn);

/** The text of the bookkeeping rule the database raised (it starts "bookkeeping:" or "bookkeeping reports:"). */
export function bookkeepingDbMessage(error: unknown): string | undefined {
  if (!error || typeof error !== 'object') return undefined;
  const text = [
    (error as { message?: unknown }).message,
    JSON.stringify((error as { meta?: unknown }).meta ?? ''),
  ]
    .filter((p): p is string => typeof p === 'string')
    .join(' ');
  return /bookkeeping(?: reports)?: [^"\\\n]+/.exec(text)?.[0]?.trimEnd();
}

/** Turns the database's named bookkeeping rules into the contract's 409s; anything else is rethrown. */
export function mapBookkeepingDbError(error: unknown): never {
  const rule = bookkeepingDbMessage(error);
  if (!rule) throw error;
  if (/closed period is locked|period is closed and locked/.test(rule)) throw errors.periodLocked();
  if (/complete the required close steps/.test(rule)) throw errors.closeItemsOpen();
  if (/publish the report before delivering/.test(rule)) throw errors.reportNotPublished();
  if (
    /must be (?:the|one of the) same client|stays with its client|must be the period's client|must be a document of the same client/.test(
      rule,
    )
  ) {
    throw errors.notThisClients('record');
  }
  if (/period cannot become|reopening a period/.test(rule)) {
    throw errors.periodState('The period is not in a state that allows this');
  }
  if (/report cannot become|delivered report is frozen/.test(rule)) {
    throw errors.reportState('The report is not in a state that allows this');
  }
  throw error;
}

// ---------- Providers and sync ----------

export const providerLabel = (key: string | null): string =>
  key === null
    ? 'Not connected'
    : ((BOOKKEEPING_PROVIDERS as Record<string, string | undefined>)[key] ?? key);

/** The sync status the list and the workspace show, from the connection and its last good sync. */
export function syncStatusOf(
  connection: { status: string; lastSuccessfulSyncAt: Date | null } | null,
  staleAfterHours: number,
  now: Date,
): BookkeepingSyncStatus {
  if (!connection || connection.status === 'DISCONNECTED') return 'NOT_CONNECTED';
  if (connection.status === 'ERROR' || connection.status === 'EXPIRED') return 'ERROR';
  if (!connection.lastSuccessfulSyncAt) return 'NEVER';
  return now.getTime() - connection.lastSuccessfulSyncAt.getTime() > staleAfterHours * 3_600_000
    ? 'STALE'
    : 'SYNCED';
}

// ---------- Dates ----------

export const isoDay = (d: Date) => d.toISOString().slice(0, 10);
const utc = (y: number, m: number, d: number) => new Date(Date.UTC(y, m, d));
export const addDays = (d: Date, n: number) =>
  utc(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + n);

export interface PeriodRange {
  from: string;
  to: string;
  previousFrom: string;
  previousTo: string;
}

/** The overview's period and the period before it, as inclusive calendar days (UTC). */
export function periodRange(key: BookkeepingOverviewPeriod, today: Date): PeriodRange {
  const y = today.getUTCFullYear();
  const m = today.getUTCMonth();
  const span = (from: Date, to: Date, pFrom: Date, pTo: Date): PeriodRange => ({
    from: isoDay(from),
    to: isoDay(to),
    previousFrom: isoDay(pFrom),
    previousTo: isoDay(pTo),
  });
  switch (key) {
    case 'THIS_MONTH':
      return span(utc(y, m, 1), utc(y, m + 1, 0), utc(y, m - 1, 1), utc(y, m, 0));
    case 'LAST_MONTH':
      return span(utc(y, m - 1, 1), utc(y, m, 0), utc(y, m - 2, 1), utc(y, m - 1, 0));
    case 'THIS_QUARTER': {
      const q = Math.floor(m / 3) * 3;
      return span(utc(y, q, 1), utc(y, q + 3, 0), utc(y, q - 3, 1), utc(y, q, 0));
    }
    case 'THIS_YEAR':
      return span(utc(y, 0, 1), utc(y, 11, 31), utc(y - 1, 0, 1), utc(y - 1, 11, 31));
  }
}

/** Percentage change to one decimal, or null when there is nothing to compare against. */
export function changePercent(value: number, previous: number | null): number | null {
  if (previous === null || previous === 0) return null;
  return Math.round(((value - previous) / Math.abs(previous)) * 1000) / 10;
}

/** Share of a total to one decimal; null when the total is zero. */
export const sharePercent = (part: number, total: number): number | null =>
  total === 0 ? null : Math.round((part / total) * 1000) / 10;

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

/** The name a period gets from its dates: "September 2026", "Q3 2026", "2026". */
export function periodLabel(
  kind: BookkeepingPeriodKind,
  start: string,
  end: string,
): string | null {
  const s = new Date(`${start}T00:00:00.000Z`);
  const e = new Date(`${end}T00:00:00.000Z`);
  const y = s.getUTCFullYear();
  if (
    kind === 'MONTH' &&
    s.getUTCDate() === 1 &&
    utc(y, s.getUTCMonth() + 1, 0).getTime() === e.getTime()
  ) {
    return `${MONTHS[s.getUTCMonth()]} ${y}`;
  }
  if (
    kind === 'QUARTER' &&
    s.getUTCDate() === 1 &&
    s.getUTCMonth() % 3 === 0 &&
    utc(y, s.getUTCMonth() + 3, 0).getTime() === e.getTime()
  ) {
    return `Q${s.getUTCMonth() / 3 + 1} ${y}`;
  }
  if (kind === 'YEAR' && start === `${y}-01-01` && end === `${y}-12-31`) return String(y);
  return null;
}

// ---------- Report cadence ----------

/** The due day (the close-target day, at most the 28th) of the month after a period ends. */
export function dueAfter(periodEnd: string, closeTargetDay: number): string {
  const end = new Date(`${periodEnd}T00:00:00.000Z`);
  return isoDay(utc(end.getUTCFullYear(), end.getUTCMonth() + 1, Math.min(closeTargetDay, 28)));
}

const stepMonths = (cadence: ReportCadence, months: number | null): number =>
  cadence === 'MONTHLY'
    ? 1
    : cadence === 'QUARTERLY'
      ? 3
      : cadence === 'ANNUAL'
        ? 12
        : (months ?? 1);

/**
 * The next report's due date from the cadence and the end of the last completed period: the
 * period after it is reported on the close-target day of the month after it ends (a date that
 * has passed is overdue work, and stays so). With no completed period yet, the first report is
 * the latest finished period whose due date has not passed (a new client is never born overdue).
 * Monthly, quarterly and annual periods follow the calendar; a custom cadence counts its months
 * from the last period (or from the start of this month). Returns the due day and the period it
 * reports.
 */
export function nextReportDue(input: {
  cadence: ReportCadence;
  cadenceMonths: number | null;
  closeTargetDay: number;
  lastCompletedEnd: string | null;
  today: Date;
}): { dueOn: string; periodStart: string; periodEnd: string } {
  const step = stepMonths(input.cadence, input.cadenceMonths);
  const after = (start: Date) => {
    const end = utc(start.getUTCFullYear(), start.getUTCMonth() + step, 0);
    return {
      dueOn: dueAfter(isoDay(end), input.closeTargetDay),
      periodStart: isoDay(start),
      periodEnd: isoDay(end),
    };
  };
  if (input.lastCompletedEnd) {
    return after(addDays(new Date(`${input.lastCompletedEnd}T00:00:00.000Z`), 1));
  }
  const y = input.today.getUTCFullYear();
  const m = input.today.getUTCMonth();
  // The latest calendar-aligned period that ended before today.
  let start =
    input.cadence === 'ANNUAL'
      ? utc(y - 1, 0, 1)
      : input.cadence === 'QUARTERLY'
        ? utc(y, Math.floor(m / 3) * 3 - 3, 1)
        : input.cadence === 'CUSTOM'
          ? utc(y, m - step, 1)
          : utc(y, m - 1, 1);
  let next = after(start);
  const today = isoDay(input.today);
  while (next.dueOn < today) {
    start = utc(start.getUTCFullYear(), start.getUTCMonth() + step, 1);
    next = after(start);
  }
  return next;
}

// ---------- Figures across periods ----------

export interface FigurePeriod {
  engagementId: string;
  periodStart: string;
  periodEnd: string;
  incomeCents: number | null;
  expensesCents: number | null;
}

/**
 * The periods whose figures add up for a stretch of time: inside [from, to], with both income and
 * expenses known, and for each client the shortest periods first so a quarter is never counted on
 * top of its months. Nothing is estimated for a stretch no period covers.
 */
export function figurePeriodsIn<T extends FigurePeriod>(
  periods: readonly T[],
  from: string,
  to: string,
): T[] {
  const picked: T[] = [];
  const byClient = new Map<string, T[]>();
  const span = (p: T) =>
    new Date(`${p.periodEnd}T00:00:00.000Z`).getTime() -
    new Date(`${p.periodStart}T00:00:00.000Z`).getTime();
  const candidates = periods
    .filter(
      (p) =>
        p.incomeCents !== null &&
        p.expensesCents !== null &&
        p.periodStart >= from &&
        p.periodEnd <= to,
    )
    .sort((a, b) => span(a) - span(b) || a.periodStart.localeCompare(b.periodStart));
  for (const p of candidates) {
    const mine = byClient.get(p.engagementId) ?? [];
    if (mine.some((q) => p.periodStart <= q.periodEnd && q.periodStart <= p.periodEnd)) continue;
    mine.push(p);
    byClient.set(p.engagementId, mine);
    picked.push(p);
  }
  return picked;
}

export const totalsOf = (periods: readonly FigurePeriod[]) => {
  const income = periods.reduce((n, p) => n + (p.incomeCents ?? 0), 0);
  const expenses = periods.reduce((n, p) => n + (p.expensesCents ?? 0), 0);
  return { incomeCents: income, expensesCents: expenses, netProfitCents: income - expenses };
};

// ---------- Status rules ----------

export interface StatusInputs {
  today: string;
  rules: StatusRules;
  alerts: BookkeepingAlerts;
  /** Any period has been started (or any report prepared). */
  started: boolean;
  /** The soonest due date of an unclosed period's close, not yet reached by the overdue window. */
  overdueClose: string | null;
  overdueReport: string | null;
  outstandingRequests: number;
  /** A connection whose latest sync failed or whose authorization ran out. */
  failedConnection: boolean;
  staleConnection: boolean;
  uncategorized: number | null;
  readyForReview: boolean;
}

export interface SuggestedStatus {
  status: BookkeepingStatus;
  reason: string | null;
}

const on = (flag: boolean | undefined) => flag !== false;

/**
 * The status the firm's rules suggest, worst first: OVERDUE (a close or report past its date by
 * the firm's grace days), MISSING_DOCUMENTS (requested documents outstanding), NEEDS_ATTENTION
 * (a failed or stale sync, items to categorize, a period waiting for review), NOT_STARTED (nothing
 * begun yet) and ON_TRACK. An alert the client has turned off never drives the status. The reason
 * always says exactly why.
 */
export function suggestStatus(i: StatusInputs): SuggestedStatus {
  const grace = i.rules.overdueAfterDays ?? 0;
  const pastDue = (d: string | null) =>
    d !== null &&
    addDays(new Date(`${d}T00:00:00.000Z`), grace) < new Date(`${i.today}T00:00:00.000Z`);
  if (on(i.alerts.overdueClose) && pastDue(i.overdueClose)) {
    return { status: 'OVERDUE', reason: `Close past due ${i.overdueClose}` };
  }
  if (pastDue(i.overdueReport)) {
    return { status: 'OVERDUE', reason: `Report past due ${i.overdueReport}` };
  }
  if (on(i.alerts.missingDocuments) && i.outstandingRequests > 0) {
    return {
      status: 'MISSING_DOCUMENTS',
      reason: `${i.outstandingRequests} document${i.outstandingRequests === 1 ? '' : 's'} outstanding`,
    };
  }
  if (on(i.alerts.failedIntegration) && i.failedConnection) {
    return { status: 'NEEDS_ATTENTION', reason: 'The accounting connection needs attention' };
  }
  if (on(i.alerts.staleSync) && i.staleConnection) {
    return { status: 'NEEDS_ATTENTION', reason: 'The last sync is out of date' };
  }
  if (i.uncategorized !== null && i.uncategorized > 0) {
    return {
      status: 'NEEDS_ATTENTION',
      reason: `${i.uncategorized} transaction${i.uncategorized === 1 ? '' : 's'} to categorize`,
    };
  }
  if (i.readyForReview) return { status: 'NEEDS_ATTENTION', reason: 'Waiting for review' };
  if (!i.started) return { status: 'NOT_STARTED', reason: null };
  return { status: 'ON_TRACK', reason: null };
}

// ---------- Report names ----------

export const REPORT_NAMES: Record<BookkeepingReportType, string> = {
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
  CUSTOM: 'Custom report',
};

// ---------- CSV ----------

/** One CSV cell. A leading =, +, -, @, tab or CR would run as a formula in a spreadsheet: prefix it. */
export function csvCell(value: string | number | null | undefined): string {
  let s = value === null || value === undefined ? '' : String(value);
  if (/^[=+\-@\t\r]/.test(s) && typeof value !== 'number') s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export const csvRow = (cells: readonly (string | number | null | undefined)[]): string =>
  cells.map(csvCell).join(',');
