import { z } from 'zod';
import { BillingInvoiceStatus } from '../admin-billing/schemas.js';
import { SearchText, text } from '../clients/text.js';
import {
  BusinessStatus,
  PlatformBillingCycle,
  PlatformPaymentMethod,
  PlatformPaymentStatus,
  PlatformSubscriptionChangeKind,
  PlatformSubscriptionStatus,
} from '../db-enums.js';

// Super Admin Subscriptions (R0 stage A `platform_plans`, `platform_plan_features` and
// `platform_firm_subscriptions`; B3's `platform_subscription_changes` and billing tables; the
// MRR rollup `platform_mrr_daily`; notes on this contract in docs/work/R60-subscriptions.md).
// Firmivra's own plans for firms: the KPI row, the subscriptions table, the detail panel (Overview,
// Usage, Billing, History, Notes) and its dialogs (docx §2 to §9).
// Routes: /api/v1/admin/subscriptions/... (the Super Admin site's session only).
// One row per firm (the database's unique `business_id`). Every change applies at once and writes
// a history row (`platform_subscription_changes`) or, where no change kind fits, an audit row of
// this module; both read back as the subscription's events. A subscription is billed through B3:
// its recurring schedule (`platform_recurring_invoices.subscription_id`) bills each period, and a
// change that moves money mid-period issues an invoice (charge) or a credit note (credit) at once.
// Money is integer cents (USD). Billing dates are `YYYY-MM-DD` UTC days; times are ISO with an
// offset. Responses are plain objects (a field the API adds later is dropped); requests are strict.

const DateTime = z.iso.datetime({ offset: true });
/** `YYYY-MM-DD`, a UTC day. */
const Day = z.iso.date();
const Id = z.uuid();

export const SubscriptionId = Id;
/** A `platform_plans` row. */
export const SubscriptionPlanId = Id;
/** A firm (`businesses.id`). */
export const SubscriptionFirmId = Id;

/** Several values in one query parameter: an array in, `a,b` on the wire, an array out. */
const listOf = <T extends z.ZodType>(item: T, max: number) =>
  z
    .preprocess(
      (value) => (typeof value === 'string' ? value.split(',').filter(Boolean) : value),
      z.array(item).max(max),
    )
    .optional();

/*
 * The platform tables' text check (`platform_text_ok`) refuses a few characters `text` allows:
 * the soft hyphen U+00AD, U+034F, U+17B4, U+17B5 and the line and paragraph separators U+2028 and
 * U+2029. It also needs one character it counts as visible: not a space, U+00A0, U+1680, U+2000
 * to U+200F, U+202F, U+205F, U+2800, U+3000 or a variation selector (U+FE00 to U+FE0F).
 */
const PLATFORM_REFUSED = new Set([0x00ad, 0x034f, 0x17b4, 0x17b5, 0x2028, 0x2029]);
/** Code points, so the check needs no character class with combining marks. */
const codePoints = (value: string) => Array.from(value, (char) => char.codePointAt(0) ?? 0);
const blank = (point: number) =>
  /\s/u.test(String.fromCodePoint(point)) ||
  point === 0x00a0 ||
  point === 0x1680 ||
  (point >= 0x2000 && point <= 0x200f) ||
  point === 0x202f ||
  point === 0x205f ||
  point === 0x2800 ||
  point === 0x3000 ||
  (point >= 0xfe00 && point <= 0xfe0f);

/** `text` that the platform tables also accept: trimmed, 1 to `max` characters. */
const platformText = (max: number, lines: 'one' | 'many' = 'one', empty = 'Enter a value') =>
  text(max, lines, empty)
    .refine(
      (value) => !codePoints(value).some((point) => PLATFORM_REFUSED.has(point)),
      'Remove the special characters',
    )
    .refine((value) => codePoints(value).some((point) => !blank(point)), empty);

/** A reason the history keeps (the database's limit for reasons: 1,000). */
const Reason = (empty = 'Add a reason.') => platformText(1000, 'many', empty);

const SEATS = 'Enter a whole number of seats.';
const Seats = z.number().int(SEATS).min(1, SEATS).max(10_000, SEATS);
const LOCATIONS = 'Enter 0 to 100 extra locations.';
const ExtraLocations = z.number().int(LOCATIONS).min(0, LOCATIONS).max(100, LOCATIONS);
const AMOUNT = 'Enter an amount between $0 and $10,000,000.';
const Money = z.number().int(AMOUNT).min(0, AMOUNT).max(1_000_000_000, AMOUNT);

// ---------- Labels and enums ----------

/** The database's seven statuses (`platform_firm_subscriptions.status`). */
export const SubscriptionStatus = PlatformSubscriptionStatus;
export type SubscriptionStatus = z.infer<typeof PlatformSubscriptionStatus>;
export const SUBSCRIPTION_STATUS_LABELS: Readonly<Record<SubscriptionStatus, string>> = {
  TRIAL: 'Trial',
  ACTIVE: 'Active',
  PAST_DUE: 'Past Due',
  SUSPENDED: 'Suspended',
  NON_RENEWING: 'Non-Renewing',
  EXPIRED: 'Expired',
  CANCELLED: 'Canceled',
};
/** The order of the Status filter and the table's sort. */
export const SUBSCRIPTION_STATUS_ORDER: readonly SubscriptionStatus[] = [
  'TRIAL',
  'ACTIVE',
  'PAST_DUE',
  'SUSPENDED',
  'NON_RENEWING',
  'EXPIRED',
  'CANCELLED',
];
/** Paid and not ended: counted in MRR (Past Due is still a live subscription). */
export const SUBSCRIPTION_PAYING_STATUSES: readonly SubscriptionStatus[] = [
  'ACTIVE',
  'PAST_DUE',
  'NON_RENEWING',
];
/** Plan, seat and location changes, and Pause / Suspend. */
export const SUBSCRIPTION_CHANGEABLE_STATUSES: readonly SubscriptionStatus[] = [
  'TRIAL',
  'ACTIVE',
  'PAST_DUE',
  'NON_RENEWING',
];
/** Reactivate: back from a suspension, or a restart of an ended subscription on a plan. */
export const SUBSCRIPTION_REACTIVATABLE_STATUSES: readonly SubscriptionStatus[] = [
  'SUSPENDED',
  'CANCELLED',
  'EXPIRED',
];

