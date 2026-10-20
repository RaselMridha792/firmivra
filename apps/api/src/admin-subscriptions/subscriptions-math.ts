import {
  SUBSCRIPTION_PAYING_STATUSES,
  SUBSCRIPTION_STATUS_ORDER,
  type SubscriptionBillingCycle,
  type SubscriptionPlan,
  type SubscriptionRow,
  type SubscriptionSort,
  type SubscriptionStatus,
  type SubscriptionStatusFilter,
  type SubscriptionSuspensionKind,
  subscriptionAddDays,
  subscriptionAddMonths,
  subscriptionDaysBetween,
  subscriptionMonthlyCents,
  subscriptionPriceCents,
} from '@firmivra/types';

// The Subscriptions API's pure rules (docs/work/R60-subscriptions.md, "Subscriptions API"): UTC
// days, the row's derived dates and prices, the filters, sorting, churn, how an event's note keeps
// its reason and approver, and CSV cells. The contract's own helpers (prices, proration, previews)
// are imported, never copied, so the screen and the API answer the same numbers.

export const DAY_MS = 86_400_000;
/** `YYYY-MM-DD` of a time, as a UTC day. */
export const utcDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);
export const dayOf = (d: Date) => d.toISOString().slice(0, 10);
export const dayOrNull = (d: Date | null) => (d ? dayOf(d) : null);
/** A UTC day as the timestamp the subscription's day columns hold (midnight UTC). */
export const asDate = (day: string) => new Date(`${day}T00:00:00.000Z`);
export const iso = (d: Date | null) => (d ? d.toISOString() : null);

/** The days a summary or the table counts over: both given, or the current UTC month. */
export function periodOf(
  query: { from?: string | undefined; to?: string | undefined },
  today: string,
): { from: string; to: string } {
  if (query.from && query.to) return { from: query.from, to: query.to };
  const from = `${today.slice(0, 7)}-01`;
  return { from, to: subscriptionAddDays(subscriptionAddMonths(from, 1), -1) };
}

/** The period of the same length just before. */
export function previousPeriod(period: { from: string; to: string }): {
  from: string;
  to: string;
} {
  const length = subscriptionDaysBetween(period.from, period.to) + 1;
  const to = subscriptionAddDays(period.from, -1);
  return { from: subscriptionAddDays(to, -(length - 1)), to };
}

export const isPaying = (status: SubscriptionStatus) =>
  SUBSCRIPTION_PAYING_STATUSES.includes(status);

/** A plan move by the ladder: display order first, then the monthly base price. */
export function planChangeKind(
  from: Pick<SubscriptionPlan, 'displayOrder' | 'priceCents' | 'billingCycle'>,
  to: Pick<SubscriptionPlan, 'displayOrder' | 'priceCents' | 'billingCycle'>,
): 'UPGRADED' | 'DOWNGRADED' {
  if (to.displayOrder !== from.displayOrder)
    return to.displayOrder > from.displayOrder ? 'UPGRADED' : 'DOWNGRADED';
  return subscriptionMonthlyCents(to.priceCents, to.billingCycle) >=
    subscriptionMonthlyCents(from.priceCents, from.billingCycle)
    ? 'UPGRADED'
    : 'DOWNGRADED';
}

/** What the subscription's own columns say, as the row needs them (days are UTC days). */
export interface SubscriptionFacts {
  status: SubscriptionStatus;
  billingCycle: SubscriptionBillingCycle;
  seatsIncluded: number;
  seatsPurchased: number;
  locationsIncluded: number;
  locationsPurchased: number;
  priceCentsOverride: number | null;
  autoRenew: boolean;
  trialEndsOn: string | null;
  nextBillingOn: string | null;
  periodEnd: string | null;
  paidThroughOn: string | null;
  closedOn: string | null;
}

/** The next scheduled invoice: only while it renews (Active or Past Due with Auto-Renew on). */
export function nextBillingOf(
  s: Pick<SubscriptionFacts, 'status' | 'autoRenew' | 'nextBillingOn'>,
) {
  return (s.status === 'ACTIVE' || s.status === 'PAST_DUE') && s.autoRenew ? s.nextBillingOn : null;
}

/**
 * When access ends: a non-renewing subscription's paid-through day, a trial's end with Auto-Renew
 * off, an expired trial's end, or the day a canceled one closed.
 */
