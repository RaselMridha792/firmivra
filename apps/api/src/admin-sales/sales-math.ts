import {
  SALES_TWO_WAY_OUTCOMES,
  type SalesActivityDirection,
  type SalesActivityOutcome,
  type SalesAttentionFlag,
  SalesAttentionFlag as AttentionFlags,
  type SalesChangeSource,
  type SalesErrorCode,
  type SalesFeedKind,
  type SalesLostReason,
  type SalesPeriod,
  type SalesStageRequirement,
  type SalesStageType,
  type SalesTransactionStatus,
} from '@firmivra/types';

// The Sales API's pure rules (docs/work/R60-sales.md, "Sales API"): periods as UTC days, trends,
// B5's attention badges and conversion rate, the contact counters, the feed's kinds, what a
// stage needs on entry, subscription prices and CSV cells. No database here: the unit tests
// cover these directly.

export const HOUR_MS = 3_600_000;
export const DAY_MS = 24 * HOUR_MS;

/** Midnight UTC of a `YYYY-MM-DD` day, in ms. */
export const utcDay = (day: string) => Date.parse(`${day}T00:00:00.000Z`);
/** The UTC day of a time, as `YYYY-MM-DD`. */
export const dayOf = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const addDays = (day: string, days: number) => dayOf(utcDay(day) + days * DAY_MS);

/** A range of UTC days, both included: `start` is the first day's midnight, `end` the day after the last. */
export interface Bounds {
  from: string;
  to: string;
  start: number;
  end: number;
}
export const boundsOf = (from: string, to: string): Bounds => ({
  from,
  to,
  start: utcDay(from),
  end: utcDay(to) + DAY_MS,
});
export const within = (at: Date | number | null | undefined, b: Bounds) => {
  if (at === null || at === undefined) return false;
  const ms = typeof at === 'number' ? at : at.getTime();
  return ms >= b.start && ms < b.end;
};

const DAYS_BACK: Partial<Record<SalesPeriod, number>> = {
  LAST_7_DAYS: 7,
  LAST_30_DAYS: 30,
  LAST_90_DAYS: 90,
};
const CALENDAR_MONTHS: Partial<Record<SalesPeriod, number>> = {
  THIS_MONTH: 1,
  THIS_QUARTER: 3,
  THIS_YEAR: 12,
};

/** The calendar month, quarter or year that holds `day`, `back` periods earlier. */
function calendar(day: string, months: number, back: number): Bounds {
  const d = new Date(utcDay(day));
  const first = months === 12 ? 0 : d.getUTCMonth() - (d.getUTCMonth() % months);
  const start = Date.UTC(d.getUTCFullYear(), first - back * months, 1);
  const end = Date.UTC(d.getUTCFullYear(), first - back * months + months, 1);
  return boundsOf(dayOf(start), dayOf(end - DAY_MS));
}

/**
 * The period a query asks for and the one before it (LAST_30_DAYS when it names none): the last
 * N days ending today and the N days before; this calendar month, quarter or year and the
 * previous one; or a range and the same number of days just before it.
 */
export function periodBounds(
  query: { period?: SalesPeriod | undefined; from?: string | undefined; to?: string | undefined },
  now: number,
): { current: Bounds; previous: Bounds } {
  const today = dayOf(now);
  if (query.from && query.to) {
    const days = Math.round((utcDay(query.to) - utcDay(query.from)) / DAY_MS) + 1;
    return {
      current: boundsOf(query.from, query.to),
      previous: boundsOf(addDays(query.from, -days), addDays(query.from, -1)),
    };
  }
  const period = query.period ?? 'LAST_30_DAYS';
  const months = CALENDAR_MONTHS[period];
  if (months) return { current: calendar(today, months, 0), previous: calendar(today, months, 1) };
  const days = DAYS_BACK[period] ?? 30;
  const from = addDays(today, -(days - 1));
  return {
    current: boundsOf(from, today),
    previous: boundsOf(addDays(from, -days), addDays(from, -1)),
  };
}

/** Percent change against the period before; null when there is nothing to compare with. */
export const change = (current: number, previous: number) =>
  previous === 0 ? null : Math.round(((current - previous) / previous) * 100);

/** A share in basis points (10,000 = 100%); 0 when nothing counts. */
export const basisPoints = (part: number, whole: number) =>
  whole === 0 ? 0 : Math.round((part / whole) * 10_000);

/** Stage types counted in pipeline value and open for attention (B5). */
export const OPEN_TYPES: readonly SalesStageType[] = ['ACTIVE', 'CONVERTED', 'TRANSACTION_SYNCED'];
/** Entering one of these converts the record (B5's `converted_at`). */
export const CONVERTED_TYPES: readonly SalesStageType[] = [
  'CONVERTED',
  'TRANSACTION_SYNCED',
  'CLOSED',
];
export const NOT_COUNTED: readonly SalesLostReason[] = ['DUPLICATE', 'INVALID_LEAD'];