export const SubscriptionBillingCycle = PlatformBillingCycle;
export type SubscriptionBillingCycle = z.infer<typeof PlatformBillingCycle>;
export const SUBSCRIPTION_CYCLE_LABELS: Readonly<Record<SubscriptionBillingCycle, string>> = {
  MONTHLY: 'Monthly',
  ANNUAL: 'Annual',
};

/** A trial lasts 14 days (docx §8). */
export const SUBSCRIPTION_TRIAL_DAYS = 14;
/** Extend Trial adds 1 to 60 days at a time. */
export const SUBSCRIPTION_MAX_TRIAL_EXTENSION_DAYS = 60;

/**
 * The Status filter: a status, or one of the KPI cards' groups.
 * - PAYING: SUBSCRIPTION_PAYING_STATUSES (the MRR and ARR cards)
 * - RENEWING_SOON: Auto-Renew on, Active or Past Due, next billing within 30 days from today
 */
export const SubscriptionStatusFilter = z.enum([
  ...PlatformSubscriptionStatus.options,
  'PAYING',
  'RENEWING_SOON',
]);
export type SubscriptionStatusFilter = z.infer<typeof SubscriptionStatusFilter>;
export const SUBSCRIPTION_STATUS_FILTER_LABELS: Readonly<Record<SubscriptionStatusFilter, string>> =
  {
    ...SUBSCRIPTION_STATUS_LABELS,
    PAYING: 'Paying (MRR)',
    RENEWING_SOON: 'Renewing in 30 days',
  };

/**
 * Why a subscription is suspended (docx §14: never "Pause" and "Suspend" without a reason).
 * NONPAYMENT only from Past Due.
 */
export const SubscriptionSuspensionKind = z.enum(['PAUSE', 'ADMIN', 'NONPAYMENT']);
export type SubscriptionSuspensionKind = z.infer<typeof SubscriptionSuspensionKind>;
export const SUBSCRIPTION_SUSPENSION_LABELS: Readonly<Record<SubscriptionSuspensionKind, string>> =
  {
    PAUSE: 'Paused at the firm’s request',
    ADMIN: 'Administrative suspension',
    NONPAYMENT: 'Suspended for nonpayment',
  };

/** Where a client's request not to renew came from (stored in `cancel_request_source`). */
export const SubscriptionRequestSource = z.enum(['PHONE', 'EMAIL', 'SUPPORT', 'MEETING', 'OTHER']);
export type SubscriptionRequestSource = z.infer<typeof SubscriptionRequestSource>;
export const SUBSCRIPTION_REQUEST_SOURCE_LABELS: Readonly<
  Record<SubscriptionRequestSource, string>
> = {
  PHONE: 'Phone call',
  EMAIL: 'Email',
  SUPPORT: 'Support conversation',
  MEETING: 'Meeting',
  OTHER: 'Other',
};

/** The table's sort keys; the default is the firm name. */
export const SubscriptionSort = z.enum([
  'FIRM',
  'PLAN',
  'PRICE',
  'SEATS',
  'USAGE',
  'NEXT_BILLING',
  'STATUS',
  'CREATED',
]);
export type SubscriptionSort = z.infer<typeof SubscriptionSort>;

// ---------- Days ----------

const parseDay = (day: string) => Date.parse(`${day}T00:00:00.000Z`);
const isoDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** `day` plus `days` (UTC). */
export const subscriptionAddDays = (day: string, days: number): string =>
  isoDay(parseDay(day) + days * 86_400_000);

/** Whole days from `from` to `to` (negative when `to` is earlier). */
export const subscriptionDaysBetween = (from: string, to: string): number =>
  Math.round((parseDay(to) - parseDay(from)) / 86_400_000);

/** `day` plus `months`, on the same date or the month's last day (Jan 31 + 1 month: Feb 28). */
export function subscriptionAddMonths(day: string, months: number): string {
  const year = Number(day.slice(0, 4));
  const month = Number(day.slice(5, 7)) - 1;
  const date = Number(day.slice(8, 10));
  const last = new Date(Date.UTC(year, month + months + 1, 0)).getUTCDate();
  return isoDay(Date.UTC(year, month + months, Math.min(date, last)));
}

/** Months in one billing cycle. */
export const subscriptionCycleMonths = (cycle: SubscriptionBillingCycle): number =>
  cycle === 'ANNUAL' ? 12 : 1;

// ---------- Plans ----------

export const SubscriptionPlanFeature = z.object({ key: z.string(), label: z.string() });
export type SubscriptionPlanFeature = z.infer<typeof SubscriptionPlanFeature>;

/** A firm plan (`platform_plans`). Its prices are per its own billing cycle (the ladder: monthly). */
export const SubscriptionPlan = z.object({
  id: Id,
  /** SOLO_CORE, TEAM_PRO, …: the same in every environment. */
  code: z.string(),
  name: z.string(),
  /** The base price per the plan's billing cycle. */
  priceCents: z.number().int(),
  billingCycle: SubscriptionBillingCycle,
  includedSeats: z.number().int(),
  /** null: no fixed ceiling. */
  maxSeats: z.number().int().nullable(),
  /** Each seat above the included ones; null: the plan sells no extra seats. */
  seatPriceCents: z.number().int().nullable(),
  includedLocations: z.number().int(),
  /** Each location above the included ones; null: the plan sells none. */
  locationPriceCents: z.number().int().nullable(),
  displayOrder: z.number().int(),
  /** An inactive plan keeps its subscriptions and takes no new ones. */
  active: z.boolean(),
  /** Every feature included at this tier. */
  features: z.array(SubscriptionPlanFeature),
});
export type SubscriptionPlan = z.infer<typeof SubscriptionPlan>;

/** The seats a plan allows: its included seats, up to its ceiling when it sells extra seats. */
export function subscriptionSeatRange(
  plan: Pick<SubscriptionPlan, 'includedSeats' | 'maxSeats' | 'seatPriceCents'>,
): { min: number; max: number | null } {
  if (plan.seatPriceCents === null) return { min: plan.includedSeats, max: plan.includedSeats };
  return { min: plan.includedSeats, max: plan.maxSeats };
}

/**
 * A subscription's price for one of its billing cycles: the plan's base price (or the negotiated
 * base, `baseCents`) plus the extra seats and locations at the plan's rates, turned from the
 * plan's cycle to the subscription's (a year is 12 months; a month of an annual plan is a 12th,
 * rounded down). Seats or locations the plan does not sell add nothing.
 */