export function accessEndsOf(
  s: Pick<
    SubscriptionFacts,
    'status' | 'autoRenew' | 'trialEndsOn' | 'periodEnd' | 'paidThroughOn' | 'closedOn'
  >,
): string | null {
  switch (s.status) {
    case 'NON_RENEWING':
      return s.paidThroughOn ?? s.periodEnd;
    case 'TRIAL':
      return s.autoRenew ? null : s.trialEndsOn;
    case 'EXPIRED':
      return s.trialEndsOn;
    case 'CANCELLED':
      return s.closedOn;
    default:
      return null;
  }
}

/** The row's seats, locations and prices (per billing cycle) from the plan and the columns. */
export function pricesOf(
  plan: Pick<
    SubscriptionPlan,
    'priceCents' | 'billingCycle' | 'seatPriceCents' | 'locationPriceCents'
  >,
  s: Pick<
    SubscriptionFacts,
    | 'billingCycle'
    | 'seatsIncluded'
    | 'seatsPurchased'
    | 'locationsIncluded'
    | 'locationsPurchased'
    | 'priceCentsOverride'
  >,
) {
  const terms = {
    billingCycle: s.billingCycle,
    extraSeats: s.seatsPurchased,
    extraLocations: s.locationsPurchased,
  };
  const priceCents = subscriptionPriceCents(plan, { ...terms, baseCents: s.priceCentsOverride });
  return {
    seatsAllowed: s.seatsIncluded + s.seatsPurchased,
    locationsAllowed: s.locationsIncluded + s.locationsPurchased,
    listPriceCents: subscriptionPriceCents(plan, terms),
    priceCents,
    monthlyCents: subscriptionMonthlyCents(priceCents, s.billingCycle),
  };
}

/** Seats used ÷ allowed, whole percent; null while the rollup has no count. */
export const usageOf = (used: number | null, allowed: number) =>
  used === null ? null : allowed > 0 ? Math.round((used * 100) / allowed) : 0;

/** The status a suspended subscription goes back to: Trial if it never paid, else by Auto-Renew. */
export function reactivatedStatus(s: { paid: boolean; autoRenew: boolean }): SubscriptionStatus {
  if (!s.paid) return 'TRIAL';
  return s.autoRenew ? 'ACTIVE' : 'NON_RENEWING';
}

/**
 * The suspension's kind: the one its audit row kept, else (a job's suspension) NONPAYMENT when it
 * came from Past Due, else ADMIN.
 */
export function suspensionKindOf(
  kept: unknown,
  fromStatus: SubscriptionStatus | null,
): SubscriptionSuspensionKind {
  if (kept === 'PAUSE' || kept === 'ADMIN' || kept === 'NONPAYMENT') return kept;
  return fromStatus === 'PAST_DUE' ? 'NONPAYMENT' : 'ADMIN';
}

// ---------- The table ----------

/** Auto-Renew on, Active or Past Due, the next billing within 30 days from today. */
export const renewsSoon = (row: Pick<SubscriptionRow, 'nextBillingOn'>, today: string) =>
  row.nextBillingOn !== null &&
  row.nextBillingOn >= today &&
  row.nextBillingOn <= subscriptionAddDays(today, 30);

export function matchesStatus(
  row: Pick<SubscriptionRow, 'status' | 'nextBillingOn'>,
  filter: SubscriptionStatusFilter | undefined,
  today: string,
): boolean {
  if (!filter) return true;
  if (filter === 'PAYING') return isPaying(row.status);
  if (filter === 'RENEWING_SOON') return renewsSoon(row, today);
  return row.status === filter;
}

/** In force at any time in the period: started on or before its end, not ended before its start. */
export const inForce = (
  span: { startedOn: string; endedOn: string | null },
  period: { from: string; to: string },
) => span.startedOn <= period.to && (span.endedOn === null || span.endedOn >= period.from);

/** Every word of the search in the firm's name, slug, email or domain. */
export function matchesSearch(row: Pick<SubscriptionRow, 'firm'>, search: string | undefined) {
  const words = (search ?? '').toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  const hay = [row.firm.name, row.firm.slug, row.firm.email, row.firm.domain]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  return words.every((w) => hay.includes(w));
}

type Key = string | number | null;
const SORT_KEYS: Readonly<
  Record<SubscriptionSort, (row: SubscriptionRow, order: ReadonlyMap<string, number>) => Key>