/**
 * B5's conversion rate over a set of records: those created in the period with a conversion time
 * ÷ those created in the period minus the ones lost as DUPLICATE or INVALID_LEAD.
 */
export function conversionOf(
  records: readonly { convertedAt: Date | null; lostReason: SalesLostReason | null }[],
) {
  const converted = records.filter((r) => r.convertedAt !== null).length;
  const eligible = records.filter(
    (r) => !r.lostReason || !NOT_COUNTED.includes(r.lostReason),
  ).length;
  return { rateBp: basisPoints(converted, eligible), converted, eligible };
}

// ---------- Contact counters and attention ----------

const TWO_WAY = new Set<SalesActivityOutcome>(SALES_TWO_WAY_OUTCOMES);
export const isTwoWay = (a: {
  direction: SalesActivityDirection;
  outcome: SalesActivityOutcome | null;
}) => a.direction === 'INBOUND' || (a.outcome !== null && TWO_WAY.has(a.outcome));

/**
 * From a record's activities: outbound ones in all, outbound ones since the last two-way contact
 * (all of them when never reached), the first two-way contact and the latest activity.
 */
export function contactStats(
  activities: readonly {
    direction: SalesActivityDirection;
    outcome: SalesActivityOutcome | null;
    occurredAt: Date;
  }[],
) {
  const sorted = [...activities].sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime());
  let outbound = 0;
  let attempts = 0;
  let contactedAt: Date | null = null;
  for (const a of sorted) {
    if (a.direction === 'OUTBOUND') outbound += 1;
    if (isTwoWay(a)) {
      attempts = 0;
      contactedAt ??= a.occurredAt;
    } else if (a.direction === 'OUTBOUND') attempts += 1;
  }
  return { outbound, attempts, contactedAt, lastAt: sorted.at(-1)?.occurredAt ?? null };
}

export interface AttentionRules {
  noContactHours: number;
  followUpDueHours: number;
  noResponseAttempts: number;
  noActivityDays: number;
  ownerRequired: boolean;
}
export interface AttentionInput {
  stageType: SalesStageType;
  /** The record is in its pipeline's New Lead stage (the shipped `new_lead`, else the first). */
  inNewLead: boolean;
  ownerId: string | null;
  createdAt: number;
  lastActivityAt: number;
  outbound: number;
  attempts: number;
  /** Due times of the record's scheduled follow-ups. */
  scheduledDue: readonly number[];
}

/** B5's badges for one record, in order of importance; none outside the open stages. */
export function attentionOf(
  input: AttentionInput,
  rules: AttentionRules,
  now: number,
): SalesAttentionFlag[] {
  if (!OPEN_TYPES.includes(input.stageType)) return [];
  const flags = new Set<SalesAttentionFlag>();
  if (
    input.inNewLead &&
    input.outbound === 0 &&
    now - input.createdAt > rules.noContactHours * HOUR_MS
  )
    flags.add('NO_CONTACT');
  if (input.scheduledDue.some((due) => due < now)) flags.add('OVERDUE');
  if (input.attempts >= rules.noResponseAttempts) flags.add('NO_RESPONSE');
  if (rules.ownerRequired && !input.ownerId) flags.add('UNASSIGNED');
  if (now - input.lastActivityAt > rules.noActivityDays * DAY_MS) flags.add('NO_ACTIVITY');
  if (input.scheduledDue.some((due) => due >= now && due - now <= rules.followUpDueHours * HOUR_MS))
    flags.add('FOLLOW_UP_DUE');
  return AttentionFlags.options.filter((flag) => flags.has(flag));
}

// ---------- The feed ----------

/**
 * What a stage history row reads as: the first row is CREATED; the row that converted the record
 * (its time is the record's `converted_at`, the database stamps both in one transaction) is WON;
 * entering a LOST stage is LOST; a move by the transaction sync is UNDER_CONTRACT, CLOSED or
 * TERMINATED; any other move is STAGE_CHANGED. The first that applies wins.
 */
export function stageFeedKind(
  row: {
    fromStageId: string | null;
    fromStageName: string | null;
    toStageType: SalesStageType;
    source: SalesChangeSource;
    transactionStatus: SalesTransactionStatus | null;
    createdAt: Date;
  },
  convertedAt: Date | null,
): SalesFeedKind {
  if (row.fromStageId === null && row.fromStageName === null) return 'CREATED';
  if (
    convertedAt !== null &&
    CONVERTED_TYPES.includes(row.toStageType) &&
    row.createdAt.getTime() === convertedAt.getTime()
  )
    return 'WON';
  if (row.toStageType === 'LOST') return 'LOST';
  if (row.source === 'TRANSACTION') {
    if (row.transactionStatus === 'UNDER_CONTRACT') return 'UNDER_CONTRACT';
    if (row.transactionStatus === 'CLOSED') return 'CLOSED';
    if (row.transactionStatus === 'TERMINATED') return 'TERMINATED';
  }
  return 'STAGE_CHANGED';
}