export function subscriptionPriceCents(
  plan: Pick<
    SubscriptionPlan,
    'priceCents' | 'billingCycle' | 'seatPriceCents' | 'locationPriceCents'
  >,
  terms: {
    billingCycle: SubscriptionBillingCycle;
    extraSeats?: number;
    extraLocations?: number;
    baseCents?: number | null;
  },
): number {
  const perPlanCycle =
    (terms.baseCents ?? plan.priceCents) +
    Math.max(0, terms.extraSeats ?? 0) * (plan.seatPriceCents ?? 0) +
    Math.max(0, terms.extraLocations ?? 0) * (plan.locationPriceCents ?? 0);
  if (terms.billingCycle === plan.billingCycle) return perPlanCycle;
  return terms.billingCycle === 'ANNUAL' ? perPlanCycle * 12 : Math.floor(perPlanCycle / 12);
}

/** The monthly equivalent of a price per billing cycle (an annual price ÷ 12, rounded down). */
export const subscriptionMonthlyCents = (
  priceCents: number,
  billingCycle: SubscriptionBillingCycle,
): number => (billingCycle === 'ANNUAL' ? Math.floor(priceCents / 12) : priceCents);

// ---------- The table ----------

/** The firm a subscription belongs to. Never its clients or documents. */
export const SubscriptionFirm = z.object({
  id: Id,
  name: z.string(),
  slug: z.string(),
  /** The firm's own status (Firms); a subscription change never sets it. */
  status: BusinessStatus,
  /** Its billing profile's contact email, else its first active owner's; null when neither. */
  email: z.string().nullable(),
  /** The website host from its application (`websiteHost`); null when none. */
  domain: z.string().nullable(),
});
export type SubscriptionFirm = z.infer<typeof SubscriptionFirm>;

const PlanRef = z.object({ id: Id, code: z.string(), name: z.string() });

/** One row of the table (and the head of the detail). */
export const SubscriptionRow = z.object({
  id: Id,
  firm: SubscriptionFirm,
  plan: PlanRef,
  billingCycle: SubscriptionBillingCycle,
  status: SubscriptionStatus,
  /** The plan's included seats when the plan was set (`seats_included`). */
  seatsIncluded: z.number().int(),
  /** Seats bought above them (`seats_purchased`). */
  extraSeats: z.number().int(),
  /** seatsIncluded + extraSeats. */
  seatsAllowed: z.number().int(),
  /**
   * The firm's staff logins from the daily firm rollup (`platform_firm_metrics_daily.total_users`,
   * the latest day); null until the platform's job has written one.
   */
  seatsUsed: z.number().int().nullable(),
  /** seatsUsed ÷ seatsAllowed, whole percent; null when seatsUsed is. */
  usagePercent: z.number().int().nullable(),
  locationsIncluded: z.number().int(),
  /** The Additional Location add-on (`locations_purchased`). */
  extraLocations: z.number().int(),
  locationsAllowed: z.number().int(),
  /** Per billing cycle: the plan's base price with the extra seats and locations. */
  listPriceCents: z.number().int(),
  /** A negotiated base price in the plan's cycle (`price_cents_override`); null: the plan's. */
  baseOverrideCents: z.number().int().nullable(),
  /** Per billing cycle, as billed (`subscriptionPriceCents` with the negotiated base). */
  priceCents: z.number().int(),
  /** The monthly equivalent of priceCents; counted in MRR only while paying. */
  monthlyCents: z.number().int(),
  /** Unused credit on the firm's issued credit notes (B3: Available and Partially Applied). */
  creditCents: z.number().int(),
  autoRenew: z.boolean(),
  /** The next scheduled invoice; null when none (trial, non-renewing, suspended, ended). */
  nextBillingOn: Day.nullable(),
  /**
   * When access ends: a non-renewing subscription's paid-through day, a trial's end with
   * Auto-Renew off, an expired trial's end, or the day a canceled one closed. Null otherwise.
   */
  accessEndsOn: Day.nullable(),
  /** While in Trial. */
  trialEndsOn: Day.nullable(),
  /** An approved support access grant to the firm that is still open (R8), if any. */
  supportAccessUntil: DateTime.nullable(),
  createdAt: DateTime,
  updatedAt: DateTime,
});
export type SubscriptionRow = z.infer<typeof SubscriptionRow>;

const Filters = {
  /** Firm name, slug, email or domain (never anything inside the firm). */
  search: SearchText.optional(),
  planId: Id.optional(),
  status: SubscriptionStatusFilter.optional(),
  billingCycle: SubscriptionBillingCycle.optional(),
  /**
   * The reporting period, both days or neither (the current UTC month): subscriptions in force at
   * any time in it, started on or before `to` and not ended before `from`.
   */
  from: Day.optional(),
  to: Day.optional(),
};
const bothOrNeither = (query: { from?: string | undefined; to?: string | undefined }) =>
  (query.from === undefined) === (query.to === undefined);
const BOTH_DAYS = { message: 'Choose a start and an end date.', path: ['to'] };
const inOrder = (query: { from?: string | undefined; to?: string | undefined }) =>
  !query.from || !query.to || query.from <= query.to;
const IN_ORDER = { message: 'The start date must be on or before the end date.', path: ['to'] };

export const SubscriptionsQuery = z
  .strictObject({
    ...Filters,
    sort: SubscriptionSort.optional(),
    dir: z.enum(['asc', 'desc']).optional(),
    page: z.coerce.number().int().min(1).optional(),
    /** 25 by default. */
    pageSize: z.coerce.number().int().min(1).max(100).optional(),
  })
  .refine(bothOrNeither, BOTH_DAYS)
  .refine(inOrder, IN_ORDER);
export type SubscriptionsQuery = z.input<typeof SubscriptionsQuery>;

export const SubscriptionPage = z.object({
  items: z.array(SubscriptionRow),
  total: z.number().int(),
  /** Every subscription, before filters: tells "none yet" from "none match". */
  all: z.number().int(),
  page: z.number().int(),
  pageSize: z.number().int(),
});
export type SubscriptionPage = z.infer<typeof SubscriptionPage>;

/**
 * Export Subscription Data: the CSV download (subscription and billing metadata only: firm,
 * email, domain, plan, cycle, status, list and billed price, monthly, seats used and allowed,
 * extra locations, next billing, access end, Auto-Renew, negotiated price; cells that would run
 * as a spreadsheet formula are quoted). With `ids`, exactly those; otherwise the table's filters.
 */
export const SubscriptionExportQuery = z
  .strictObject({ ...Filters, ids: listOf(Id, 100) })
  .refine(bothOrNeither, BOTH_DAYS)
  .refine(inOrder, IN_ORDER);
