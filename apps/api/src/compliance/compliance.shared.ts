import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import type { Database, Prisma, TxClient } from '@firmivra/db';
import type {
  ComplianceDisplayStatus,
  ComplianceErrorCode,
  ComplianceRepeatRule,
  DeadlineFrequency,
  HolidayRule,
  RecurrenceEnd,
} from '@firmivra/types';
import { notFound } from '../workspaces/common.js';

export { day, notFound, toDay } from '../workspaces/common.js';

const conflict = (code: ComplianceErrorCode, message: string) =>
  new ConflictException({ code, message });

/** The errors of the compliance routes (codes in packages/types/src/compliance). */
export const errors = {
  notFound,
  forbidden: () =>
    new ForbiddenException({ code: 'FORBIDDEN', message: 'This action is not permitted' }),
  deadlineState: (message: string) => conflict('DEADLINE_STATE', message),
  overrideReasonRequired: () =>
    conflict(
      'OVERRIDE_REASON_REQUIRED',
      'Give the reason for moving a government or imported due date',
    ),
  overrideNotAllowed: () =>
    new ForbiddenException({
      code: 'OVERRIDE_NOT_ALLOWED',
      message: 'Only the Owner or an Admin can move a government or imported due date',
    }),
  notThisClients: (what: string) =>
    conflict('NOT_THIS_CLIENTS', `The ${what} does not belong to this deadline's client`),
  duplicate: (message: string) => conflict('DUPLICATE', message),
  templateNotFound: () => conflict('TEMPLATE_NOT_FOUND', 'That task template is not available'),
  calendarState: (message: string) => conflict('CALENDAR_STATE', message),
  entriesNeedVerification: () =>
    conflict(
      'ENTRIES_NEED_VERIFICATION',
      'Some entries have no date yet. Give each a date or remove it before verifying',
    ),
  noEntries: () => conflict('NO_ENTRIES', 'Add at least one entry first'),
  recurrenceState: (message: string) => conflict('RECURRENCE_STATE', message),
  dueDateRequired: () =>
    conflict('DUE_DATE_REQUIRED', 'This entry has no fixed date: give the due date'),
  suggestionState: (message: string) => conflict('SUGGESTION_STATE', message),
  ruleInactive: () => conflict('RULE_INACTIVE', 'This rule is switched off'),
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

/** The text of a database error, for the named rules the compliance triggers raise. */
function errorText(error: unknown): string {
  if (!error || typeof error !== 'object') return '';
  return [
    (error as { message?: unknown }).message,
    JSON.stringify((error as { meta?: unknown }).meta ?? ''),
  ]
    .filter((p): p is string => typeof p === 'string')
    .join(' ');
}

/** Turns the database's compliance rules into the contract's 409s; anything else is rethrown. */
export function mapComplianceDbError(error: unknown): never {
  const text = errorText(error);
  if (text.includes("a task of a deadline is of the deadline's client")) {
    throw errors.notThisClients('task');
  }
  if (text.includes("only one of the deadline client's documents")) {
    throw errors.notThisClients('document');
  }
  if (text.includes('linked deadlines are of the same client')) {
    throw errors.notThisClients('deadline');
  }
  if (
    text.includes("only a DRAFT version's entries can change") ||
    text.includes('compliance calendars: a version that left DRAFT') ||
    /compliance calendars: a \w+ version cannot become/.test(text)
  ) {
    throw errors.calendarState('This calendar version cannot be changed that way');
  }
  if (text.includes('a template makes no deadlines')) {
    throw errors.recurrenceState('A template makes no deadlines');
  }
  throw error;
}

// ---------- Dates ----------

export const DAY_MS = 86_400_000;
export const isoDay = (d: Date) => d.toISOString().slice(0, 10);
export const parseDay = (value: string) => new Date(`${value}T00:00:00.000Z`);
/** Today as a calendar day (UTC, the same clock the other firm modules use). */
export const todayOf = (now = new Date()) => parseDay(isoDay(now));
export const addDays = (d: Date, n: number) => new Date(d.getTime() + n * DAY_MS);
export const daysBetween = (from: Date, to: Date) =>
  Math.round((to.getTime() - from.getTime()) / DAY_MS);
const utc = (y: number, m: number, d: number) => new Date(Date.UTC(y, m, d));
const lastDayOfMonth = (y: number, m: number) => new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
const clampDay = (y: number, m: number, d: number) => utc(y, m, Math.min(d, lastDayOfMonth(y, m)));

/** The nth weekday of a month (nth 5 is the last one). */
function nthWeekday(y: number, m: number, nth: number, weekday: number): Date {
  const first = utc(y, m, 1);
  const offset = (weekday - first.getUTCDay() + 7) % 7;
  let date = 1 + offset + (Math.min(nth, 5) - 1) * 7;
  while (date > lastDayOfMonth(y, m)) date -= 7;
  return utc(y, m, date);
}

/**
 * US federal holidays (and DC Emancipation Day, which the IRS observes), by the day they are
 * observed: one that falls on a Saturday is observed on the Friday, on a Sunday on the Monday.
 */
export function federalHolidays(year: number): Set<string> {
  const observed = (d: Date) => {
    const wd = d.getUTCDay();
    return wd === 6 ? addDays(d, -1) : wd === 0 ? addDays(d, 1) : d;
  };
  const days = [
    observed(utc(year, 0, 1)),
    nthWeekday(year, 0, 3, 1), // Martin Luther King Jr. Day
    nthWeekday(year, 1, 3, 1), // Washington's Birthday
    nthWeekday(year, 4, 5, 1), // Memorial Day
    observed(utc(year, 5, 19)), // Juneteenth
    observed(utc(year, 6, 4)),
    nthWeekday(year, 8, 1, 1), // Labor Day
    nthWeekday(year, 9, 2, 1), // Columbus Day
    observed(utc(year, 10, 11)), // Veterans Day
    nthWeekday(year, 10, 4, 4), // Thanksgiving
    observed(utc(year, 11, 25)),
    observed(utc(year, 3, 16)), // DC Emancipation Day
  ];
  return new Set(days.map(isoDay));
}

/** Moves a date off a weekend or federal holiday by the rule (the unadjusted date is kept by the caller). */
export function adjustForHoliday(date: Date, rule: HolidayRule): Date {
  if (rule === 'NONE') return date;
  const step = rule === 'NEXT_BUSINESS_DAY' ? 1 : -1;
  const holidays = new Set<string>();
  for (const y of [date.getUTCFullYear() - 1, date.getUTCFullYear(), date.getUTCFullYear() + 1]) {
    for (const h of federalHolidays(y)) holidays.add(h);
  }
  let d = date;
  for (let i = 0; i < 10; i += 1) {
    const wd = d.getUTCDay();
    if (wd !== 0 && wd !== 6 && !holidays.has(isoDay(d))) return d;
    d = addDays(d, step);
  }
  return d;
}

export interface RepeatDefinition {
  frequency: DeadlineFrequency;
  interval: number | null;
  repeatRule: ComplianceRepeatRule;
  startOn: Date;
  endMode: RecurrenceEnd;
  endAfterCount: number | null;
  endOn: Date | null;
  holidayRule: HolidayRule;
}

export interface Occurrence {
  statutoryOn: Date;
  dueOn: Date;
  adjusted: boolean;
}

type Rule = Record<string, number | undefined>;

/** The date a month's repeat rule gives, from the repeat-on choice. */
function monthlyDate(y: number, m: number, rule: Rule): Date | null {
  if (rule.dayOfMonth !== undefined) return clampDay(y, m, rule.dayOfMonth);
  if (rule.nth !== undefined && rule.weekday !== undefined) {
    return nthWeekday(y, m, rule.nth, rule.weekday);
  }
  return null;
}

/**
 * The dates of a recurring definition from its start, in order. The statutory date is the one the
 * repeat rule gives; the due date is that date moved by the holiday rule, so the unadjusted date
 * is never lost. Counting for "after N" starts at the first date on or after the start. At most
 * `count` dates, none due before `notBefore`. Authority-defined definitions give none: their dates
 * come from the authority's published calendar.
 */
export function occurrences(
  def: RepeatDefinition,
  opts: { count: number; notBefore?: Date },
): Occurrence[] {
  if (def.frequency === 'AUTHORITY_DEFINED') return [];
  const rule = def.repeatRule as Rule;
  const startY = def.startOn.getUTCFullYear();
  const startM = def.startOn.getUTCMonth();
  const found: Occurrence[] = [];
  let ordinal = 0;
  for (let k = 0; k < 1200 && found.length < opts.count; k += 1) {
    let statutory: Date | null;
    if (def.frequency === 'MONTHLY') {
      const mi = startY * 12 + startM + k;
      statutory = monthlyDate(Math.floor(mi / 12), mi % 12, rule);
    } else if (def.frequency === 'CUSTOM') {
      const mi = startY * 12 + startM + k * (def.interval ?? 1);
      statutory = monthlyDate(Math.floor(mi / 12), mi % 12, rule);
    } else if (def.frequency === 'QUARTERLY') {
      // From the quarter before the start: a quarter's date can fall in the next quarter.
      const quarter = Math.floor(startM / 3) - 1 + k;
      const mi = startY * 12 + quarter * 3 + 2 + (rule.monthsAfterQuarterEnd ?? 0);
      statutory = clampDay(Math.floor(mi / 12), mi % 12, rule.dayOfMonth ?? 1);
    } else {
      statutory = clampDay(startY + k, (rule.month ?? 1) - 1, rule.day ?? 1);
    }
    if (!statutory || statutory < def.startOn) continue;
    ordinal += 1;
    if (
      def.endMode === 'AFTER_COUNT' &&
      def.endAfterCount !== null &&
      ordinal > def.endAfterCount
    ) {
      break;
    }
    if (def.endMode === 'ON_DATE' && def.endOn && statutory > def.endOn) break;
    const dueOn = adjustForHoliday(statutory, def.holidayRule);
    if (opts.notBefore && dueOn < opts.notBefore) continue;
    found.push({
      statutoryOn: statutory,
      dueOn,
      adjusted: dueOn.getTime() !== statutory.getTime(),
    });
  }
  return found;
}

// ---------- Status ----------

export const OPEN_STATUSES = ['UPCOMING', 'IN_PROGRESS', 'WAITING_ON_CLIENT'] as const;
export const CLOSED_STATUSES = ['COMPLETED', 'NOT_APPLICABLE', 'CANCELLED'] as const;
const isOpen = (status: string) => (OPEN_STATUSES as readonly string[]).includes(status);

export interface DateFields {
  dueOn: Date;
  extendedDueOn: Date | null;
}

/** The date a deadline is judged by: the extended filing date when an extension was filed. */
export const effectiveDue = (d: DateFields): Date => d.extendedDueOn ?? d.dueOn;

/** Overdue and Due Soon are never stored: they come from the date, the threshold and the status. */
export function displayStatusOf(
  d: DateFields & { status: string },
  today: Date,
  dueSoonDays: number,
): ComplianceDisplayStatus {
  if (!isOpen(d.status)) return d.status as ComplianceDisplayStatus;
  const days = daysBetween(today, effectiveDue(d));
  if (days < 0) return 'OVERDUE';
  if (d.status === 'UPCOMING' && days <= dueSoonDays) return 'DUE_SOON';
  return d.status as ComplianceDisplayStatus;
}

type Where = Prisma.ComplianceDeadlineWhereInput;
const before = (d: Date): Where => ({
  OR: [{ extendedDueOn: { lt: d } }, { extendedDueOn: null, dueOn: { lt: d } }],
});
const onOrAfter = (d: Date): Where => ({
  OR: [{ extendedDueOn: { gte: d } }, { extendedDueOn: null, dueOn: { gte: d } }],
});
const onOrBefore = (d: Date): Where => ({
  OR: [{ extendedDueOn: { lte: d } }, { extendedDueOn: null, dueOn: { lte: d } }],
});

/** Overdue: open and past its (extended) date. */
export const overdueWhere = (today: Date): Where => ({
  status: { in: [...OPEN_STATUSES] },
  ...before(today),
});

/** Open and due from today through `to` (inclusive). */
export const dueBetween = (today: Date, to: Date): Where => ({
  status: { in: [...OPEN_STATUSES] },
  AND: [onOrAfter(today), onOrBefore(to)],
});

/** The deadlines a display status shows, as the derivation above defines it. */
export function displayStatusWhere(
  status: ComplianceDisplayStatus,
  today: Date,
  dueSoonDays: number,
): Where {
  const soon = addDays(today, dueSoonDays);
  switch (status) {
    case 'OVERDUE':
      return overdueWhere(today);
    case 'DUE_SOON':
      return { status: 'UPCOMING', AND: [onOrAfter(today), onOrBefore(soon)] };
    case 'UPCOMING':
      return { status: 'UPCOMING', ...onOrAfter(addDays(soon, 1)) };
    case 'IN_PROGRESS':
    case 'WAITING_ON_CLIENT':
      return { status, ...onOrAfter(today) };
    default:
      return { status };
  }
}

export const percent = (part: number, total: number): number =>
  total === 0 ? 0 : Math.round((part / total) * 1000) / 10;

/** Percentage change to one decimal, or null when there is nothing to compare against. */
export function changePercent(value: number, previous: number | null): number | null {
  if (previous === null || previous === 0) return null;
  return Math.round(((value - previous) / previous) * 1000) / 10;
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