> = {
  FIRM: (r) => r.firm.name.toLowerCase(),
  PLAN: (r, order) => order.get(r.plan.id) ?? Number.MAX_SAFE_INTEGER,
  PRICE: (r) => r.monthlyCents,
  SEATS: (r) => r.seatsAllowed,
  USAGE: (r) => r.usagePercent,
  NEXT_BILLING: (r) => r.nextBillingOn,
  STATUS: (r) => SUBSCRIPTION_STATUS_ORDER.indexOf(r.status),
  CREATED: (r) => r.createdAt,
};

/** The table's order: the key, unknown values last either way, then the firm name and the id. */
export function sortRows(
  rows: readonly SubscriptionRow[],
  sort: SubscriptionSort = 'FIRM',
  dir: 'asc' | 'desc' = 'asc',
  planOrder: ReadonlyMap<string, number> = new Map(),
): SubscriptionRow[] {
  const key = SORT_KEYS[sort];
  const sign = dir === 'desc' ? -1 : 1;
  const compare = (x: Key, y: Key) =>
    typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y));
  return [...rows].sort((a, b) => {
    const x = key(a, planOrder);
    const y = key(b, planOrder);
    if (x === null || y === null) {
      if (x !== y) return x === null ? 1 : -1;
    } else {
      const c = compare(x, y);
      if (c !== 0) return c * sign;
    }
    return a.firm.name.localeCompare(b.firm.name) || a.id.localeCompare(b.id);
  });
}

// ---------- Churn ----------

/** A history row as churn reads it. */
export interface StatusMove {
  subscriptionId: string;
  toStatus: SubscriptionStatus | null;
  at: number;
}

/**
 * Of the subscriptions paying when the period began (their last history row with a status before
 * it), those that moved to Canceled in it; the rate in basis points (0 with no base).
 */
export function churnOf(moves: readonly StatusMove[], period: { from: string; to: string }) {
  const start = asDate(period.from).getTime();
  const end = asDate(period.to).getTime() + DAY_MS;
  const last = new Map<string, StatusMove>();
  for (const m of [...moves].sort((a, b) => a.at - b.at)) {
    if (m.at < start && m.toStatus !== null) last.set(m.subscriptionId, m);
  }
  const base = new Set(
    [...last.values()].filter((m) => isPaying(m.toStatus!)).map((m) => m.subscriptionId),
  );
  const churned = new Set(
    moves
      .filter(
        (m) =>
          base.has(m.subscriptionId) && m.toStatus === 'CANCELLED' && m.at >= start && m.at < end,
      )
      .map((m) => m.subscriptionId),
  );
  return {
    base: base.size,
    churned: churned.size,
    rateBp: base.size ? Math.round((churned.size * 10_000) / base.size) : 0,
  };
}

// ---------- Event notes ----------

/**
 * The reason (and, for a negotiated price, who approved it) of an event no history row holds is
 * kept as B4's investigation note on the event's audit row: never in the audit metadata.
 */
export const APPROVER_LINE = '\n\nApproved by: ';
export const eventNote = (reason: string, approvedBy?: string | null) =>
  approvedBy ? `${reason}${APPROVER_LINE}${approvedBy}` : reason;
export function splitEventNote(body: string | null): {
  reason: string | null;
  approvedBy: string | null;
} {
  if (body === null) return { reason: null, approvedBy: null };
  const at = body.lastIndexOf(APPROVER_LINE);
  if (at < 0) return { reason: body, approvedBy: null };
  return { reason: body.slice(0, at), approvedBy: body.slice(at + APPROVER_LINE.length) || null };
}

/**
 * The current text of the first note on an audit row (the one this API wrote): B4 edits make a
 * new note that supersedes the last; a retracted note has no text.
 */
export function currentNote<
  T extends { id: string; supersedesNoteId: string | null; retractedAt: Date | null },
>(notes: readonly T[], byAge: (a: T, b: T) => number): T | null {
  const roots = notes.filter((n) => n.supersedesNoteId === null).sort(byAge);
  let head = roots[0];
  if (!head) return null;
  const next = new Map(notes.flatMap((n) => (n.supersedesNoteId ? [[n.supersedesNoteId, n]] : [])));
  for (let n = next.get(head.id); n; n = next.get(head.id)) head = n;
  return head.retractedAt ? null : head;
}

// ---------- CSV ----------

/** One CSV cell; a text cell that would run as a spreadsheet formula is quoted with `'`. */
export function csvCell(value: string | number | null | undefined): string {
  let s = value === null || value === undefined ? '' : String(value);
  if (/^[=+\-@\t\r]/.test(s) && typeof value !== 'number') s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
export const dollars = (cents: number | null) => (cents === null ? '' : (cents / 100).toFixed(2));