export type SubscriptionExportQuery = z.input<typeof SubscriptionExportQuery>;

// ---------- The KPI row ----------

/** A figure now and on `comparedWith` (30 days ago); `previous` null when it isn't known. */
export const SubscriptionFigure = z.object({
  value: z.number().int(),
  previous: z.number().int().nullable(),
});
export type SubscriptionFigure = z.infer<typeof SubscriptionFigure>;

/** The churn period, both days or neither (the current UTC month). */
export const SubscriptionSummaryQuery = z
  .strictObject({ from: Day.optional(), to: Day.optional() })
  .refine(bothOrNeither, BOTH_DAYS)
  .refine(inOrder, IN_ORDER);
export type SubscriptionSummaryQuery = z.input<typeof SubscriptionSummaryQuery>;

/**
 * The seven cards. Counts and MRR are now; `previous` is the MRR rollup's row for `comparedWith`
 * (`platform_mrr_daily`: active, trial and past-due counts and MRR), null without a row.
 * - mrrCents: the paying subscriptions' monthlyCents; arrCents is 12 times it
 * - renewals: Auto-Renew on, Active or Past Due, next billing in the next 30 days; `previous`
 *   counts the subscriptions renewed (RENEWED history rows) in the 30 days before today
 * - churn: of the subscriptions paying when the period began (their last history row before it),
 *   those that moved to Canceled in it; the rate in basis points (0 with no base), and the same
 *   for the period of the same length just before (`previousRateBp` null with no base)
 */
export const SubscriptionSummary = z.object({
  from: Day,
  to: Day,
  previousFrom: Day,
  previousTo: Day,
  /** Today − 30 days, the day the `previous` figures are from. */
  comparedWith: Day,
  active: SubscriptionFigure,
  trial: SubscriptionFigure,
  mrrCents: SubscriptionFigure,
  arrCents: SubscriptionFigure,
  pastDue: SubscriptionFigure,
  renewals: SubscriptionFigure,
  churn: z.object({
    /** Basis points (10,000 = 100%). */
    rateBp: z.number().int(),
    previousRateBp: z.number().int().nullable(),
    churned: z.number().int(),
    base: z.number().int(),
  }),
});
export type SubscriptionSummary = z.infer<typeof SubscriptionSummary>;

// ---------- Reference data ----------

/** The plans (display order) and today, for the dialogs and their previews. */
export const SubscriptionMeta = z.object({
  /** Today as a UTC day: the previews' "today". */
  today: Day,
  trialDays: z.number().int(),
  plans: z.array(SubscriptionPlan),
});
export type SubscriptionMeta = z.infer<typeof SubscriptionMeta>;

/** An approved firm (Active or Pending Setup) with no subscription yet, for Add Subscription. */
export const SubscriptionAvailableFirm = z.object({
  id: Id,
  name: z.string(),
  slug: z.string(),
  status: BusinessStatus,
  email: z.string().nullable(),
  /** Only an Active firm gets billing documents, so only it can start on a paid plan. */
  canBill: z.boolean(),
});
export type SubscriptionAvailableFirm = z.infer<typeof SubscriptionAvailableFirm>;
/** By firm name. */
export const SubscriptionAvailableFirmList = z.object({
  items: z.array(SubscriptionAvailableFirm),
});
export type SubscriptionAvailableFirmList = z.infer<typeof SubscriptionAvailableFirmList>;

// ---------- The detail panel ----------

/** One of the firm's issued invoices (B3), as the Billing tab lists it. */
export const SubscriptionInvoice = z.object({
  id: Id,
  /** "INV-1001", given by the database. */
  number: z.string(),
  issueDate: Day,
  dueDate: Day,
  totalCents: z.number().int(),
  /** What is still owed: total − paid − credited. */
  balanceCents: z.number().int(),
  /** As Billing shows it (Pending, Overdue, Paid, …). */
  status: BillingInvoiceStatus,
  /** Its first line ("Team Pro (Monthly)"). */
  description: z.string(),
  /** The invoice is for this subscription (`subscription_id`). */
  forSubscription: z.boolean(),
  sentAt: DateTime.nullable(),
  /** Why its email did not go out (Billing's emails wait for their templates). */
  sendError: z.string().nullable(),
});
export type SubscriptionInvoice = z.infer<typeof SubscriptionInvoice>;

/** A payment on one of the firm's invoices (B3), succeeded or failed. */
export const SubscriptionPayment = z.object({
  id: Id,
  invoiceId: Id,
  invoiceNumber: z.string(),
  paidOn: Day,
  amountCents: z.number().int(),
  refundedCents: z.number().int(),
  method: PlatformPaymentMethod,
  status: PlatformPaymentStatus,
  /** The processor's id or the check number. */
  reference: z.string().nullable(),
  /** A failed payment's reason, as far as it may be shown. */
  failureReason: z.string().nullable(),
});
export type SubscriptionPayment = z.infer<typeof SubscriptionPayment>;

/**
 * What an event is. The first nine are history rows (`platform_subscription_changes.kind`), written
 * by this API, Billing and the platform's jobs; the rest are audit rows of this module, for the
 * actions no change kind fits.
 */
export const SubscriptionEventAction = z.enum([
  ...PlatformSubscriptionChangeKind.options,
  'TRIAL_EXTENDED',
  'LOCATIONS_CHANGED',
  'PRICE_CHANGED',
  'BILLING_DATE_CHANGED',
  'CANCEL_REVERSED',
  'NOTE_ADDED',
  'EXPORTED',
]);
export type SubscriptionEventAction = z.infer<typeof SubscriptionEventAction>;

/** The History tab shows LIFECYCLE and BILLING; the Activity Log shows every event. */
export const SubscriptionEventCategory = z.enum(['LIFECYCLE', 'BILLING', 'NOTE', 'ACCESS']);
export type SubscriptionEventCategory = z.infer<typeof SubscriptionEventCategory>;
export const SUBSCRIPTION_EVENT_CATEGORY: Readonly<
  Record<SubscriptionEventAction, SubscriptionEventCategory>
> = {
  CREATED: 'LIFECYCLE',
  UPGRADED: 'LIFECYCLE',
  DOWNGRADED: 'LIFECYCLE',
  SEATS_CHANGED: 'LIFECYCLE',
  CYCLE_CHANGED: 'LIFECYCLE',
  STATUS_CHANGED: 'LIFECYCLE',
  RENEWED: 'BILLING',
  CANCEL_REQUESTED: 'LIFECYCLE',
  CANCELED: 'LIFECYCLE',
  TRIAL_EXTENDED: 'LIFECYCLE',
  LOCATIONS_CHANGED: 'LIFECYCLE',
  PRICE_CHANGED: 'BILLING',
  BILLING_DATE_CHANGED: 'BILLING',
  CANCEL_REVERSED: 'LIFECYCLE',
  NOTE_ADDED: 'NOTE',
  EXPORTED: 'ACCESS',
};

