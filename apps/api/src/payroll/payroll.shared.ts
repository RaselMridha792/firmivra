import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import type { Database, TxClient } from '@firmivra/db';
import {
  PAYROLL_PROVIDERS,
  type PayrollErrorCode,
  type PayrollIssueSeverity,
  type PayrollOverviewPeriod,
  type PayrollProviderRef,
  type PayrollSyncStatus,
  type PayrollWorkerStatus,
  type PayrollWorkerType,
} from '@firmivra/types';
import { notFound } from '../workspaces/common.js';

export { day, notFound, toDay } from '../workspaces/common.js';

/** The errors of the payroll routes (codes in packages/types/src/payroll). */
const conflict = (code: PayrollErrorCode, message: string) =>
  new ConflictException({ code, message });

export const errors = {
  notFound,
  forbidden: () =>
    new ForbiddenException({ code: 'FORBIDDEN', message: 'This action is not permitted' }),
  alreadyPayrollClient: () =>
    conflict('ALREADY_PAYROLL_CLIENT', 'This client is already a payroll client'),
  noPayrollService: () =>
    conflict(
      'NO_PAYROLL_SERVICE',
      'Add an active Payroll service to Services & Pricing before adding payroll clients',
    ),
  providerNotConnected: () =>
    conflict('PROVIDER_NOT_CONNECTED', 'Connect the payroll provider in Integrations first'),
  frequencyRequired: () =>
    conflict('FREQUENCY_REQUIRED', 'Choose the pay frequency before creating a run'),
  runExists: () => conflict('RUN_EXISTS', 'A payroll run for this period already exists'),
  runState: (message: string) => conflict('RUN_STATE', message),
  runBlocked: () => conflict('RUN_BLOCKED', 'Resolve the errors before approving this run'),
  runEmpty: () => conflict('RUN_EMPTY', 'Add pay lines to the run first'),
  clientState: (message: string) => conflict('CLIENT_STATE', message),
  notThisClients: (what: string) =>
    conflict('NOT_THIS_CLIENTS', `The ${what} does not belong to this payroll client`),
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

/** The name of the payroll rule the database raised (PAYROLL_RUN_BLOCKED...), when it was one. */
export function payrollDbRule(error: unknown): string | undefined {
  if (!error || typeof error !== 'object') return undefined;
  const text = [
    (error as { message?: unknown }).message,
    JSON.stringify((error as { meta?: unknown }).meta ?? ''),
  ]
    .filter((p): p is string => typeof p === 'string')
    .join(' ');
  return /PAYROLL_[A-Z_]+/.exec(text)?.[0];
}

/** Turns the database's named payroll rules into the contract's 409s; anything else is rethrown. */
export function mapPayrollDbError(error: unknown): never {
  switch (payrollDbRule(error)) {
    case 'PAYROLL_RUN_BLOCKED':
      throw errors.runBlocked();
    case 'PAYROLL_RUN_STATUS':
    case 'PAYROLL_RUN_LOCKED':
    case 'PAYROLL_RUN_COMPLETED':
    case 'PAYROLL_RUN_REOPEN':
      throw errors.runState('The run is not in a state that allows this');
    case 'PAYROLL_LINE_WORKER':
    case 'PAYROLL_ISSUE_WORKER':
      throw errors.notThisClients('worker');
    case 'PAYROLL_REPORT_RUN':
      throw errors.notThisClients('run');
    case 'PAYROLL_REPORT_DOCUMENT':
      throw errors.notThisClients('document');
    case 'PAYROLL_CONNECTION':
      throw errors.providerNotConnected();
    default:
      throw error;
  }
}

// ---------- Providers and sync ----------

export const providerLabel = (key: string | null): string =>
  key === null
    ? 'Not connected'
    : ((PAYROLL_PROVIDERS as Record<string, string | undefined>)[key] ?? key);

export function providerRef(
  key: string | null,
  connection: { status: string } | null,
): PayrollProviderRef | null {
  return key === null
    ? null
    : { key, label: providerLabel(key), connected: connection?.status === 'CONNECTED' };
}

/** The sync status the list and the workspace show, from the connection and the last good sync. */
export function syncStatusOf(
  row: { connected: boolean; lastSyncedAt: Date | null },
  staleAfterHours: number,
  now: Date,
): PayrollSyncStatus {
  if (!row.connected) return 'NOT_CONNECTED';
  if (!row.lastSyncedAt) return 'NEVER';
  return now.getTime() - row.lastSyncedAt.getTime() > staleAfterHours * 3_600_000
    ? 'STALE'
    : 'SYNCED';
}

// ---------- Dates ----------

const isoDay = (d: Date) => d.toISOString().slice(0, 10);
const utc = (y: number, m: number, d: number) => new Date(Date.UTC(y, m, d));

export interface PeriodRange {
  from: string;
  to: string;
  previousFrom: string;
  previousTo: string;
}

/** The overview's period and the period before it, as inclusive calendar days (UTC). */
export function periodRange(key: PayrollOverviewPeriod, today: Date): PeriodRange {
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
  return Math.round(((value - previous) / previous) * 1000) / 10;
}

/** Share of a total to one decimal; zero when the total is zero. */
export const sharePercent = (part: number, total: number): number =>
  total === 0 ? 0 : Math.round((part / total) * 1000) / 10;

// ---------- Run figures ----------

export interface LineAmounts {
  hours: number;
  regularPayCents: number;
  overtimePayCents: number;
  otherEarningsCents: number;
  deductionsCents: number;
  status: string;
  workerType: PayrollWorkerType;
}

export interface TaxInputs {
  employeeTaxesCents: number | null;
  employerTaxesCents: number | null;
  employerBenefitsCents: number | null;
}

/** The run row's figure columns (all null when nothing is entered). */
export interface FigureColumns extends TaxInputs {
  employeeCount: number | null;
  regularPayCents: number | null;
  overtimePayCents: number | null;
  otherEarningsCents: number | null;
  grossCents: number | null;
  deductionsCents: number | null;
  netCents: number | null;
  employerCostsCents: number | null;
  totalCostCents: number | null;
}

/** A line's total as the database checks it. */
export const linePay = (
  l: Pick<
    LineAmounts,
    'regularPayCents' | 'overtimePayCents' | 'otherEarningsCents' | 'deductionsCents'
  >,
) => l.regularPayCents + l.overtimePayCents + l.otherEarningsCents - l.deductionsCents;

/**
 * The run's figures from its lines and the tax figures the preparer took from the provider's
 * report. Excluded lines (and contractors, when left out of the run) count for nothing. With no
 * pay or hours entered, every figure stays null; nothing is estimated. Firmivra calculates no
 * payroll tax: net, employer costs and total cost appear only when the figures they need are
 * there. Throws a RangeError when taxes and deductions exceed the gross pay.
 */
export function figuresFrom(
  lines: readonly LineAmounts[],
  includeContractors: boolean,
  taxes: TaxInputs,
): FigureColumns {
  const counted = lines.filter(
    (l) => l.status !== 'EXCLUDED' && (includeContractors || l.workerType !== 'CONTRACTOR'),
  );
  const entered = counted.some(
    (l) =>
      l.hours > 0 ||
      l.regularPayCents > 0 ||
      l.overtimePayCents > 0 ||
      l.otherEarningsCents > 0 ||
      l.deductionsCents > 0,
  );
  const empty: FigureColumns = {
    employeeCount: null,
    regularPayCents: null,
    overtimePayCents: null,
    otherEarningsCents: null,
    grossCents: null,
    deductionsCents: null,
    netCents: null,
    employerCostsCents: null,
    totalCostCents: null,
    ...taxes,
  };
  if (!entered) return empty;
  const sum = (pick: (l: LineAmounts) => number) => counted.reduce((n, l) => n + pick(l), 0);
  const regular = sum((l) => l.regularPayCents);
  const overtime = sum((l) => l.overtimePayCents);
  const other = sum((l) => l.otherEarningsCents);
  const gross = regular + overtime + other;
  const deductions = sum((l) => l.deductionsCents);
  const net =
    taxes.employeeTaxesCents === null ? null : gross - taxes.employeeTaxesCents - deductions;
  if (net !== null && net < 0) throw new RangeError('Taxes and deductions exceed the gross pay');
  const employerCosts =
    taxes.employerTaxesCents === null || taxes.employerBenefitsCents === null
      ? null
      : taxes.employerTaxesCents + taxes.employerBenefitsCents;
  return {
    ...taxes,
    employeeCount: counted.length,
    regularPayCents: regular,
    overtimePayCents: overtime,
    otherEarningsCents: other,
    grossCents: gross,
    deductionsCents: deductions,
    netCents: net,
    employerCostsCents: employerCosts,
    totalCostCents: employerCosts === null ? null : gross + employerCosts,
  };
}

// ---------- Run checks (exceptions) ----------

export interface CheckLine {
  workerId: string;
  hours: number;
  regularPayCents: number;
  overtimePayCents: number;
  otherEarningsCents: number;
  status: string;
  totalPayCents: number;
  workerStatus: PayrollWorkerStatus;
  payType: string | null;
  directDepositReady: boolean | null;
}

export interface FoundIssue {
  workerId: string;
  severity: PayrollIssueSeverity;
  code: string;
  message: string;
}

/**
 * The firm's own checks of a run's lines. Messages name no pay, SSN or bank detail (the
 * database refuses them); the worker is the issue's `workerId`. Only an inactive worker being
 * paid is an ERROR, which blocks approval; the rest are warnings or notes.
 */
export function checkLines(lines: readonly CheckLine[]): FoundIssue[] {
  const found: FoundIssue[] = [];
  for (const l of lines) {
    if (l.status === 'EXCLUDED') continue;
    const add = (severity: PayrollIssueSeverity, code: string, message: string) =>
      found.push({ workerId: l.workerId, severity, code, message });
    const earned = l.regularPayCents + l.overtimePayCents + l.otherEarningsCents;
    if (earned > 0 && (l.workerStatus === 'INACTIVE' || l.workerStatus === 'PENDING_SETUP')) {
      add('ERROR', 'worker_not_active', 'This worker is paid but is not active at the provider.');
    }
    if (l.overtimePayCents > 0) {
      add('WARNING', 'overtime_review', 'This worker has overtime. Review it for accuracy.');
    }
    if (l.directDepositReady === false) {
      add('WARNING', 'bank_validation_missing', 'Direct deposit is not validated for this worker.');
    }
    if (l.hours > 0 && earned === 0) {
      add('WARNING', 'hours_without_pay', 'This worker has hours but no pay.');
    }
    if (l.payType === 'HOURLY' && l.hours === 0 && earned > 0) {
      add('WARNING', 'pay_without_hours', 'This hourly worker has pay but no hours.');
    }
    if (l.status === 'PENDING_CHANGE') {
      add('INFO', 'pending_change', 'A change for this worker is pending approval.');
    }
  }
  return found;
}

// ---------- CSV ----------

/** One CSV cell. A leading =, +, -, @, tab or CR would run as a formula in a spreadsheet: prefix it. */
export function csvCell(value: string | number | null | undefined): string {
  let s = value === null || value === undefined ? '' : String(value);
  if (/^[=+\-@\t\r]/.test(s) && typeof value !== 'number') s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export const csvRow = (cells: readonly (string | number | null | undefined)[]): string =>
  cells.map(csvCell).join(',');

/** Cents as dollars with two decimals ("1234.56"); empty for null. */
export const dollars = (cents: number | null): string =>
  cents === null
    ? ''
    : `${cents < 0 ? '-' : ''}${Math.floor(Math.abs(cents) / 100)}.${String(Math.abs(cents) % 100).padStart(2, '0')}`;

/** The run's state machine as the database enforces it (payroll_runs_rules), for the actions' guards. */
export const EDITABLE_RUN_STATUSES = ['NOT_STARTED', 'DRAFT', 'IN_PROGRESS'] as const;
export const isEditableRun = (status: string): boolean =>
  (EDITABLE_RUN_STATUSES as readonly string[]).includes(status);