export const assignmentFeedKind = (from: string | null, to: string | null): SalesFeedKind =>
  to === null ? 'UNASSIGNED' : from === null ? 'ASSIGNED' : 'REASSIGNED';

// ---------- Entering a stage ----------

export interface EntryStage {
  type: SalesStageType;
  active: boolean;
  requires: readonly SalesStageRequirement[];
}
export interface EntryRecord {
  valueCents: number | null;
  ownerId: string | null;
  planId: string | null;
  transactionId: string | null;
  transactionStatus: SalesTransactionStatus | null;
  lostReason: SalesLostReason | null;
  /** '' or null: none. */
  lostNote: string | null;
}

/**
 * What stops a record entering a stage by hand, in the order the person fixes it (the database's
 * rules in `sales_opportunities_rules`), or null. A record under contract or closed follows its
 * transaction, and only the transaction sync enters a TRANSACTION_SYNCED stage.
 */
export function entryProblem(
  stage: EntryStage,
  record: EntryRecord,
  lostOtherNoteRequired: boolean,
): SalesErrorCode | null {
  if (!stage.active) return 'STAGE_INACTIVE';
  if (record.transactionStatus === 'UNDER_CONTRACT' || record.transactionStatus === 'CLOSED')
    return 'TRANSACTION_LOCKED';
  if (stage.type === 'TRANSACTION_SYNCED') return 'TRANSACTION_LOCKED';
  const note = record.lostNote ? record.lostNote : null;
  if (stage.type === 'LOST') {
    if (!record.lostReason) return 'LOST_REASON_REQUIRED';
    if (record.lostReason === 'OTHER' && lostOtherNoteRequired && !note)
      return 'LOST_NOTE_REQUIRED';
  } else if (record.lostReason || note) return 'LOST_REASON_NOT_ALLOWED';
  for (const need of stage.requires) {
    if (need === 'VALUE' && record.valueCents === null) return 'VALUE_REQUIRED';
    if (need === 'ASSIGNEE' && record.ownerId === null) return 'OWNER_REQUIRED';
    if (need === 'PLAN' && record.planId === null) return 'PLAN_REQUIRED';
    if (need === 'TRANSACTION' && record.transactionId === null) return 'TRANSACTION_REQUIRED';
    if (need === 'LOST_NOTE' && !note) return 'LOST_NOTE_REQUIRED';
  }
  return null;
}

// ---------- Money and files ----------

/**
 * A linked subscription's monthly price: its negotiated price, or its plan's base price, plus its
 * purchased seats and locations at the plan's prices; an annual plan's price divided by 12,
 * rounded down.
 */
export function monthlyCents(
  sub: { priceCentsOverride: number | null; seatsPurchased: number; locationsPurchased: number },
  plan: {
    basePriceCents: number;
    overagePriceCentsPerSeat: number | null;
    overagePriceCentsPerLocation: number | null;
    billingCycle: 'MONTHLY' | 'ANNUAL';
  },
): number {
  const cycle =
    (sub.priceCentsOverride ?? plan.basePriceCents) +
    sub.seatsPurchased * (plan.overagePriceCentsPerSeat ?? 0) +
    sub.locationsPurchased * (plan.overagePriceCentsPerLocation ?? 0);
  return plan.billingCycle === 'ANNUAL' ? Math.floor(cycle / 12) : cycle;
}

/**
 * What a subscription's state means for a linked record (B5): a signed contract or active paid
 * plan is UNDER_CONTRACT, one that ended at the end of its term CLOSED, one cancelled early
 * TERMINATED; a trial or a suspended plan stays OPEN.
 */
export function transactionStatusOf(
  status: 'TRIAL' | 'ACTIVE' | 'PAST_DUE' | 'SUSPENDED' | 'NON_RENEWING' | 'EXPIRED' | 'CANCELLED',
): SalesTransactionStatus {
  switch (status) {
    case 'ACTIVE':
    case 'PAST_DUE':
    case 'NON_RENEWING':
      return 'UNDER_CONTRACT';
    case 'EXPIRED':
      return 'CLOSED';
    case 'CANCELLED':
      return 'TERMINATED';
    default:
      return 'OPEN';
  }
}

/** One CSV cell. A leading =, +, -, @, tab or CR would run as a formula in a spreadsheet: prefix it. */
export function csvCell(value: string | number | null | undefined): string {
  let s = value === null || value === undefined ? '' : String(value);
  if (/^[=+\-@\t\r]/.test(s) && typeof value !== 'number') s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Phone digits as the duplicate check compares them: a US number with or without its 1. */
export function phoneKeys(digits: string): string[] {
  if (digits.length === 11 && digits.startsWith('1')) return [digits, digits.slice(1)];
  if (digits.length === 10) return [digits, `1${digits}`];
  return [digits];
}