/** One immutable history or audit entry: who, when, old and new values, reason and amount. */
export const SubscriptionEvent = z.object({
  /** The history row's or the audit row's id. */
  id: Id,
  source: z.enum(['CHANGE', 'AUDIT']),
  action: SubscriptionEventAction,
  /** When it took effect (a history row's `effective_at`, an audit row's time). */
  at: DateTime,
  /** A team member, or the platform (Billing's runs, the platform's jobs). */
  actor: z.object({ kind: z.enum(['USER', 'SYSTEM']), name: z.string() }),
  /** Plan names at the time. */
  fromPlan: z.string().nullable(),
  toPlan: z.string().nullable(),
  fromStatus: SubscriptionStatus.nullable(),
  toStatus: SubscriptionStatus.nullable(),
  /** Seats allowed. */
  fromSeats: z.number().int().nullable(),
  toSeats: z.number().int().nullable(),
  /** LOCATIONS_CHANGED: extra locations. */
  fromLocations: z.number().int().nullable(),
  toLocations: z.number().int().nullable(),
  /** TRIAL_EXTENDED: the trial's end; BILLING_DATE_CHANGED: the next billing day. */
  fromDay: Day.nullable(),
  toDay: Day.nullable(),
  /** PRICE_CHANGED: the negotiated base price (null: the plan's). */
  fromCents: z.number().int().nullable(),
  toCents: z.number().int().nullable(),
  reason: z.string().nullable(),
  /** PRICE_CHANGED: who approved it. */
  approvedBy: z.string().nullable(),
  /** Money billed by the change: a prorated charge, or a credit (negative); null when none. */
  amountCents: z.number().int().nullable(),
  /** History rows: the subscription's MRR after it (null on rows from before r0_mrr_history). */
  mrrCents: z.number().int().nullable(),
});
export type SubscriptionEvent = z.infer<typeof SubscriptionEvent>;

/** The line an event reads as (the History tab's and the Activity Log's "Action"). */
export function subscriptionEventText(event: SubscriptionEvent): string {
  const from = event.fromStatus;
  const to = event.toStatus;
  switch (event.action) {
    case 'CREATED':
      return to === 'TRIAL' ? 'Trial started' : 'Subscription started';
    case 'UPGRADED':
      return 'Plan upgraded';
    case 'DOWNGRADED':
      return 'Plan downgraded';
    case 'SEATS_CHANGED':
      return 'Seats changed';
    case 'CYCLE_CHANGED':
      return 'Billing cycle changed';
    case 'STATUS_CHANGED':
      if (from === 'TRIAL' && to === 'ACTIVE') return 'Converted to paid';
      if (to === 'EXPIRED') return 'Trial expired';
      if (to === 'SUSPENDED') return 'Suspended';
      if (to === 'PAST_DUE') return 'Payment failed';
      if (to === 'CANCELLED') return 'Subscription ended';
      if (from === 'NON_RENEWING' && to === 'ACTIVE') return 'Cancellation reversed';
      if (from === 'PAST_DUE' && to === 'ACTIVE') return 'Payment received';
      if (from && SUBSCRIPTION_REACTIVATABLE_STATUSES.includes(from)) return 'Reactivated';
      return to ? `Status changed to ${SUBSCRIPTION_STATUS_LABELS[to]}` : 'Status changed';
    case 'RENEWED':
      return 'Renewed';
    case 'CANCEL_REQUESTED':
      return 'Auto-Renew turned off';
    case 'CANCELED':
      return 'Subscription canceled';
    case 'TRIAL_EXTENDED':
      return 'Trial extended';
    case 'LOCATIONS_CHANGED':
      return 'Locations changed';
    case 'PRICE_CHANGED':
      return event.toCents === null ? 'Negotiated price removed' : 'Negotiated price set';
    case 'BILLING_DATE_CHANGED':
      return 'Billing date changed';
    case 'CANCEL_REVERSED':
      return 'Cancellation reversed';
    case 'NOTE_ADDED':
      return 'Internal note added';
    case 'EXPORTED':
      return 'Subscription data exported';
  }
}

/**
 * An internal note (never shown to the firm). Kept as B4's investigation note on this module's
 * `subscription.note_added` audit row: it never changes.
 */
export const SubscriptionNote = z.object({
  id: Id,
  body: z.string(),
  author: z.string(),
  createdAt: DateTime,
});
export type SubscriptionNote = z.infer<typeof SubscriptionNote>;

/** The detail panel and every dialog that needs the subscription. */
export const SubscriptionRecord = SubscriptionRow.extend({
  /** Today as a UTC day, for the previews. */
  today: Day,
  /** When it started: paid start, else trial start, else creation. */
  startedOn: Day,
  currentPeriodStart: Day.nullable(),
  currentPeriodEnd: Day.nullable(),
  /** Paid through (`paid_through_date`): access continues to here when it does not renew. */
  paidThroughOn: Day.nullable(),
  trial: z
    .object({
      startedOn: Day,
      endsOn: Day,
      /** Days from today to the end, 0 once ended. */
      daysLeft: z.number().int(),
      /** When it became paid; null while in Trial or when it expired. */
      convertedOn: Day.nullable(),
    })
    .nullable(),
  /** Auto-Renew turned off at the client's request (`cancel_*`), while it stands. */
  cancellation: z
    .object({ requestedAt: DateTime, source: SubscriptionRequestSource, notes: z.string() })
    .nullable(),
  /** While Suspended (`suspended_at`, `suspended_reason`). */
  suspension: z
    .object({ kind: SubscriptionSuspensionKind, since: DateTime, reason: z.string() })
    .nullable(),
  /** Once Canceled (`closed_at`, `closed_reason`). */
  closure: z.object({ closedAt: DateTime, reason: z.string() }).nullable(),
  /** While Past Due: since when, and the failed payments on the firm's open invoices. */
  pastDue: z
    .object({
      since: DateTime.nullable(),
      failedPayments: z.number().int(),
      lastFailure: z.object({ on: Day, reason: z.string() }).nullable(),
    })
    .nullable(),
  /** The owner of the Sales record linked to this subscription or firm (read-only here). */
  accountOwner: z.object({ opportunityId: Id, name: z.string() }).nullable(),
  /** The balance of the firm's open invoices. */
  amountDueCents: z.number().int(),
  /** The firm's issued invoices, newest first (at most 50). */
  invoices: z.array(SubscriptionInvoice),
  /** Payments on them, newest first (at most 50). */
  payments: z.array(SubscriptionPayment),
  /** History and audit events, newest first (at most 500). */
  events: z.array(SubscriptionEvent),
  /** Newest first. */
  notes: z.array(SubscriptionNote),
});
export type SubscriptionRecord = z.infer<typeof SubscriptionRecord>;

// ---------- Previews (the dialogs and the API use the same numbers) ----------

/** A billing period's length in days: its own when known, else 30 or 365. */
function periodDays(
  start: string | null,
  end: string | null,
  cycle: SubscriptionBillingCycle,
): number {
  if (start && end) return Math.max(1, subscriptionDaysBetween(start, end));
  return cycle === 'ANNUAL' ? 365 : 30;
}

/**
 * The money a mid-period change moves, charged today (positive, an invoice) or credited (negative,
 * a credit note). Nothing during a trial or without a current period. Same cycle: the price
 * difference for the days left. New cycle: the new cycle's full price less the unused part of the
 * current one, and the next billing moves to one new cycle from today.
 */
export function subscriptionProration(input: {
  today: string;
  status: SubscriptionStatus;
  periodStart: string | null;
  /** The current period's end: the next billing day. */
  periodEnd: string | null;
  from: { priceCents: number; billingCycle: SubscriptionBillingCycle };
  to: { priceCents: number; billingCycle: SubscriptionBillingCycle };
}): { amountCents: number; nextBillingOn: string | null } {
  const { today, periodStart, periodEnd, from, to } = input;
  if (input.status === 'TRIAL' || !periodEnd) return { amountCents: 0, nextBillingOn: periodEnd };
  const days = periodDays(periodStart, periodEnd, from.billingCycle);
  const left = Math.min(Math.max(0, subscriptionDaysBetween(today, periodEnd)), days);
  if (from.billingCycle === to.billingCycle)
    return {
      amountCents: Math.round(((to.priceCents - from.priceCents) * left) / days),
      nextBillingOn: periodEnd,
    };
  return {
    amountCents: to.priceCents - Math.round((from.priceCents * left) / days),
    nextBillingOn: subscriptionAddMonths(today, subscriptionCycleMonths(to.billingCycle)),
  };
}

/** What a preview needs of the subscription (a SubscriptionRecord fits). */
export type SubscriptionPricing = Pick<
  SubscriptionRecord,
  | 'status'
  | 'billingCycle'
  | 'seatsAllowed'
  | 'seatsUsed'
  | 'extraLocations'
  | 'baseOverrideCents'
  | 'priceCents'
  | 'currentPeriodStart'
  | 'nextBillingOn'
> & { plan: { id: string } };

export interface SubscriptionChangePreview {
  planId: string;
  billingCycle: SubscriptionBillingCycle;
  seats: number;
  extraSeats: number;
  extraLocations: number;
  /** Extra locations the new plan does not sell (removed with the change). */
  droppedLocations: number;
  /** A plan change clears the negotiated base price. */
  baseOverrideCents: number | null;
  /** Per the new billing cycle. */
  priceCents: number;
  monthlyCents: number;
  /** subscriptionProration's amount: charged (positive) or credited (negative) today. */
  amountCents: number;
  nextBillingOn: string | null;
  /** The error the API would answer, or null. */
  blocked: 'SEATS_IN_USE' | 'SEATS_OUT_OF_RANGE' | 'LOCATIONS_NOT_OFFERED' | null;
}

/**
 * A plan, cycle, seat or location change: the new terms, the price and the money it moves today,
 * shown before confirming (docx §9). The seats on a new plan: the current ones (or those in use,
 * if more) within the plan's range.
 */
export function previewSubscriptionChange(
  sub: SubscriptionPricing,
  plan: SubscriptionPlan,
  change: { billingCycle?: SubscriptionBillingCycle; seats?: number; extraLocations?: number },
  today: string,
): SubscriptionChangePreview {
  const range = subscriptionSeatRange(plan);
  const used = sub.seatsUsed ?? 0;
  const ceiling = range.max ?? Number.POSITIVE_INFINITY;
  const seats = change.seats ?? Math.min(Math.max(range.min, sub.seatsAllowed, used), ceiling);
  const wanted = change.extraLocations ?? sub.extraLocations;
  const extraLocations = plan.locationPriceCents === null ? 0 : wanted;
  const planChanged = plan.id !== sub.plan.id;
  const baseOverrideCents = planChanged ? null : sub.baseOverrideCents;
  const billingCycle = change.billingCycle ?? sub.billingCycle;
  const extraSeats = Math.max(0, seats - plan.includedSeats);
  const priceCents = subscriptionPriceCents(plan, {
    billingCycle,
    extraSeats,
    extraLocations,
    baseCents: baseOverrideCents,
  });
  const { amountCents, nextBillingOn } = subscriptionProration({
    today,
    status: sub.status,
    periodStart: sub.currentPeriodStart,
    periodEnd: sub.nextBillingOn,
    from: { priceCents: sub.priceCents, billingCycle: sub.billingCycle },
    to: { priceCents, billingCycle },
  });
  let blocked: SubscriptionChangePreview['blocked'] = null;
  if (used > ceiling || seats < used) blocked = 'SEATS_IN_USE';
  else if (seats < range.min || seats > ceiling) blocked = 'SEATS_OUT_OF_RANGE';
  else if (change.extraLocations !== undefined && change.extraLocations > 0 && !extraLocations)
    blocked = 'LOCATIONS_NOT_OFFERED';
  return {
    planId: plan.id,
    billingCycle,
    seats,
    extraSeats,
    extraLocations,
    droppedLocations: Math.max(0, wanted - extraLocations),
    baseOverrideCents,
    priceCents,
    monthlyCents: subscriptionMonthlyCents(priceCents, billingCycle),
    amountCents,
    nextBillingOn,
    blocked,
  };
}

/**
 * Moving the next billing day: the days added (charged, positive) or removed (credited, negative)
 * at the current price per day of the period.
 */
export function subscriptionBillingDateCents(
  sub: Pick<
    SubscriptionRecord,
    'priceCents' | 'billingCycle' | 'currentPeriodStart' | 'nextBillingOn'
  >,
  date: string,
): number {
  if (!sub.nextBillingOn) return 0;
  const days = periodDays(sub.currentPeriodStart, sub.nextBillingOn, sub.billingCycle);
  return Math.round((sub.priceCents * subscriptionDaysBetween(sub.nextBillingOn, date)) / days);
}

// ---------- Changes ----------

/** A billing document a change issued (B3), for the result line ("An invoice for $88.50 is open"). */
export const SubscriptionDocument = z.object({
  id: Id,
  /** "INV-1003" or "CN-1002". */
  number: z.string(),
  totalCents: z.number().int(),
});
export type SubscriptionDocument = z.infer<typeof SubscriptionDocument>;

/** What every change answers: the row after it and the documents it issued. */
export const SubscriptionResult = z.object({
  subscription: SubscriptionRow,
  /** A charge (first period, prorated change, added days); sent like Billing's invoices. */
  invoice: SubscriptionDocument.nullable(),
  /** A credit (prorated change, removed days): an Available credit note for the firm. */
  creditNote: SubscriptionDocument.nullable(),
});
export type SubscriptionResult = z.infer<typeof SubscriptionResult>;

/**
 * Add Subscription and Start Trial for Firm, for an approved firm with none (409
 * ALREADY_SUBSCRIBED; 422 FIRM_NOT_AVAILABLE). TRIAL: 14 days from today, nothing billed. PAID:
 * Active from today, its recurring schedule made and the first period's invoice issued (409
 * FIRM_NOT_BILLABLE unless the firm is Active). Seats within the plan's range (422
 * SEATS_OUT_OF_RANGE); extra locations only on a plan that sells them (422
 * LOCATIONS_NOT_OFFERED); an inactive plan is 422 PLAN_INACTIVE.
 */
export const CreateSubscriptionRequest = z.strictObject({
  firmId: Id,
  mode: z.enum(['TRIAL', 'PAID']),
  planId: Id,
  billingCycle: SubscriptionBillingCycle,
  seats: Seats,
  extraLocations: ExtraLocations.default(0),
});
export type CreateSubscriptionRequest = z.input<typeof CreateSubscriptionRequest>;

/**
 * Change Plan, now (UPGRADED or DOWNGRADED by the plans' display order; CYCLE_CHANGED when the
 * cycle changes): the seats as `previewSubscriptionChange` sets them (422 SEATS_IN_USE when the
 * plan holds fewer than the firm uses), extra locations the plan doesn't sell are removed, the
 * negotiated price is cleared, the recurring schedule takes the new price, and the prorated
 * difference is invoiced or credited. 422 NO_CHANGE for the same plan and cycle.
 */
export const ChangeSubscriptionPlanRequest = z.strictObject({
  planId: Id,
  billingCycle: SubscriptionBillingCycle,
});
export type ChangeSubscriptionPlanRequest = z.input<typeof ChangeSubscriptionPlanRequest>;

/** Manage Seats, now (SEATS_CHANGED); prorated as a plan change. */
export const UpdateSubscriptionSeatsRequest = z.strictObject({ seats: Seats });
export type UpdateSubscriptionSeatsRequest = z.input<typeof UpdateSubscriptionSeatsRequest>;

/** The Additional Location add-on, now (LOCATIONS_CHANGED); prorated as a plan change. */
export const UpdateSubscriptionLocationsRequest = z.strictObject({
  extraLocations: ExtraLocations,
});
export type UpdateSubscriptionLocationsRequest = z.input<typeof UpdateSubscriptionLocationsRequest>;

/** Extend Trial: 1 to 60 more days, with the reason the history keeps (TRIAL_EXTENDED). */
export const ExtendSubscriptionTrialRequest = z.strictObject({
  days: z
    .number()
    .int('Add between 1 and 60 days.')
    .min(1, 'Add between 1 and 60 days.')
    .max(SUBSCRIPTION_MAX_TRIAL_EXTENSION_DAYS, 'Add between 1 and 60 days.'),
  reason: Reason('Add a reason for the extension.'),
});
export type ExtendSubscriptionTrialRequest = z.input<typeof ExtendSubscriptionTrialRequest>;

/**
 * Convert to Paid: Trial to Active today on the plan and cycle chosen (STATUS_CHANGED), its
 * recurring schedule made and the first period's invoice issued (409 FIRM_NOT_BILLABLE unless the
 * firm is Active; 422 SEATS_IN_USE as a plan change).
 */
export const ConvertSubscriptionRequest = z.strictObject({
  planId: Id,
  billingCycle: SubscriptionBillingCycle,
});
export type ConvertSubscriptionRequest = z.input<typeof ConvertSubscriptionRequest>;

/**
 * Auto-Renew off and Cancel at Period End, one controlled client request (docx §6): Active becomes
 * Non-Renewing with access to the paid-through day, a Trial stays a Trial that won't convert
 * (CANCEL_REQUESTED). The recurring schedule ends with the period. 409 RENEWAL_ALREADY_OFF.
 */
export const TurnOffAutoRenewRequest = z.strictObject({
  confirmed: z.literal(true, 'Confirm that the client asked for this.'),
  source: SubscriptionRequestSource,
  notes: Reason('Add a note about the request.'),
});
export type TurnOffAutoRenewRequest = z.input<typeof TurnOffAutoRenewRequest>;

/**
 * Reverse Cancellation: Auto-Renew back on only when chosen here (docx §6.9). Non-Renewing
 * becomes Active (STATUS_CHANGED), a Trial converts at its end again (CANCEL_REVERSED). 409
 * RENEWAL_ALREADY_ON when Auto-Renew is on.
 */
export const ReverseCancellationRequest = z.strictObject({
  autoRenewOn: z.literal(true, 'Choose to turn Auto-Renew back on to reverse the cancellation.'),
  reason: Reason('Add a reason for the reversal.'),
});
export type ReverseCancellationRequest = z.input<typeof ReverseCancellationRequest>;

/**
 * Pause / Suspend, now (STATUS_CHANGED): access restricted, data kept, the recurring schedule
 * paused. 422 NONPAYMENT_NOT_PAST_DUE for a nonpayment suspension of a subscription not Past Due.
 */
export const SuspendSubscriptionRequest = z.strictObject({
  kind: SubscriptionSuspensionKind,
  reason: Reason(),
});
export type SuspendSubscriptionRequest = z.input<typeof SuspendSubscriptionRequest>;

/**
 * Reactivate (STATUS_CHANGED). Suspended: back to Active (Non-Renewing when Auto-Renew is off)
 * once nothing is due (409 BALANCE_DUE: record the payment in Billing first); a nonpayment
 * suspension needs `paymentConfirmed` (422 PAYMENT_CONFIRMATION_REQUIRED). Canceled or Expired: a
 * restart today on `planId` and `billingCycle` (422 PLAN_REQUIRED without them), with its first
 * invoice (409 FIRM_NOT_BILLABLE unless the firm is Active).
 */
export const ReactivateSubscriptionRequest = z
  .strictObject({
    reason: Reason(),
    paymentConfirmed: z.boolean().default(false),
    planId: Id.optional(),
    billingCycle: SubscriptionBillingCycle.optional(),
  })
  .refine((body) => (body.planId === undefined) === (body.billingCycle === undefined), {
    message: 'Choose a plan and a billing cycle.',
    path: ['planId'],
  });
export type ReactivateSubscriptionRequest = z.input<typeof ReactivateSubscriptionRequest>;

/**
 * A negotiated base price (`price_cents_override`, in the plan's billing cycle) or, with null, back
 * to the plan's (PRICE_CHANGED). The recurring schedule takes the new price from the next period;
 * nothing is prorated. Not while Canceled (409 STATUS_NOT_ALLOWED). 422 NO_CHANGE when the same.
 */
export const SetSubscriptionPriceRequest = z
  .strictObject({
    baseCents: Money.nullable(),
    reason: Reason(),
    /** Who approved it: needed for a price, not for going back to the plan's. */
    approvedBy: platformText(100, 'one', 'Enter who approved it.').optional(),
  })
  .refine((body) => body.baseCents === null || body.approvedBy !== undefined, {
    message: 'Enter who approved it.',
    path: ['approvedBy'],
  });
export type SetSubscriptionPriceRequest = z.input<typeof SetSubscriptionPriceRequest>;

/**
 * Change Billing Date: a day after today and within one billing cycle of it (422
 * BILLING_DATE_OUT_OF_RANGE), Active or Past Due with a next billing day (409 NO_BILLING_DATE).
 * The period, the paid-through day and the schedule's next invoice move to it; the days added are
 * invoiced, the days removed credited (`subscriptionBillingDateCents`).
 */
export const ChangeBillingDateRequest = z.strictObject({
  date: Day,
  reason: Reason(),
});
export type ChangeBillingDateRequest = z.input<typeof ChangeBillingDateRequest>;

/**
 * Close Account, today (CANCELED): Canceled with the reason, Auto-Renew off, the recurring
 * schedule canceled; the data stays under the retention policy. Not a non-renewal (that is Cancel
 * at Period End). `confirmName` is the firm's name, any case (422 CONFIRM_NAME_MISMATCH). The
 * firm's own status (Firms) does not change here.
 */
export const CloseSubscriptionRequest = z.strictObject({
  reason: Reason(),
  confirmName: platformText(200, 'one', 'Type the firm name exactly as shown.'),
  impactReviewed: z.literal(true, 'Confirm you reviewed the data and access impact.'),
});
export type CloseSubscriptionRequest = z.input<typeof CloseSubscriptionRequest>;

/** An internal note, as the signed-in member (B4's limit: 4,000 characters). */
export const AddSubscriptionNoteRequest = z.strictObject({
  body: platformText(4000, 'many', 'Write the note first.'),
});
export type AddSubscriptionNoteRequest = z.input<typeof AddSubscriptionNoteRequest>;

// ---------- Errors ----------

export const SubscriptionErrorCode = z.enum([
  'NOT_FOUND',
  'FORBIDDEN',
  'ALREADY_SUBSCRIBED',
  'FIRM_NOT_AVAILABLE',
  'FIRM_NOT_BILLABLE',
  'STATUS_NOT_ALLOWED',
  'NO_CHANGE',
  'PLAN_INACTIVE',
  'SEATS_OUT_OF_RANGE',
  'SEATS_IN_USE',
  'LOCATIONS_NOT_OFFERED',
  'RENEWAL_ALREADY_OFF',
  'RENEWAL_ALREADY_ON',
  'NONPAYMENT_NOT_PAST_DUE',
  'BALANCE_DUE',
  'PAYMENT_CONFIRMATION_REQUIRED',
  'PLAN_REQUIRED',
  'NO_BILLING_DATE',
  'BILLING_DATE_OUT_OF_RANGE',
  'CONFIRM_NAME_MISMATCH',
]);
export type SubscriptionErrorCode = z.infer<typeof SubscriptionErrorCode>;

/** Messages for `errorMessage(error, SUBSCRIPTION_ERRORS)`. */
export const SUBSCRIPTION_ERRORS: Readonly<Record<SubscriptionErrorCode, string>> = {
  NOT_FOUND: "We couldn't find that subscription. Refresh to see the latest.",
  FORBIDDEN: 'Your role does not allow this.',
  ALREADY_SUBSCRIBED: 'This firm already has a subscription.',
  FIRM_NOT_AVAILABLE: 'Only an approved firm can get a subscription.',
  FIRM_NOT_BILLABLE: 'Only an active firm can be billed. Start a trial instead.',
  STATUS_NOT_ALLOWED: "That isn't possible in this subscription's status.",
  NO_CHANGE: 'Choose something different first.',
  PLAN_INACTIVE: 'That plan is no longer offered. Choose another.',
  SEATS_OUT_OF_RANGE: "That number of seats is outside the plan's range.",
  SEATS_IN_USE: 'The firm uses more seats than that. Remove users first or choose a larger plan.',
  LOCATIONS_NOT_OFFERED: "This plan doesn't offer extra locations.",
  RENEWAL_ALREADY_OFF: 'Auto-Renew is already off.',
  RENEWAL_ALREADY_ON: 'Nothing is scheduled to end: Auto-Renew is on.',
  NONPAYMENT_NOT_PAST_DUE: 'Nonpayment suspension is only for past-due subscriptions.',
  BALANCE_DUE: 'A balance is still due. Record the payment in Billing first.',
  PAYMENT_CONFIRMATION_REQUIRED: 'Confirm the payment is settled before reactivating.',
  PLAN_REQUIRED: 'Choose a plan and a billing cycle for the restart.',
  NO_BILLING_DATE: 'There is no next billing date to move.',
  BILLING_DATE_OUT_OF_RANGE: 'Choose a date after today and within one billing cycle.',
  CONFIRM_NAME_MISMATCH: 'Type the firm name exactly as shown.',
};
