import { ApiRequestError } from '@firmivra/types';
import { mockDelay, mocked, mockedEmpty } from '../lib/mock';

/**
 * Mock data for the Super Admin Subscriptions page (S03, docs/mockups/super-admin/subscriptions/).
 * There is no Super Admin subscriptions API or contract yet: the types and the client live here,
 * and outside mock mode every call fails like an unreachable API. Switch: NEXT_PUBLIC_API_MOCK=
 * adminSubscriptions; NEXT_PUBLIC_API_MOCK_EMPTY=adminSubscriptions starts with no subscriptions.
 *
 * Plans and prices are the firm plans of the pricing structure (Solo Core to Enterprise; annual
 * billing is twelve months of the monthly price). Add-on prices and the storage and text limits are
 * placeholders until the pricing sheet names them. Firms, people and cards are synthetic.
 *
 * Every change writes a history event that carries the status and the monthly recurring amount
 * after it, so the KPI numbers, their "vs. last month" figures and the churn rate are all derived
 * from the same records the table shows.
 */
const MODULE = 'adminSubscriptions';

/** No Super Admin subscriptions API yet: outside mock mode every call fails like an unreachable API. */
async function ready() {
  await mockDelay();
  if (!mocked(MODULE)) throw new TypeError('Failed to fetch');
}

// ---------------------------------------------------------------------------------------------
// Catalogue

export type PlanId =
  'SOLO_CORE' | 'SOLO_PRO' | 'SOLO_ELITE' | 'TEAM_PRO' | 'BUSINESS' | 'ENTERPRISE';
export type BillingCycle = 'MONTHLY' | 'ANNUAL';
export type AddonId = 'AI_TOOLS' | 'SMS_PACKAGE' | 'EXTRA_STORAGE' | 'EXTRA_LOCATION';

export interface Plan {
  id: PlanId;
  name: string;
  /** The value-ladder outcome: Organize, Automate, Grow, Collaborate, Govern, Scale. */
  outcome: string;
  monthlyCents: number;
  includedSeats: number;
  maxSeats: number;
  /** Per seat above the included ones, per month; null when the plan has no seat expansion. */
  extraSeatCents: number | null;
  locations: number;
  /** Enterprise is "From $799/mo". */
  priceFrom: boolean;
  /** Placeholder limits (the pricing sheet says only "higher usage limits"). */
  storageGb: number;
  textsPerMonth: number;
}

export const PLAN_ORDER: readonly PlanId[] = [
  'SOLO_CORE',
  'SOLO_PRO',
  'SOLO_ELITE',
  'TEAM_PRO',
  'BUSINESS',
  'ENTERPRISE',
];

export const PLANS: Record<PlanId, Plan> = {
  SOLO_CORE: {
    id: 'SOLO_CORE',
    name: 'Solo Core',
    outcome: 'Organize',
    monthlyCents: 6900,
    includedSeats: 1,
    maxSeats: 1,
    extraSeatCents: null,
    locations: 1,
    priceFrom: false,
    storageGb: 25,
    textsPerMonth: 0,
  },
  SOLO_PRO: {
    id: 'SOLO_PRO',
    name: 'Solo Pro',
    outcome: 'Automate',
    monthlyCents: 9900,
    includedSeats: 1,
    maxSeats: 1,
    extraSeatCents: null,
    locations: 1,
    priceFrom: false,
    storageGb: 50,
    textsPerMonth: 500,
  },
  SOLO_ELITE: {
    id: 'SOLO_ELITE',
    name: 'Solo Elite',
    outcome: 'Grow',
    monthlyCents: 14900,
    includedSeats: 1,
    maxSeats: 1,
    extraSeatCents: null,
    locations: 1,
    priceFrom: false,
    storageGb: 100,
    textsPerMonth: 1000,
  },
  TEAM_PRO: {
    id: 'TEAM_PRO',
    name: 'Team Pro',
    outcome: 'Collaborate',
    monthlyCents: 19900,
    includedSeats: 3,
    maxSeats: 10,
    extraSeatCents: 2900,
    locations: 1,
    priceFrom: false,
    storageGb: 250,
    textsPerMonth: 2000,
  },
  BUSINESS: {
    id: 'BUSINESS',
    name: 'Business',
    outcome: 'Govern',
    monthlyCents: 49900,
    includedSeats: 10,
    maxSeats: 20,
    extraSeatCents: 2500,
    locations: 1,
    priceFrom: false,
    storageGb: 500,
    textsPerMonth: 5000,
  },
  ENTERPRISE: {
    id: 'ENTERPRISE',
    name: 'Enterprise',
    outcome: 'Scale',
    monthlyCents: 79900,
    includedSeats: 20,
    maxSeats: 20,
    extraSeatCents: null,
    locations: 3,
    priceFrom: true,
    storageGb: 1000,
    textsPerMonth: 10000,
  },
};

export interface Addon {
  id: AddonId;
  name: string;
  description: string;
  monthlyCents: number;
  /** The plans that can add it. */
  plans: readonly PlanId[];
}

export const ADDON_ORDER: readonly AddonId[] = [
  'AI_TOOLS',
  'SMS_PACKAGE',
  'EXTRA_STORAGE',
  'EXTRA_LOCATION',
];

export const ADDONS: Record<AddonId, Addon> = {
  AI_TOOLS: {
    id: 'AI_TOOLS',
    name: 'AI Tools',
    description: 'AI drafting and summaries (included from Solo Elite)',
    monthlyCents: 2900,
    plans: ['SOLO_CORE', 'SOLO_PRO'],
  },
  SMS_PACKAGE: {
    id: 'SMS_PACKAGE',
    name: 'SMS Package',
    description: '1,000 more text messages a month',
    monthlyCents: 1900,
    plans: ['SOLO_CORE', 'SOLO_PRO', 'SOLO_ELITE', 'TEAM_PRO', 'BUSINESS', 'ENTERPRISE'],
  },
  EXTRA_STORAGE: {
    id: 'EXTRA_STORAGE',
    name: 'Extra Storage',
    description: '100 GB more document storage',
    monthlyCents: 1500,
    plans: ['SOLO_CORE', 'SOLO_PRO', 'SOLO_ELITE', 'TEAM_PRO', 'BUSINESS', 'ENTERPRISE'],
  },
  EXTRA_LOCATION: {
    id: 'EXTRA_LOCATION',
    name: 'Additional Location',
    description: 'One more office location, from location 4',
    monthlyCents: 14900,
    plans: ['ENTERPRISE'],
  },
};

export type PromoCode = 'LAUNCH50' | 'LOYAL10' | 'ANNUAL15';
export const PROMOS: Record<PromoCode, { code: PromoCode; percent: number; months: number }> = {
  LAUNCH50: { code: 'LAUNCH50', percent: 50, months: 3 },
  LOYAL10: { code: 'LOYAL10', percent: 10, months: 12 },
  ANNUAL15: { code: 'ANNUAL15', percent: 15, months: 12 },
};

export type SubscriptionStatus =
  | 'TRIAL'
  | 'ACTIVE'
  | 'PAST_DUE'
  | 'SUSPENDED'
  | 'NON_RENEWING'
  | 'EXPIRED'
  | 'CANCELLED'
  | 'CLOSED';

export const STATUS_ORDER: readonly SubscriptionStatus[] = [
  'TRIAL',
  'ACTIVE',
  'PAST_DUE',
  'SUSPENDED',
  'NON_RENEWING',
  'EXPIRED',
  'CANCELLED',
  'CLOSED',
];

export const STATUS_LABELS: Record<SubscriptionStatus, string> = {
  TRIAL: 'Trial',
  ACTIVE: 'Active',
  PAST_DUE: 'Past Due',
  SUSPENDED: 'Suspended',
  NON_RENEWING: 'Non-Renewing',
  EXPIRED: 'Expired',
  CANCELLED: 'Canceled',
  CLOSED: 'Closed',
};

export const CYCLE_LABELS: Record<BillingCycle, string> = { MONTHLY: 'Monthly', ANNUAL: 'Annual' };

/** Statuses that count towards MRR: paid and not ended (Past Due is still a live subscription). */
export const PAYING: readonly SubscriptionStatus[] = ['ACTIVE', 'PAST_DUE', 'NON_RENEWING'];
/** Statuses where plan, seat and add-on changes are allowed. */
export const CHANGEABLE: readonly SubscriptionStatus[] = [
  'TRIAL',
  'ACTIVE',
  'PAST_DUE',
  'NON_RENEWING',
];
/** Statuses an admin can pause or suspend. */
export const SUSPENDABLE: readonly SubscriptionStatus[] = [
  'TRIAL',
  'ACTIVE',
  'PAST_DUE',
  'NON_RENEWING',
];
/** Statuses with a reactivation path from this page (a closed account needs a new subscription). */
export const REACTIVATABLE: readonly SubscriptionStatus[] = ['SUSPENDED', 'CANCELLED', 'EXPIRED'];

/** Table filters beyond the statuses, for the KPI cards. */
export type StatusFilter = SubscriptionStatus | 'PAYING' | 'RENEWING_SOON' | 'ENDED';

export type SuspensionKind = 'PAUSE' | 'ADMIN' | 'NONPAYMENT';
export const SUSPENSION_LABELS: Record<SuspensionKind, string> = {
  PAUSE: 'Paused at the firm’s request',
  ADMIN: 'Administrative suspension',
  NONPAYMENT: 'Suspended for nonpayment',
};

export type RequestSource = 'PHONE' | 'EMAIL' | 'SUPPORT' | 'MEETING' | 'OTHER';
export const REQUEST_SOURCES: Record<RequestSource, string> = {
  PHONE: 'Phone call',
  EMAIL: 'Email',
  SUPPORT: 'Support conversation',
  MEETING: 'Meeting',
  OTHER: 'Other',
};

/** When a plan, seat or add-on change applies. */
export type Effective = 'NOW' | 'NEXT_BILLING';

// ---------------------------------------------------------------------------------------------
// Records

export interface FirmRef {
  id: string;
  name: string;
  email: string;
  domain: string;
}
export interface Card {
  brand: 'Visa' | 'Mastercard' | 'Amex';
  last4: string;
  expires: string;
}
export interface Discount {
  id: string;
  kind: 'PERCENT' | 'PROMO';
  code: string | null;
  percent: number;
  label: string;
  startsOn: string;
  /** Null: no end. */
  endsOn: string | null;
  reason: string;
  approvedBy: string;
}
export interface TrialInfo {
  startedOn: string;
  endsOn: string;
  convertedOn: string | null;
}
export interface PastDueInfo {
  failedOn: string;
  attempts: number;
  maxAttempts: number;
  nextRetryOn: string | null;
  graceEndsOn: string;
  /** The processor's answer, as far as it may be shown. */
  response: string;
}
export interface Suspension {
  kind: SuspensionKind;
  reason: string;
  since: string;
}
export interface ScheduledChange {
  id: string;
  kind: 'PLAN' | 'SEATS' | 'ADDONS' | 'SUSPEND' | 'CLOSE';
  on: string;
  summary: string;
}
export interface Invoice {
  id: string;
  number: string;
  issuedOn: string;
  amountCents: number;
  status: 'PAID' | 'OPEN' | 'FAILED';
  description: string;
  lastSentOn: string | null;
}
export interface Payment {
  id: string;
  on: string;
  amountCents: number;
  result: 'SUCCEEDED' | 'FAILED';
  method: string;
  reference: string;
  message: string | null;
}
export type EventCategory = 'LIFECYCLE' | 'BILLING' | 'NOTE' | 'NOTIFICATION' | 'ACCESS';
/** One immutable history and audit entry. `status` and `mrrCents` are the state after it. */
export interface SubscriptionEvent {
  id: string;
  at: string;
  category: EventCategory;
  action: string;
  actor: string;
  role: string;
  from: string | null;
  to: string | null;
  effectiveOn: string | null;
  reason: string | null;
  amountCents: number | null;
  status: SubscriptionStatus;
  mrrCents: number;
}
export interface Note {
  id: string;
  at: string;
  author: string;
  text: string;
}
export interface UsageLimit {
  id: 'seats' | 'locations' | 'storage' | 'texts';
  label: string;
  used: number;
  limit: number;
  unit: string;
}

export interface SubscriptionListItem {
  id: string;
  firm: FirmRef;
  plan: PlanId;
  cycle: BillingCycle;
  status: SubscriptionStatus;
  seats: number;
  seatsUsed: number;
  usagePercent: number;
  /** List price per month: plan, extra seats and add-ons, before any discount. */
  monthlyCents: number;
  /** After the running discount. */
  netMonthlyCents: number;
  addons: AddonId[];
  /** A discount that hasn't ended (it may start later). */
  discount: Discount | null;
  creditCents: number;
  autoRenew: boolean;
  nextBillingOn: string | null;
  /** Access end date: paid-through date when non-renewing, or the date it ended. */
  endsOn: string | null;
  trialEndsOn: string | null;
  supportViewUntil: string | null;
}
export interface SubscriptionDetail extends SubscriptionListItem {
  /** The mock's today (YYYY-MM-DD), for previews. */
  today: string;
  startedOn: string;
  renewalOn: string | null;
  paidThroughOn: string | null;
  endedOn: string | null;
  trial: (TrialInfo & { daysLeft: number; followUp: string }) | null;
  pastDue: PastDueInfo | null;
  suspension: Suspension | null;
  card: Card | null;
  accountOwner: string | null;
  scheduled: ScheduledChange[];
  supportView: { until: string; reason: string } | null;
  amountDueCents: number;
  usage: UsageLimit[];
  invoices: Invoice[];
  payments: Payment[];
  /** Newest first. */
  events: SubscriptionEvent[];
  /** Newest first. */
  notes: Note[];
}

export interface SubscriptionQuery {
  search?: string;
  plan?: PlanId | '';
  status?: StatusFilter | '';
  cycle?: BillingCycle | '';
  /** The reporting period (YYYY-MM-DD); empty means this month. */
  from?: string;
  to?: string;
}
export interface SubscriptionPage {
  items: SubscriptionListItem[];
  total: number;
  /** Every subscription, before filters: tells "none yet" from "none match". */
  all: number;
}
export interface Figure {
  value: number;
  /** The same figure 30 days ago; null when it can't be known. */
  previous: number | null;
}
export interface SubscriptionStats {
  period: { from: string; to: string };
  active: Figure;
  trial: Figure;
  mrrCents: Figure;
  arrCents: Figure;
  pastDue: Figure;
  renewals: Figure;
  churn: { rate: number; previousRate: number | null; churned: number; base: number };
}
export interface FirmWithoutSubscription extends FirmRef {
  hasCard: boolean;
}
export interface ActionResult {
  /** False when the action ran but its outcome failed (a declined card): the message says why. */
  ok: boolean;
  message: string;
}

/** Field errors, as the API's validation details will be: `form` holds a rule that isn't one field's. */
export class SubscriptionInputError extends ApiRequestError {
  constructor(readonly fields: Record<string, string>) {
    super(400, 'VALIDATION_FAILED', 'Some details need fixing');
  }
}
function fail(fields: Record<string, string>): never {
  throw new SubscriptionInputError(fields);
}

// ---------------------------------------------------------------------------------------------
// Dates and money (pure helpers, shared with the page's previews)

const DAY = 86_400_000;
const isoDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const todayIso = () => isoDay(Date.now());
const parseDay = (day: string) => Date.parse(`${day}T00:00:00.000Z`);
export const addDays = (day: string, days: number) => isoDay(parseDay(day) + days * DAY);
export const daysBetween = (from: string, to: string) =>
  Math.round((parseDay(to) - parseDay(from)) / DAY);
export function addMonths(day: string, months: number): string {
  const year = Number(day.slice(0, 4));
  const month = Number(day.slice(5, 7)) - 1;
  const date = Number(day.slice(8, 10));
  const target = new Date(Date.UTC(year, month + months, 1));
  const last = new Date(
    Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0),
  ).getUTCDate();
  target.setUTCDate(Math.min(date, last));
  return isoDay(target.getTime());
}
const isDay = (value: unknown): value is string =>
  typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(parseDay(value));
export const cycleMonths = (cycle: BillingCycle) => (cycle === 'ANNUAL' ? 12 : 1);
const cycleDays = (cycle: BillingCycle) => (cycle === 'ANNUAL' ? 365 : 30);
export const cycleCents = (monthlyCents: number, cycle: BillingCycle) =>
  cycle === 'ANNUAL' ? monthlyCents * 12 : monthlyCents;

const money = (cents: number) =>
  (cents / 100).toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: cents % 100 === 0 ? 0 : 2,
  });
const dayText = (day: string) =>
  new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeZone: 'UTC' }).format(
    new Date(parseDay(day)),
  );

export function monthlyListCents(plan: PlanId, seats: number, addons: readonly AddonId[]): number {
  const info = PLANS[plan];
  const extra =
    info.extraSeatCents === null
      ? 0
      : Math.max(0, seats - info.includedSeats) * info.extraSeatCents;
  return info.monthlyCents + extra + addons.reduce((sum, id) => sum + ADDONS[id].monthlyCents, 0);
}

/** A percentage discount that is running on `day`. */
export const discountRuns = (discount: Discount | null, day: string): discount is Discount =>
  !!discount && discount.startsOn <= day && (discount.endsOn === null || discount.endsOn >= day);

export const netMonthlyCents = (listCents: number, discount: Discount | null, day: string) =>
  discountRuns(discount, day)
    ? Math.round((listCents * (100 - discount.percent)) / 100)
    : listCents;

/** The parts of a subscription a price preview needs; the list row, the detail and the mock fit. */
export interface Priced {
  plan: PlanId;
  cycle: BillingCycle;
  status: SubscriptionStatus;
  seats: number;
  seatsUsed: number;
  addons: readonly AddonId[];
  discount: Discount | null;
  nextBillingOn: string | null;
}
export interface ChangePreview {
  plan: PlanId;
  cycle: BillingCycle;
  seats: number;
  addons: AddonId[];
  /** Add-ons the new plan doesn't offer. */
  dropped: AddonId[];
  oldNetMonthlyCents: number;
  monthlyCents: number;
  netMonthlyCents: number;
  /** Charged today (positive) or credited (negative); 0 for trials and changes at next billing. */
  amountCents: number;
  nextBillingOn: string | null;
  /** Why the change can't be made, or null. */
  blocked: string | null;
}

/**
 * The financial impact of a plan, cycle, seat or add-on change, shown before confirmation and
 * applied by the action with the same numbers. Same cycle: the price difference for the days left.
 * New cycle: the full new cycle less the unused part of the current one, from today.
 */
export function previewChange(
  sub: Priced,
  change: { plan?: PlanId; cycle?: BillingCycle; seats?: number; addons?: readonly AddonId[] },
  effective: Effective,
  today: string,
): ChangePreview {
  const plan = change.plan ?? sub.plan;
  const info = PLANS[plan];
  const cycle = change.cycle ?? sub.cycle;
  const seats =
    change.seats ??
    Math.max(info.includedSeats, Math.min(info.maxSeats, Math.max(sub.seats, sub.seatsUsed)));
  const wanted = change.addons ?? sub.addons;
  const addons = wanted.filter((id) => ADDONS[id].plans.includes(plan));
  const dropped = wanted.filter((id) => !addons.includes(id));
  const oldNet = netMonthlyCents(
    monthlyListCents(sub.plan, sub.seats, sub.addons),
    sub.discount,
    today,
  );
  const monthly = monthlyListCents(plan, seats, addons);
  const net = netMonthlyCents(monthly, sub.discount, today);
  let amount = 0;
  let nextBillingOn = sub.nextBillingOn;
  if (effective === 'NOW' && sub.status !== 'TRIAL') {
    const left = sub.nextBillingOn
      ? Math.min(Math.max(0, daysBetween(today, sub.nextBillingOn)), cycleDays(sub.cycle))
      : 0;
    if (cycle === sub.cycle) {
      amount = Math.round(
        ((cycleCents(net, cycle) - cycleCents(oldNet, cycle)) * left) / cycleDays(cycle),
      );
    } else {
      const unused = Math.round((cycleCents(oldNet, sub.cycle) * left) / cycleDays(sub.cycle));
      amount = cycleCents(net, cycle) - unused;
      nextBillingOn = addMonths(today, cycleMonths(cycle));
    }
  }
  let blocked: string | null = null;
  if (info.maxSeats < sub.seatsUsed)
    blocked = `${info.name} allows up to ${info.maxSeats} ${info.maxSeats === 1 ? 'user' : 'users'}; this firm has ${sub.seatsUsed}. Remove users first or choose a larger plan.`;
  else if (seats < sub.seatsUsed)
    blocked = `The firm already uses ${sub.seatsUsed} seats. Remove users before lowering the allowance.`;
  else if (seats > info.maxSeats) blocked = `${info.name} allows up to ${info.maxSeats} seats.`;
  else if (seats < info.includedSeats)
    blocked = `${info.name} includes ${info.includedSeats} seats in its base price.`;
  return {
    plan,
    cycle,
    seats,
    addons,
    dropped,
    oldNetMonthlyCents: oldNet,
    monthlyCents: monthly,
    netMonthlyCents: net,
    amountCents: amount,
    nextBillingOn,
    blocked,
  };
}

/** A billing-date move: the days added (charged) or removed (credited) at the current rate. */
export function previewBillingDate(sub: Priced, date: string, today: string): number {
  if (!sub.nextBillingOn) return 0;
  const net = netMonthlyCents(
    monthlyListCents(sub.plan, sub.seats, sub.addons),
    sub.discount,
    today,
  );
  return Math.round(
    (cycleCents(net, sub.cycle) * daysBetween(sub.nextBillingOn, date)) / cycleDays(sub.cycle),
  );
}

// ---------------------------------------------------------------------------------------------
// The store

interface Row {
  id: string;
  firm: FirmRef;
  plan: PlanId;
  cycle: BillingCycle;
  status: SubscriptionStatus;
  seats: number;
  seatsUsed: number;
  addons: AddonId[];
  discount: Discount | null;
  creditCents: number;
  autoRenew: boolean;
  startedOn: string;
  nextBillingOn: string | null;
  paidThroughOn: string | null;
  endsOn: string | null;
  endedOn: string | null;
  trial: TrialInfo | null;
  pastDue: PastDueInfo | null;
  suspension: Suspension | null;
  card: Card | null;
  /** The mock card is declined on every charge. */
  declines: boolean;
  accountOwner: string | null;
  scheduled: ScheduledChange[];
  supportView: { until: string; reason: string } | null;
  usage: { storageGb: number; texts: number; locations: number };
  invoices: Invoice[];
  payments: Payment[];
  events: SubscriptionEvent[];
  notes: Note[];
}
interface FreeFirm extends FirmRef {
  card: Card | null;
}
interface Store {
  rows: Row[];
  free: FreeFirm[];
  serial: number;
}

const ADMIN = { name: 'Morgan Admin', role: 'Super Admin' };
const SYSTEM = { name: 'System', role: 'Billing system' };
const uuid = (block: string, n: number) =>
  `0199d755-${block}-7000-8000-${String(n).padStart(12, '0')}`;
const VISA: Card = { brand: 'Visa', last4: '4242', expires: '08/28' };
const MASTERCARD: Card = { brand: 'Mastercard', last4: '4444', expires: '11/27' };
const AMEX: Card = { brand: 'Amex', last4: '0005', expires: '03/29' };
const DECLINING: Card = { brand: 'Visa', last4: '0341', expires: '05/27' };
const cardText = (card: Card | null) => (card ? `${card.brand} •••• ${card.last4}` : 'None');

let store: Store | undefined;
/** Built on first use (dates relative to today): importing this file runs nothing. */
function db(): Store {
  store ??= seed();
  return store;
}
const newId = (block: string) => uuid(block, db().serial++);

interface Seed {
  name: string;
  slug: string;
  plan: PlanId;
  cycle: BillingCycle;
  status: SubscriptionStatus;
  seats?: number;
  used?: number;
  addons?: AddonId[];
  /** Completed billing cycles before the current one. */
  cycles?: number;
  /** Days since the current period was billed. */
  billedDaysAgo?: number;
  /** A trial that started this many days ago (Trial), or that came before the paid start. */
  trialDaysAgo?: number;
  trialBefore?: boolean;
  trialExtraDays?: number;
  /** Cancelled, closed, or the trial expired, this many days ago. */
  endedDaysAgo?: number;
  /** Auto-Renew was turned off this many days ago. */
  offDaysAgo?: number;
  attempts?: number;
  suspended?: { kind: SuspensionKind; daysAgo: number; reason: string };
  closedReason?: string;
  promo?: PromoCode;
  promoDaysAgo?: number;
  previousPlan?: { plan: PlanId; daysAgo: number };
  card?: Card | null;
  owner?: string;
  storage: number;
  texts: number;
  locations?: number;
  note?: string;
}

function seeds(): Seed[] {
  return [
    {
      name: 'Sample Blue Ridge Tax',
      slug: 'blueridgetax',
      plan: 'TEAM_PRO',
      cycle: 'ANNUAL',
      status: 'ACTIVE',
      seats: 10,
      used: 8,
      addons: ['SMS_PACKAGE'],
      cycles: 0,
      billedDaysAgo: 276,
      owner: 'Jordan Sales',
      storage: 120,
      texts: 1400,
      note: 'Owner asked about adding a second office next year (fake).',
    },
    {
      name: 'Example Lakeshore Books',
      slug: 'lakeshorebooks',
      plan: 'SOLO_ELITE',
      cycle: 'MONTHLY',
      status: 'ACTIVE',
      cycles: 0,
      billedDaysAgo: 20,
      promo: 'LAUNCH50',
      promoDaysAgo: 20,
      owner: 'Casey Accounts',
      storage: 18,
      texts: 230,
    },
    {
      name: 'Sample Summit Tax Group',
      slug: 'summittaxgroup',
      plan: 'TEAM_PRO',
      cycle: 'MONTHLY',
      status: 'ACTIVE',
      seats: 10,
      used: 6,
      cycles: 7,
      billedDaysAgo: 2,
      card: MASTERCARD,
      owner: 'Jordan Sales',
      storage: 140,
      texts: 900,
    },
    {
      name: 'Example NextGen Advisors',
      slug: 'nextgenadvisors',
      plan: 'TEAM_PRO',
      cycle: 'MONTHLY',
      status: 'TRIAL',
      seats: 3,
      used: 2,
      trialDaysAgo: 7,
      owner: 'Casey Accounts',
      storage: 4,
      texts: 40,
    },
    {
      name: 'Sample Coastal Advisory',
      slug: 'coastaladvisory',
      plan: 'BUSINESS',
      cycle: 'ANNUAL',
      status: 'ACTIVE',
      seats: 14,
      used: 12,
      addons: ['EXTRA_STORAGE'],
      cycles: 1,
      billedDaysAgo: 95,
      storage: 410,
      texts: 2600,
    },
    {
      name: 'Example Maple Ledger',
      slug: 'mapleledger',
      plan: 'SOLO_PRO',
      cycle: 'MONTHLY',
      status: 'PAST_DUE',
      cycles: 5,
      billedDaysAgo: 4,
      attempts: 1,
      card: DECLINING,
      storage: 22,
      texts: 310,
      note: 'Left a voicemail about the failed payment (fake).',
    },
    {
      name: 'Sample Valley Payroll Co',
      slug: 'valleypayroll',
      plan: 'TEAM_PRO',
      cycle: 'MONTHLY',
      status: 'ACTIVE',
      seats: 10,
      used: 7,
      addons: ['SMS_PACKAGE', 'EXTRA_STORAGE'],
      cycles: 11,
      billedDaysAgo: 6,
      owner: 'Jordan Sales',
      storage: 280,
      texts: 2400,
    },
    {
      name: 'Example Stonebridge Tax',
      slug: 'stonebridgetax',
      plan: 'SOLO_CORE',
      cycle: 'MONTHLY',
      status: 'CANCELLED',
      cycles: 6,
      endedDaysAgo: 10,
      offDaysAgo: 25,
      storage: 9,
      texts: 0,
    },
    {
      name: 'Sample Harborview CPA',
      slug: 'harborviewcpa',
      plan: 'ENTERPRISE',
      cycle: 'ANNUAL',
      status: 'ACTIVE',
      seats: 20,
      used: 18,
      addons: ['EXTRA_LOCATION'],
      cycles: 1,
      billedDaysAgo: 200,
      owner: 'Casey Accounts',
      storage: 760,
      texts: 6100,
      locations: 4,
    },
    {
      name: 'Example Pinecrest Bookkeeping',
      slug: 'pinecrestbooks',
      plan: 'SOLO_CORE',
      cycle: 'MONTHLY',
      status: 'ACTIVE',
      addons: ['AI_TOOLS'],
      cycles: 3,
      billedDaysAgo: 12,
      storage: 11,
      texts: 0,
    },
    {
      name: 'Sample Granite Peak Tax',
      slug: 'granitepeaktax',
      plan: 'BUSINESS',
      cycle: 'MONTHLY',
      status: 'NON_RENEWING',
      seats: 10,
      used: 9,
      cycles: 8,
      billedDaysAgo: 18,
      offDaysAgo: 5,
      storage: 300,
      texts: 3100,
    },
    {
      name: 'Example Riverbend Accounting',
      slug: 'riverbendacct',
      plan: 'SOLO_PRO',
      cycle: 'MONTHLY',
      status: 'TRIAL',
      trialDaysAgo: 12,
      card: null,
      storage: 2,
      texts: 15,
    },
    {
      name: 'Sample Oakmont Advisors',
      slug: 'oakmontadvisors',
      plan: 'TEAM_PRO',
      cycle: 'ANNUAL',
      status: 'SUSPENDED',
      seats: 5,
      used: 5,
      cycles: 1,
      billedDaysAgo: 17,
      card: DECLINING,
      suspended: {
        kind: 'NONPAYMENT',
        daysAgo: 3,
        reason: 'The grace period ended with the annual renewal unpaid.',
      },
      storage: 160,
      texts: 1200,
    },
    {
      name: 'Example Cedar Lane Tax',
      slug: 'cedarlanetax',
      plan: 'SOLO_PRO',
      cycle: 'MONTHLY',
      status: 'ACTIVE',
      trialBefore: true,
      cycles: 1,
      billedDaysAgo: 10,
      owner: 'Jordan Sales',
      storage: 14,
      texts: 120,
    },
    {
      name: 'Sample Northgate Financial',
      slug: 'northgatefinancial',
      plan: 'BUSINESS',
      cycle: 'ANNUAL',
      status: 'ACTIVE',
      seats: 20,
      used: 15,
      promo: 'LOYAL10',
      promoDaysAgo: 30,
      cycles: 2,
      billedDaysAgo: 30,
      card: AMEX,
      storage: 455,
      texts: 4100,
    },
    {
      name: 'Example Willow Creek CPA',
      slug: 'willowcreekcpa',
      plan: 'BUSINESS',
      cycle: 'MONTHLY',
      status: 'TRIAL',
      seats: 10,
      used: 6,
      trialDaysAgo: 3,
      owner: 'Jordan Sales',
      storage: 6,
      texts: 80,
    },
    {
      name: 'Sample Brightwater Tax',
      slug: 'brightwatertax',
      plan: 'SOLO_ELITE',
      cycle: 'MONTHLY',
      status: 'EXPIRED',
      endedDaysAgo: 6,
      card: null,
      storage: 3,
      texts: 10,
    },
    {
      name: 'Example Ironwood Ledger',
      slug: 'ironwoodledger',
      plan: 'TEAM_PRO',
      cycle: 'MONTHLY',
      status: 'PAST_DUE',
      seats: 4,
      used: 4,
      cycles: 9,
      billedDaysAgo: 9,
      attempts: 2,
      storage: 90,
      texts: 800,
    },
    {
      name: 'Sample Meadowbrook Books',
      slug: 'meadowbrookbooks',
      plan: 'SOLO_CORE',
      cycle: 'MONTHLY',
      status: 'SUSPENDED',
      cycles: 10,
      billedDaysAgo: 20,
      suspended: {
        kind: 'PAUSE',
        daysAgo: 15,
        reason: 'Seasonal pause the owner asked for until January (fake).',
      },
      storage: 12,
      texts: 0,
    },
    {
      name: 'Example Silverline Tax',
      slug: 'silverlinetax',
      plan: 'TEAM_PRO',
      cycle: 'MONTHLY',
      status: 'CLOSED',
      seats: 3,
      used: 3,
      cycles: 4,
      endedDaysAgo: 25,
      closedReason:
        'The firm merged into another practice; the owner asked to close the account (fake).',
      storage: 70,
      texts: 300,
    },
    {
      name: 'Sample Foxglove Accounting',
      slug: 'foxgloveacct',
      plan: 'SOLO_PRO',
      cycle: 'ANNUAL',
      status: 'ACTIVE',
      cycles: 0,
      billedDaysAgo: 345,
      storage: 30,
      texts: 410,
    },
    {
      name: 'Example Bayside Payroll',
      slug: 'baysidepayroll',
      plan: 'TEAM_PRO',
      cycle: 'ANNUAL',
      status: 'ACTIVE',
      seats: 10,
      used: 9,
      previousPlan: { plan: 'SOLO_ELITE', daysAgo: 50 },
      cycles: 0,
      billedDaysAgo: 120,
      owner: 'Casey Accounts',
      storage: 210,
      texts: 1700,
    },
    {
      name: 'Sample Redwood Tax Partners',
      slug: 'redwoodtax',
      plan: 'BUSINESS',
      cycle: 'MONTHLY',
      status: 'ACTIVE',
      seats: 20,
      used: 19,
      cycles: 14,
      billedDaysAgo: 15,
      storage: 480,
      texts: 4900,
    },
    {
      name: 'Example Lighthouse CPA',
      slug: 'lighthousecpa',
      plan: 'SOLO_ELITE',
      cycle: 'ANNUAL',
      status: 'NON_RENEWING',
      cycles: 0,
      billedDaysAgo: 320,
      offDaysAgo: 12,
      storage: 40,
      texts: 520,
    },
  ];
}

function seed(): Store {
  const today = todayIso();
  let serial = 1;
  const id = (block: string) => uuid(block, serial++);
  const free: FreeFirm[] = [
    {
      id: uuid('0001', 101),
      name: 'Sample Elm Street Tax',
      email: 'billing@elmstreettax.example.test',
      domain: 'elmstreettax.example.test',
      card: VISA,
    },
    {
      id: uuid('0001', 102),
      name: 'Example Copperfield Books',
      email: 'billing@copperfieldbooks.example.test',
      domain: 'copperfieldbooks.example.test',
      card: null,
    },
    {
      id: uuid('0001', 103),
      name: 'Sample Juniper Advisory',
      email: 'billing@juniperadvisory.example.test',
      domain: 'juniperadvisory.example.test',
      card: MASTERCARD,
    },
  ];
  if (mockedEmpty(MODULE)) return { rows: [], free, serial };
  const rows = seeds().map((entry, index) => build(entry, index + 1, today, id));
  return { rows, free, serial };
}

/** One seeded subscription with its invoices, payments and history, consistent with its status. */
function build(s: Seed, n: number, today: string, id: (block: string) => string): Row {
  const info = PLANS[s.plan];
  const seats = s.seats ?? info.includedSeats;
  const domain = `${s.slug}.example.test`;
  const row: Row = {
    id: uuid('0000', n),
    firm: { id: uuid('0001', n), name: s.name, email: `billing@${domain}`, domain },
    plan: s.plan,
    cycle: s.cycle,
    status: s.status,
    seats,
    seatsUsed: s.used ?? Math.min(seats, info.includedSeats),
    addons: s.addons ?? [],
    discount: null,
    creditCents: 0,
    autoRenew: true,
    startedOn: today,
    nextBillingOn: null,
    paidThroughOn: null,
    endsOn: null,
    endedOn: null,
    trial: null,
    pastDue: null,
    suspension: null,
    card: s.card === undefined ? VISA : s.card,
    declines: s.card === DECLINING,
    accountOwner: s.owner ?? null,
    scheduled: [],
    supportView: null,
    usage: { storageGb: s.storage, texts: s.texts, locations: s.locations ?? info.locations },
    invoices: [],
    payments: [],
    events: [],
    notes: [],
  };
  if (s.promo) {
    const promo = PROMOS[s.promo];
    const startsOn = addDays(today, -(s.promoDaysAgo ?? 0));
    row.discount = {
      id: id('0006'),
      kind: 'PROMO',
      code: promo.code,
      percent: promo.percent,
      label: `${promo.code} (${promo.percent}% off)`,
      startsOn,
      endsOn: addMonths(startsOn, promo.months),
      reason: 'Promotion code entered at sign-up',
      approvedBy: ADMIN.name,
    };
  }
  const changedOn = s.previousPlan ? addDays(today, -s.previousPlan.daysAgo) : null;
  const priceAt = (day: string) => {
    const old = s.previousPlan && changedOn && day < changedOn ? s.previousPlan.plan : null;
    const list = old
      ? monthlyListCents(old, PLANS[old].includedSeats, [])
      : monthlyListCents(s.plan, seats, row.addons);
    return netMonthlyCents(list, row.discount, day);
  };
  const event = (
    day: string,
    hour: number,
    status: SubscriptionStatus,
    action: string,
    fields: Partial<SubscriptionEvent> = {},
  ) => {
    row.events.push({
      id: id('0002'),
      at: `${day}T${String(hour).padStart(2, '0')}:00:00.000Z`,
      category: 'LIFECYCLE',
      actor: ADMIN.name,
      role: ADMIN.role,
      from: null,
      to: null,
      effectiveOn: day,
      reason: null,
      amountCents: null,
      mrrCents: priceAt(day),
      ...fields,
      action,
      status,
    });
  };
  const invoice = (day: string, status: Invoice['status'], description: string) => {
    const invoiceId = id('0003');
    const amount = cycleCents(priceAt(day), s.cycle);
    row.invoices.push({
      id: invoiceId,
      number: `INV-${day.slice(0, 4)}-${invoiceId.slice(-4)}`,
      issuedOn: day,
      amountCents: amount,
      status,
      description,
      lastSentOn: day,
    });
    return amount;
  };
  const payment = (day: string, amount: number, ok: boolean) => {
    const paymentId = id('0004');
    row.payments.push({
      id: paymentId,
      on: day,
      amountCents: amount,
      result: ok ? 'SUCCEEDED' : 'FAILED',
      method: cardText(row.card),
      reference: `ch_mock_${paymentId.slice(-6)}`,
      message: ok ? null : 'Card declined (mock)',
    });
  };
  const planText = `${info.name} (${CYCLE_LABELS[s.cycle]})`;

  if (s.status === 'TRIAL' || s.status === 'EXPIRED') {
    const end = s.status === 'EXPIRED' ? addDays(today, -(s.endedDaysAgo ?? 0)) : null;
    const start = end ? addDays(end, -14) : addDays(today, -(s.trialDaysAgo ?? 0));
    const trialEnd = end ?? addDays(start, 14 + (s.trialExtraDays ?? 0));
    row.trial = { startedOn: start, endsOn: trialEnd, convertedOn: null };
    row.startedOn = start;
    event(start, 9, 'TRIAL', 'Trial started', { to: `${planText}, 14 days`, effectiveOn: start });
    event(start, 9, 'TRIAL', 'Firm notified: Trial welcome', {
      category: 'NOTIFICATION',
      actor: SYSTEM.name,
      role: SYSTEM.role,
      to: row.firm.email,
    });
    if (s.status === 'TRIAL') {
      row.nextBillingOn = trialEnd;
    } else {
      row.autoRenew = false;
      row.endedOn = trialEnd;
      row.endsOn = trialEnd;
      event(trialEnd, 23, 'EXPIRED', 'Trial expired', {
        actor: SYSTEM.name,
        role: SYSTEM.role,
        from: 'Trial',
        to: 'Expired',
        reason: 'No payment method was set up before the trial ended.',
      });
    }
  } else {
    const months = cycleMonths(s.cycle);
    const cycles = s.cycles ?? 0;
    const endedOn =
      s.status === 'CANCELLED' || s.status === 'CLOSED'
        ? addDays(today, -(s.endedDaysAgo ?? 0))
        : null;
    const lastBilled =
      s.status === 'CANCELLED' && endedOn
        ? addMonths(endedOn, -months)
        : s.status === 'CLOSED' && endedOn
          ? addDays(endedOn, -10)
          : addDays(today, -(s.billedDaysAgo ?? 1));
    const start = addMonths(lastBilled, -cycles * months);
    const billed = Array.from({ length: cycles + 1 }, (_, k) => addMonths(start, k * months));
    const next = addMonths(start, (cycles + 1) * months);
    const failing =
      s.status === 'PAST_DUE' || (s.status === 'SUSPENDED' && s.suspended?.kind === 'NONPAYMENT');
    if (s.trialBefore) {
      const trialStart = addDays(start, -14);
      row.trial = { startedOn: trialStart, endsOn: start, convertedOn: start };
      row.startedOn = trialStart;
      event(trialStart, 9, 'TRIAL', 'Trial started', { to: `${planText}, 14 days` });
      event(start, 9, 'ACTIVE', 'Converted to paid', {
        from: 'Trial',
        to: planText,
        amountCents: cycleCents(priceAt(start), s.cycle),
      });
    } else {
      row.startedOn = start;
      const first = s.previousPlan
        ? `${PLANS[s.previousPlan.plan].name} (${CYCLE_LABELS[s.cycle]})`
        : planText;
      event(start, 9, 'ACTIVE', 'Subscription started', {
        to: first,
        amountCents: cycleCents(priceAt(start), s.cycle),
      });
    }
    billed.forEach((day, k) => {
      const last = k === billed.length - 1;
      if (last && failing) {
        const amount = invoice(day, 'FAILED', `${planText} renewal`);
        const attempts = s.status === 'PAST_DUE' ? (s.attempts ?? 1) : 3;
        for (let i = 0; i < attempts; i++) payment(addDays(day, i * 3), amount, false);
        event(day, 6, 'PAST_DUE', 'Payment failed', {
          category: 'BILLING',
          actor: SYSTEM.name,
          role: SYSTEM.role,
          from: 'Active',
          to: 'Past Due',
          amountCents: amount,
          reason: 'Card declined (mock)',
        });
        event(day, 6, 'PAST_DUE', 'Firm notified: Payment failed', {
          category: 'NOTIFICATION',
          actor: SYSTEM.name,
          role: SYSTEM.role,
          to: row.firm.email,
        });
        for (let i = 1; i < attempts; i++)
          event(addDays(day, i * 3), 6, 'PAST_DUE', 'Payment retry failed', {
            category: 'BILLING',
            actor: SYSTEM.name,
            role: SYSTEM.role,
            amountCents: amount,
            reason: 'Card declined (mock)',
          });
        const nextRetry = addDays(day, attempts * 3);
        row.pastDue = {
          failedOn: day,
          attempts,
          maxAttempts: 3,
          nextRetryOn:
            s.status === 'PAST_DUE' ? (nextRetry > today ? nextRetry : addDays(today, 1)) : null,
          graceEndsOn: addDays(day, 14),
          response: 'Card declined: insufficient funds (mock)',
        };
        return;
      }
      const amount = invoice(
        day,
        'PAID',
        k === 0 ? `${planText}, first ${months === 12 ? 'year' : 'month'}` : `${planText} renewal`,
      );
      payment(day, amount, true);
      if (k > 0)
        event(day, 6, 'ACTIVE', 'Renewed', {
          category: 'BILLING',
          actor: SYSTEM.name,
          role: SYSTEM.role,
          amountCents: amount,
        });
    });
    if (s.previousPlan && changedOn) {
      const from = `${PLANS[s.previousPlan.plan].name} (${CYCLE_LABELS[s.cycle]})`;
      event(changedOn, 14, 'ACTIVE', 'Plan changed', { from, to: planText });
    }
    if (row.discount) {
      event(row.discount.startsOn, 9, 'ACTIVE', 'Discount applied', {
        category: 'BILLING',
        to: row.discount.label,
        reason: row.discount.reason,
      });
    }
    row.nextBillingOn = next;
    row.paidThroughOn = next;
    if (s.status === 'PAST_DUE') row.paidThroughOn = lastBilled;
    if (s.status === 'SUSPENDED' && s.suspended) {
      const since =
        s.suspended.kind === 'NONPAYMENT'
          ? addDays(lastBilled, 14)
          : addDays(today, -s.suspended.daysAgo);
      row.suspension = { kind: s.suspended.kind, reason: s.suspended.reason, since };
      row.nextBillingOn = null;
      if (s.suspended.kind === 'NONPAYMENT') row.paidThroughOn = lastBilled;
      event(since, 8, 'SUSPENDED', s.suspended.kind === 'PAUSE' ? 'Paused' : 'Suspended', {
        actor: s.suspended.kind === 'NONPAYMENT' ? SYSTEM.name : ADMIN.name,
        role: s.suspended.kind === 'NONPAYMENT' ? SYSTEM.role : ADMIN.role,
        from: s.suspended.kind === 'NONPAYMENT' ? 'Past Due' : 'Active',
        to: SUSPENSION_LABELS[s.suspended.kind],
        reason: s.suspended.reason,
      });
      event(since, 8, 'SUSPENDED', 'Firm notified: Suspension notice', {
        category: 'NOTIFICATION',
        actor: SYSTEM.name,
        role: SYSTEM.role,
        to: row.firm.email,
      });
    }
    if (s.offDaysAgo !== undefined) {
      const off = addDays(today, -s.offDaysAgo);
      const ends = endedOn ?? next;
      row.autoRenew = false;
      event(off, 11, 'NON_RENEWING', 'Auto-Renew turned off', {
        from: 'Auto-Renew on',
        to: 'Non-Renewing',
        effectiveOn: ends,
        reason: 'Email: the owner asked not to renew after this term (fake).',
      });
      event(off, 11, 'NON_RENEWING', 'Firm notified: Renewal turned off', {
        category: 'NOTIFICATION',
        actor: SYSTEM.name,
        role: SYSTEM.role,
        to: row.firm.email,
      });
      if (s.status === 'NON_RENEWING') {
        row.endsOn = next;
        row.nextBillingOn = null;
      }
    }
    if (s.status === 'CANCELLED' && endedOn) {
      row.autoRenew = false;
      row.nextBillingOn = null;
      row.paidThroughOn = endedOn;
      row.endsOn = endedOn;
      row.endedOn = endedOn;
      event(endedOn, 23, 'CANCELLED', 'Subscription ended', {
        actor: SYSTEM.name,
        role: SYSTEM.role,
        from: 'Non-Renewing',
        to: 'Canceled',
        reason: 'The paid period ended with Auto-Renew off.',
      });
    }
    if (s.status === 'CLOSED' && endedOn) {
      row.autoRenew = false;
      row.nextBillingOn = null;
      row.paidThroughOn = endedOn;
      row.endsOn = endedOn;
      row.endedOn = endedOn;
      event(endedOn, 15, 'CLOSED', 'Account closed', {
        from: 'Active',
        to: 'Closed',
        reason: s.closedReason ?? null,
      });
    }
  }
  if (s.note) {
    row.notes.push({
      id: id('0005'),
      at: `${addDays(today, -2)}T15:30:00.000Z`,
      author: 'Casey Accounts',
      text: s.note,
    });
  }
  row.events.sort((a, b) => a.at.localeCompare(b.at));
  return row;
}

// ---------------------------------------------------------------------------------------------
// Reading

const nowIso = () => new Date().toISOString();
const netMonthly = (row: Row, day: string) =>
  netMonthlyCents(monthlyListCents(row.plan, row.seats, row.addons), row.discount, day);
const liveSupport = (row: Row) =>
  row.supportView && row.supportView.until > nowIso() ? row.supportView : null;
const renewsSoon = (row: Row, today: string) =>
  row.autoRenew &&
  (row.status === 'ACTIVE' || row.status === 'PAST_DUE') &&
  !!row.nextBillingOn &&
  row.nextBillingOn >= today &&
  row.nextBillingOn <= addDays(today, 30);
const amountDue = (row: Row) =>
  row.invoices
    .filter((invoice) => invoice.status !== 'PAID')
    .reduce((sum, invoice) => sum + invoice.amountCents, 0);

/** The state after the last event at or before `at` (events are kept oldest first). */
function stateAt(row: Row, at: string): SubscriptionEvent | undefined {
  let found: SubscriptionEvent | undefined;
  for (const event of row.events) {
    if (event.at > at) break;
    found = event;
  }
  return found;
}

function listItem(row: Row, today: string): SubscriptionListItem {
  const monthly = monthlyListCents(row.plan, row.seats, row.addons);
  const discount =
    row.discount && (row.discount.endsOn === null || row.discount.endsOn >= today)
      ? { ...row.discount }
      : null;
  return {
    id: row.id,
    firm: { ...row.firm },
    plan: row.plan,
    cycle: row.cycle,
    status: row.status,
    seats: row.seats,
    seatsUsed: row.seatsUsed,
    usagePercent: row.seats ? Math.round((row.seatsUsed / row.seats) * 100) : 0,
    monthlyCents: monthly,
    netMonthlyCents: netMonthlyCents(monthly, row.discount, today),
    addons: [...row.addons],
    discount,
    creditCents: row.creditCents,
    autoRenew: row.autoRenew,
    nextBillingOn: row.nextBillingOn,
    endsOn: row.endsOn,
    trialEndsOn: row.status === 'TRIAL' && row.trial ? row.trial.endsOn : null,
    supportViewUntil: liveSupport(row)?.until ?? null,
  };
}

function detail(row: Row): SubscriptionDetail {
  const today = todayIso();
  const info = PLANS[row.plan];
  const trialRecord = row.trial;
  const reminder = trialRecord ? addDays(trialRecord.endsOn, -3) : today;
  const trial = trialRecord
    ? {
        ...trialRecord,
        daysLeft: Math.max(0, daysBetween(today, trialRecord.endsOn)),
        followUp: trialRecord.convertedOn
          ? `Converted on ${dayText(trialRecord.convertedOn)}`
          : row.status === 'EXPIRED'
            ? 'Expiry notice sent; follow-up with the account owner'
            : reminder <= today
              ? `Expiry reminder sent ${dayText(reminder)}`
              : `Expiry reminder scheduled for ${dayText(reminder)}`,
      }
    : null;
  const support = liveSupport(row);
  const usage: UsageLimit[] = [
    { id: 'seats', label: 'Seats', used: row.seatsUsed, limit: row.seats, unit: 'seats' },
    ...(info.locations > 1
      ? [
          {
            id: 'locations' as const,
            label: 'Locations',
            used: row.usage.locations,
            limit: info.locations + (row.addons.includes('EXTRA_LOCATION') ? 1 : 0),
            unit: 'locations',
          },
        ]
      : []),
    {
      id: 'storage',
      label: 'Document storage',
      used: row.usage.storageGb,
      limit: info.storageGb + (row.addons.includes('EXTRA_STORAGE') ? 100 : 0),
      unit: 'GB',
    },
    {
      id: 'texts',
      label: 'Text messages this month',
      used: row.usage.texts,
      limit: info.textsPerMonth + (row.addons.includes('SMS_PACKAGE') ? 1000 : 0),
      unit: 'texts',
    },
  ];
  const renewalOn =
    row.autoRenew &&
    (row.status === 'ACTIVE' || row.status === 'PAST_DUE' || row.status === 'TRIAL')
      ? row.nextBillingOn
      : null;
  return {
    ...listItem(row, today),
    today,
    startedOn: row.startedOn,
    renewalOn,
    paidThroughOn: row.paidThroughOn,
    endedOn: row.endedOn,
    trial,
    pastDue: row.pastDue ? { ...row.pastDue } : null,
    suspension: row.suspension ? { ...row.suspension } : null,
    card: row.card ? { ...row.card } : null,
    accountOwner: row.accountOwner,
    scheduled: row.scheduled.map((change) => ({ ...change })),
    supportView: support ? { ...support } : null,
    amountDueCents: amountDue(row),
    usage,
    invoices: row.invoices.map((invoice) => ({ ...invoice })).reverse(),
    payments: row.payments.map((payment) => ({ ...payment })).reverse(),
    events: row.events.map((event) => ({ ...event })).reverse(),
    notes: row.notes.map((note) => ({ ...note })).reverse(),
  };
}

function monthOf(today: string) {
  const from = `${today.slice(0, 8)}01`;
  return { from, to: addDays(addMonths(from, 1), -1) };
}
function resolvePeriod(query: { from?: string; to?: string }, today: string) {
  if (!query.from && !query.to) return monthOf(today);
  if (!isDay(query.from) || !isDay(query.to)) fail({ period: 'Choose a start and an end date.' });
  if (query.from > query.to) fail({ period: 'The start date must be on or before the end date.' });
  return { from: query.from, to: query.to };
}

function churnFor(rows: Row[], from: string, to: string) {
  const start = `${from}T00:00:00.000Z`;
  const end = `${to}T23:59:59.999Z`;
  const base = rows.filter((row) => {
    const state = stateAt(row, start);
    return !!state && PAYING.includes(state.status);
  }).length;
  const churned = rows.filter((row) =>
    row.events.some(
      (event) =>
        (event.status === 'CANCELLED' || event.status === 'CLOSED') &&
        event.category === 'LIFECYCLE' &&
        event.at >= start &&
        event.at <= end,
    ),
  ).length;
  return { base, churned, rate: base ? Math.round((churned / base) * 1000) / 10 : 0 };
}

function find(id: string): Row {
  const row = db().rows.find((candidate) => candidate.id === id);
  if (!row) throw new ApiRequestError(404, 'NOT_FOUND', 'Subscription not found');
  return row;
}

// ---------------------------------------------------------------------------------------------
// Writing

function allow(row: Row, statuses: readonly SubscriptionStatus[], what: string) {
  if (!statuses.includes(row.status))
    fail({
      form: `${what} isn't possible while the subscription is ${STATUS_LABELS[row.status]}.`,
    });
}
function text(value: unknown, field: string, label: string, max = 500): string {
  const cleaned = typeof value === 'string' ? value.replace(/\p{Cc}/gu, ' ').trim() : '';
  if (cleaned.length < 3) fail({ [field]: `Add ${label}.` });
  if (cleaned.length > max) fail({ [field]: `Keep it under ${max} characters.` });
  return cleaned;
}
const isPlan = (value: unknown): value is PlanId => PLAN_ORDER.some((plan) => plan === value);
const isCycle = (value: unknown): value is BillingCycle =>
  value === 'MONTHLY' || value === 'ANNUAL';
const isEffective = (value: unknown): value is Effective =>
  value === 'NOW' || value === 'NEXT_BILLING';

/** Appends an immutable history entry with the state after the change. */
function record(
  row: Row,
  action: string,
  fields: Partial<
    Pick<SubscriptionEvent, 'category' | 'from' | 'to' | 'effectiveOn' | 'reason' | 'amountCents'>
  > = {},
  actor: { name: string; role: string } = ADMIN,
) {
  row.events.push({
    id: newId('0002'),
    at: nowIso(),
    category: 'LIFECYCLE',
    from: null,
    to: null,
    effectiveOn: null,
    reason: null,
    amountCents: null,
    ...fields,
    action,
    actor: actor.name,
    role: actor.role,
    status: row.status,
    mrrCents: netMonthly(row, todayIso()),
  });
}
function notify(row: Row, subject: string) {
  record(
    row,
    `Firm notified: ${subject}`,
    { category: 'NOTIFICATION', to: row.firm.email },
    SYSTEM,
  );
}

/** An invoice for `amount`, paid at once when a working card is on file. */
function charge(row: Row, amount: number, description: string): boolean {
  const today = todayIso();
  const invoiceId = newId('0003');
  const paid = !!row.card && !row.declines;
  row.invoices.push({
    id: invoiceId,
    number: `INV-${today.slice(0, 4)}-${invoiceId.slice(-4)}`,
    issuedOn: today,
    amountCents: amount,
    status: paid ? 'PAID' : 'OPEN',
    description,
    lastSentOn: today,
  });
  if (row.card) {
    const paymentId = newId('0004');
    row.payments.push({
      id: paymentId,
      on: today,
      amountCents: amount,
      result: paid ? 'SUCCEEDED' : 'FAILED',
      method: cardText(row.card),
      reference: `ch_mock_${paymentId.slice(-6)}`,
      message: paid ? null : 'Card declined (mock)',
    });
  }
  return paid;
}

/** Applies a priced change now (charging or crediting the difference) or schedules it. */
function applyChange(
  row: Row,
  preview: ChangePreview,
  effective: Effective,
  kind: ScheduledChange['kind'],
  action: string,
  from: string,
  to: string,
): ActionResult {
  const today = todayIso();
  if (effective === 'NEXT_BILLING' && row.status !== 'TRIAL') {
    if (!row.nextBillingOn)
      fail({ effective: 'This subscription has no next billing date. Apply the change now.' });
    const on = row.nextBillingOn;
    row.scheduled = row.scheduled.filter((change) => change.kind !== kind);
    row.scheduled.push({ id: newId('0007'), kind, on, summary: to });
    record(row, `${action} scheduled`, { from, to, effectiveOn: on });
    notify(row, `${action} scheduled for ${dayText(on)}`);
    return { ok: true, message: `${to} from ${dayText(on)}. The firm has been notified.` };
  }
  row.plan = preview.plan;
  row.cycle = preview.cycle;
  row.seats = preview.seats;
  row.addons = preview.addons;
  if (row.status !== 'TRIAL') row.nextBillingOn = preview.nextBillingOn;
  row.scheduled = row.scheduled.filter((change) => change.kind !== kind);
  let impact = '';
  if (preview.amountCents > 0) {
    const paid = charge(row, preview.amountCents, `${action}: ${to}`);
    impact = paid
      ? ` ${money(preview.amountCents)} was charged today.`
      : ` An invoice for ${money(preview.amountCents)} is open.`;
  } else if (preview.amountCents < 0) {
    row.creditCents += -preview.amountCents;
    impact = ` A credit of ${money(-preview.amountCents)} applies to the next invoice.`;
  }
  record(row, action, {
    from,
    to,
    effectiveOn: today,
    amountCents: preview.amountCents || null,
    reason: preview.dropped.length
      ? `Removed add-ons the plan doesn't offer: ${preview.dropped.map((a) => ADDONS[a].name).join(', ')}`
      : null,
  });
  notify(row, `${action} confirmation`);
  return { ok: true, message: `${action}: ${to}.${impact} The firm has been notified.` };
}

const seatText = (seats: number) => `${seats} ${seats === 1 ? 'seat' : 'seats'}`;
const addonText = (addons: readonly AddonId[]) =>
  addons.length ? addons.map((id) => ADDONS[id].name).join(', ') : 'No add-ons';

export interface CreateSubscriptionBody {
  firmId: string;
  mode: 'TRIAL' | 'PAID';
  plan: PlanId;
  cycle: BillingCycle;
  seats: number;
  accountOwner: string;
}
export interface DiscountBody {
  id: string;
  kind: 'PERCENT' | 'PROMO' | 'CREDIT';
  percent?: number;
  code?: string;
  amountCents?: number;
  /** Months the percentage runs; null: no end. */
  months?: number | null;
  startsOn: string;
  reason: string;
  approvedBy: string;
}

export const adminSubscriptions = {
  /** The KPI row: now and 30 days ago; the churn rate for the period and the one before it. */
  stats: async (query: { from?: string; to?: string } = {}): Promise<SubscriptionStats> => {
    await ready();
    const { rows } = db();
    const today = todayIso();
    const period = resolvePeriod(query, today);
    const monthAgo = new Date(Date.now() - 30 * DAY).toISOString();
    const before = rows.map((row) => stateAt(row, monthAgo));
    const now = (status: SubscriptionStatus) => rows.filter((row) => row.status === status).length;
    const then = (status: SubscriptionStatus) =>
      before.filter((state) => state?.status === status).length;
    const mrr = rows
      .filter((row) => PAYING.includes(row.status))
      .reduce((sum, row) => sum + netMonthly(row, today), 0);
    const mrrBefore = before.reduce(
      (sum, state) => sum + (state && PAYING.includes(state.status) ? state.mrrCents : 0),
      0,
    );
    const length = daysBetween(period.from, period.to) + 1;
    const previousTo = addDays(period.from, -1);
    const current = churnFor(rows, period.from, period.to);
    const previous = churnFor(rows, addDays(previousTo, -(length - 1)), previousTo);
    return {
      period,
      active: { value: now('ACTIVE'), previous: then('ACTIVE') },
      trial: { value: now('TRIAL'), previous: then('TRIAL') },
      mrrCents: { value: mrr, previous: mrrBefore },
      arrCents: { value: mrr * 12, previous: mrrBefore * 12 },
      pastDue: { value: now('PAST_DUE'), previous: then('PAST_DUE') },
      renewals: {
        value: rows.filter((row) => renewsSoon(row, today)).length,
        // Renewals in the 30 days before today: the same window, one month back.
        previous: rows.filter((row) =>
          row.events.some((event) => event.action === 'Renewed' && event.at >= monthAgo),
        ).length,
      },
      churn: {
        rate: current.rate,
        previousRate: previous.base ? previous.rate : null,
        churned: current.churned,
        base: current.base,
      },
    };
  },

  /** Every subscription that matches, in force during the period. The table pages and sorts. */
  subscriptions: async (query: SubscriptionQuery = {}): Promise<SubscriptionPage> => {
    await ready();
    const { rows } = db();
    const today = todayIso();
    const period = resolvePeriod(query, today);
    const search = (query.search ?? '')
      .replace(/\p{Cc}/gu, ' ')
      .trim()
      .toLowerCase()
      .slice(0, 100);
    const status = query.status ?? '';
    const items = rows
      .filter(
        (row) =>
          (!search ||
            row.firm.name.toLowerCase().includes(search) ||
            row.firm.email.toLowerCase().includes(search) ||
            row.firm.domain.toLowerCase().includes(search)) &&
          (!query.plan || row.plan === query.plan) &&
          (!query.cycle || row.cycle === query.cycle) &&
          (status === '' ||
            (status === 'PAYING'
              ? PAYING.includes(row.status)
              : status === 'RENEWING_SOON'
                ? renewsSoon(row, today)
                : status === 'ENDED'
                  ? row.status === 'CANCELLED' || row.status === 'CLOSED'
                  : row.status === status)) &&
          row.startedOn <= period.to &&
          (!row.endedOn || row.endedOn >= period.from),
      )
      .map((row) => listItem(row, today));
    return { items, total: items.length, all: rows.length };
  },

  subscription: async (id: string): Promise<SubscriptionDetail> => {
    await ready();
    return detail(find(id));
  },

  /** Approved firms with no subscription yet, for Add Subscription. */
  firmsWithoutSubscription: async (): Promise<FirmWithoutSubscription[]> => {
    await ready();
    return db().free.map(({ card, ...firm }) => ({ ...firm, hasCard: !!card }));
  },

  create: async (body: CreateSubscriptionBody): Promise<ActionResult> => {
    await ready();
    const s = db();
    const firm = s.free.find((candidate) => candidate.id === body.firmId);
    if (!firm) fail({ firmId: 'Choose a firm.' });
    if (body.mode !== 'TRIAL' && body.mode !== 'PAID') fail({ mode: 'Choose trial or paid.' });
    if (!isPlan(body.plan)) fail({ plan: 'Choose a plan.' });
    if (!isCycle(body.cycle)) fail({ cycle: 'Choose a billing cycle.' });
    const info = PLANS[body.plan];
    if (
      !Number.isInteger(body.seats) ||
      body.seats < info.includedSeats ||
      body.seats > info.maxSeats
    )
      fail({
        seats:
          info.includedSeats === info.maxSeats
            ? `${info.name} has ${seatText(info.maxSeats)}.`
            : `${info.name} allows ${info.includedSeats} to ${info.maxSeats} seats.`,
      });
    if (body.mode === 'PAID' && !firm.card)
      fail({
        mode: 'This firm has no payment method on file. Start a trial, or send a payment link first.',
      });
    const today = todayIso();
    const row: Row = {
      id: newId('0000'),
      firm: { id: firm.id, name: firm.name, email: firm.email, domain: firm.domain },
      plan: body.plan,
      cycle: body.cycle,
      status: body.mode === 'TRIAL' ? 'TRIAL' : 'ACTIVE',
      seats: body.seats,
      seatsUsed: 1,
      addons: [],
      discount: null,
      creditCents: 0,
      autoRenew: true,
      startedOn: today,
      nextBillingOn:
        body.mode === 'TRIAL' ? addDays(today, 14) : addMonths(today, cycleMonths(body.cycle)),
      paidThroughOn: null,
      endsOn: null,
      endedOn: null,
      trial:
        body.mode === 'TRIAL'
          ? { startedOn: today, endsOn: addDays(today, 14), convertedOn: null }
          : null,
      pastDue: null,
      suspension: null,
      card: firm.card,
      declines: false,
      accountOwner: body.accountOwner.trim() || null,
      scheduled: [],
      supportView: null,
      usage: { storageGb: 0, texts: 0, locations: 1 },
      invoices: [],
      payments: [],
      events: [],
      notes: [],
    };
    const planText = `${info.name} (${CYCLE_LABELS[body.cycle]})`;
    if (body.mode === 'PAID') {
      const amount = cycleCents(monthlyListCents(body.plan, body.seats, []), body.cycle);
      if (
        !charge(row, amount, `${planText}, first ${body.cycle === 'ANNUAL' ? 'year' : 'month'}`)
      ) {
        fail({ mode: 'The first charge failed. The subscription was not started.' });
      }
      row.paidThroughOn = row.nextBillingOn;
      record(row, 'Subscription started', {
        to: planText,
        effectiveOn: today,
        amountCents: amount,
      });
      notify(row, 'Paid subscription confirmed');
    } else {
      record(row, 'Trial started', { to: `${planText}, 14 days`, effectiveOn: today });
      notify(row, 'Trial welcome');
    }
    s.rows.push(row);
    s.free = s.free.filter((candidate) => candidate.id !== firm.id);
    return {
      ok: true,
      message:
        body.mode === 'TRIAL'
          ? `${firm.name} started a 14-day ${info.name} trial. The firm has been notified.`
          : `${firm.name} is on ${planText}. The firm has been notified.`,
    };
  },

  changePlan: async (body: {
    id: string;
    plan: PlanId;
    cycle: BillingCycle;
    effective: Effective;
  }): Promise<ActionResult> => {
    await ready();
    const row = find(body.id);
    allow(row, CHANGEABLE, 'A plan change');
    if (!isPlan(body.plan)) fail({ plan: 'Choose a plan.' });
    if (!isCycle(body.cycle)) fail({ cycle: 'Choose a billing cycle.' });
    if (!isEffective(body.effective)) fail({ effective: 'Choose when the change takes effect.' });
    if (body.plan === row.plan && body.cycle === row.cycle)
      fail({ plan: 'Choose a different plan or billing cycle.' });
    const preview = previewChange(
      row,
      { plan: body.plan, cycle: body.cycle },
      body.effective,
      todayIso(),
    );
    if (preview.blocked) fail({ plan: preview.blocked });
    const from = `${PLANS[row.plan].name} (${CYCLE_LABELS[row.cycle]})`;
    const to = `${PLANS[body.plan].name} (${CYCLE_LABELS[body.cycle]})`;
    return applyChange(row, preview, body.effective, 'PLAN', 'Plan changed', from, to);
  },

  updateSeats: async (body: {
    id: string;
    seats: number;
    effective: Effective;
  }): Promise<ActionResult> => {
    await ready();
    const row = find(body.id);
    allow(row, CHANGEABLE, 'A seat change');
    if (!Number.isInteger(body.seats)) fail({ seats: 'Enter a whole number of seats.' });
    if (!isEffective(body.effective)) fail({ effective: 'Choose when the change takes effect.' });
    if (body.seats === row.seats) fail({ seats: 'Choose a different number of seats.' });
    const preview = previewChange(row, { seats: body.seats }, body.effective, todayIso());
    if (preview.blocked) fail({ seats: preview.blocked });
    return applyChange(
      row,
      preview,
      body.effective,
      'SEATS',
      'Seats changed',
      seatText(row.seats),
      seatText(body.seats),
    );
  },

  updateAddons: async (body: {
    id: string;
    addons: AddonId[];
    effective: Effective;
  }): Promise<ActionResult> => {
    await ready();
    const row = find(body.id);
    allow(row, CHANGEABLE, 'An add-on change');
    if (!isEffective(body.effective)) fail({ effective: 'Choose when the change takes effect.' });
    const wanted = [...new Set(body.addons)];
    const unknown = wanted.find(
      (id) => !ADDON_ORDER.includes(id) || !ADDONS[id].plans.includes(row.plan),
    );
    if (unknown)
      fail({
        addons: `${ADDONS[unknown]?.name ?? 'That add-on'} isn't offered on ${PLANS[row.plan].name}.`,
      });
    const sorted = ADDON_ORDER.filter((id) => wanted.includes(id));
    if (sorted.join() === ADDON_ORDER.filter((id) => row.addons.includes(id)).join())
      fail({ addons: 'Change at least one add-on.' });
    const preview = previewChange(row, { addons: sorted }, body.effective, todayIso());
    return applyChange(
      row,
      preview,
      body.effective,
      'ADDONS',
      'Add-ons changed',
      addonText(row.addons),
      addonText(sorted),
    );
  },

  extendTrial: async (body: {
    id: string;
    days: number;
    reason: string;
    notifyFirm: boolean;
  }): Promise<ActionResult> => {
    await ready();
    const row = find(body.id);
    allow(row, ['TRIAL'], 'Extending the trial');
    if (!Number.isInteger(body.days) || body.days < 1 || body.days > 60)
      fail({ days: 'Add between 1 and 60 days.' });
    const reason = text(body.reason, 'reason', 'a reason for the extension');
    if (!row.trial) fail({ form: 'This subscription has no trial.' });
    const old = row.trial.endsOn;
    row.trial = { ...row.trial, endsOn: addDays(old, body.days) };
    if (row.autoRenew) row.nextBillingOn = row.trial.endsOn;
    record(row, 'Trial extended', {
      from: dayText(old),
      to: dayText(row.trial.endsOn),
      effectiveOn: row.trial.endsOn,
      reason,
    });
    if (body.notifyFirm) notify(row, 'Trial extended');
    return {
      ok: true,
      message: `The trial now ends on ${dayText(row.trial.endsOn)}.${body.notifyFirm ? ' The firm has been notified.' : ''}`,
    };
  },

  convertToPaid: async (body: {
    id: string;
    plan: PlanId;
    cycle: BillingCycle;
  }): Promise<ActionResult> => {
    await ready();
    const row = find(body.id);
    allow(row, ['TRIAL'], 'Converting to paid');
    if (!isPlan(body.plan)) fail({ plan: 'Choose a plan.' });
    if (!isCycle(body.cycle)) fail({ cycle: 'Choose a billing cycle.' });
    const preview = previewChange(row, { plan: body.plan, cycle: body.cycle }, 'NOW', todayIso());
    if (preview.blocked) fail({ plan: preview.blocked });
    const planText = `${PLANS[body.plan].name} (${CYCLE_LABELS[body.cycle]})`;
    // A failed setup never shows Active: the firm stays in Trial and the failure is logged.
    if (!row.card || row.declines) {
      record(row, 'Conversion failed', {
        category: 'BILLING',
        to: planText,
        reason: row.card ? 'The first charge was declined (mock).' : 'No payment method on file.',
      });
      return {
        ok: false,
        message: row.card
          ? 'The first charge was declined. The firm stays in Trial; send a payment link to update the card.'
          : 'There is no payment method on file. The firm stays in Trial; send a payment link first.',
      };
    }
    const today = todayIso();
    row.plan = preview.plan;
    row.cycle = preview.cycle;
    row.seats = preview.seats;
    row.addons = preview.addons;
    const amount = cycleCents(preview.netMonthlyCents, preview.cycle);
    charge(row, amount, `${planText}, first ${body.cycle === 'ANNUAL' ? 'year' : 'month'}`);
    row.status = 'ACTIVE';
    row.autoRenew = true;
    row.trial = row.trial ? { ...row.trial, convertedOn: today } : null;
    row.nextBillingOn = addMonths(today, cycleMonths(preview.cycle));
    row.paidThroughOn = row.nextBillingOn;
    row.endsOn = null;
    record(row, 'Converted to paid', {
      from: 'Trial',
      to: planText,
      effectiveOn: today,
      amountCents: amount,
    });
    notify(row, 'Paid subscription confirmed');
    return {
      ok: true,
      message: `Converted to ${planText}; ${money(amount)} was charged. The firm has been notified.`,
    };
  },

  /** Section 6: Auto-Renew off and Cancel at Period End are the same controlled client request. */
  turnOffAutoRenew: async (body: {
    id: string;
    confirmed: boolean;
    source: RequestSource | '';
    notes: string;
  }): Promise<ActionResult> => {
    await ready();
    const row = find(body.id);
    allow(row, ['ACTIVE', 'TRIAL'], 'Turning off Auto-Renew');
    if (!row.autoRenew) fail({ form: 'Auto-Renew is already off.' });
    if (body.confirmed !== true) fail({ confirmed: 'Confirm that the client asked for this.' });
    if (!body.source || !(body.source in REQUEST_SOURCES))
      fail({ source: 'Choose where the request came from.' });
    const notes = text(body.notes, 'notes', 'a note about the request');
    const before = STATUS_LABELS[row.status];
    const ends = row.status === 'TRIAL' && row.trial ? row.trial.endsOn : row.nextBillingOn;
    if (!ends) fail({ form: 'This subscription has no paid-through date.' });
    row.autoRenew = false;
    row.endsOn = ends;
    row.paidThroughOn = row.status === 'TRIAL' ? row.paidThroughOn : ends;
    row.nextBillingOn = null;
    if (row.status === 'ACTIVE') row.status = 'NON_RENEWING';
    record(row, 'Auto-Renew turned off', {
      from: `${before} · Auto-Renew on`,
      to: `${STATUS_LABELS[row.status]} · Auto-Renew off`,
      effectiveOn: ends,
      reason: `${REQUEST_SOURCES[body.source]}: ${notes}`,
    });
    notify(row, `Renewal turned off; access ends ${dayText(ends)}`);
    return {
      ok: true,
      message: `Auto-Renew is off. Access continues until ${dayText(ends)}. The firm has been notified.`,
    };
  },

  /** Reversal never turns Auto-Renew back on silently: `autoRenewOn` must be chosen. */
  reverseCancellation: async (body: {
    id: string;
    autoRenewOn: boolean;
    reason: string;
  }): Promise<ActionResult> => {
    await ready();
    const row = find(body.id);
    allow(row, ['NON_RENEWING', 'TRIAL'], 'Reversing the cancellation');
    if (row.autoRenew) fail({ form: 'Nothing is scheduled to end: Auto-Renew is on.' });
    if (body.autoRenewOn !== true)
      fail({ autoRenewOn: 'Choose to turn Auto-Renew back on to reverse the cancellation.' });
    const reason = text(body.reason, 'reason', 'a reason for the reversal');
    const ends = row.endsOn;
    const before = STATUS_LABELS[row.status];
    row.autoRenew = true;
    row.nextBillingOn = ends;
    row.endsOn = null;
    if (row.status === 'NON_RENEWING') row.status = 'ACTIVE';
    record(row, 'Cancellation reversed', {
      from: `${before} · Auto-Renew off`,
      to: `${STATUS_LABELS[row.status]} · Auto-Renew on`,
      effectiveOn: ends,
      reason,
    });
    notify(row, 'Cancellation reversed');
    return {
      ok: true,
      message: `The cancellation is reversed and Auto-Renew is on${ends ? `; it renews on ${dayText(ends)}` : ''}. The firm has been notified.`,
    };
  },

  suspend: async (body: {
    id: string;
    kind: SuspensionKind;
    reason: string;
    timing: Effective;
  }): Promise<ActionResult> => {
    await ready();
    const row = find(body.id);
    allow(row, SUSPENDABLE, 'Suspending');
    if (!(body.kind in SUSPENSION_LABELS)) fail({ kind: 'Choose the kind of suspension.' });
    if (body.kind === 'NONPAYMENT' && row.status !== 'PAST_DUE')
      fail({ kind: 'Nonpayment suspension is only for past-due subscriptions.' });
    if (!isEffective(body.timing)) fail({ timing: 'Choose when it takes effect.' });
    const reason = text(body.reason, 'reason', 'a reason');
    const label = SUSPENSION_LABELS[body.kind];
    if (body.timing === 'NEXT_BILLING') {
      const on = row.nextBillingOn ?? row.endsOn;
      if (!on) fail({ timing: 'There is no next billing date. Suspend now instead.' });
      row.scheduled = row.scheduled.filter((change) => change.kind !== 'SUSPEND');
      row.scheduled.push({
        id: newId('0007'),
        kind: 'SUSPEND',
        on,
        summary: `${label}: ${reason}`,
      });
      record(row, 'Suspension scheduled', { to: label, effectiveOn: on, reason });
      notify(row, `Suspension scheduled for ${dayText(on)}`);
      return {
        ok: true,
        message: `Suspension scheduled for ${dayText(on)}. The firm has been notified.`,
      };
    }
    const today = todayIso();
    const before = STATUS_LABELS[row.status];
    row.status = 'SUSPENDED';
    row.suspension = { kind: body.kind, reason, since: today };
    row.nextBillingOn = null;
    row.scheduled = row.scheduled.filter((change) => change.kind !== 'SUSPEND');
    record(row, body.kind === 'PAUSE' ? 'Paused' : 'Suspended', {
      from: before,
      to: label,
      effectiveOn: today,
      reason,
    });
    notify(row, 'Suspension notice');
    return {
      ok: true,
      message: `${row.firm.name} is suspended. Data is preserved; access is restricted. The firm has been notified.`,
    };
  },

  reactivate: async (body: {
    id: string;
    reason: string;
    paymentSettled: boolean;
    plan?: PlanId;
    cycle?: BillingCycle;
  }): Promise<ActionResult> => {
    await ready();
    const row = find(body.id);
    if (row.status === 'CLOSED')
      fail({
        form: 'A closed account can’t be reactivated here. Add a new subscription for the firm.',
      });
    allow(row, REACTIVATABLE, 'Reactivating');
    const reason = text(body.reason, 'reason', 'a reason');
    const today = todayIso();
    const before = STATUS_LABELS[row.status];
    if (row.status === 'SUSPENDED') {
      const due = amountDue(row);
      if ((due > 0 || row.suspension?.kind === 'NONPAYMENT') && body.paymentSettled !== true)
        fail({ paymentSettled: 'Confirm the payment is settled before reactivating.' });
      if (due > 0) {
        for (const invoice of row.invoices) if (invoice.status !== 'PAID') invoice.status = 'PAID';
        const paymentId = newId('0004');
        row.payments.push({
          id: paymentId,
          on: today,
          amountCents: due,
          result: 'SUCCEEDED',
          method: 'Recorded by admin',
          reference: `pay_mock_${paymentId.slice(-6)}`,
          message: null,
        });
        record(row, 'Payment recorded', { category: 'BILLING', amountCents: due, reason });
      }
      row.status = 'ACTIVE';
      row.suspension = null;
      row.pastDue = null;
      row.autoRenew = true;
      row.endsOn = null;
      row.nextBillingOn =
        row.paidThroughOn && row.paidThroughOn > today
          ? row.paidThroughOn
          : addMonths(today, cycleMonths(row.cycle));
      record(row, 'Reactivated', { from: before, to: 'Active', effectiveOn: today, reason });
      notify(row, 'Reactivation notice');
      return { ok: true, message: `${row.firm.name} is active again. The firm has been notified.` };
    }
    // Canceled or Expired: a controlled restart with a plan and a working payment method.
    if (!isPlan(body.plan)) fail({ plan: 'Choose a plan.' });
    if (!isCycle(body.cycle)) fail({ cycle: 'Choose a billing cycle.' });
    if (!row.card) fail({ form: 'There is no payment method on file. Send a payment link first.' });
    if (row.declines)
      fail({ form: 'The card on file was declined. Send a payment link to update it.' });
    const preview = previewChange(row, { plan: body.plan, cycle: body.cycle }, 'NOW', today);
    if (preview.blocked) fail({ plan: preview.blocked });
    row.plan = preview.plan;
    row.cycle = preview.cycle;
    row.seats = preview.seats;
    row.addons = preview.addons;
    const amount = cycleCents(netMonthly(row, today), row.cycle);
    const planText = `${PLANS[row.plan].name} (${CYCLE_LABELS[row.cycle]})`;
    charge(row, amount, `${planText}, restart`);
    row.status = 'ACTIVE';
    row.autoRenew = true;
    row.startedOn = today;
    row.endsOn = null;
    row.endedOn = null;
    row.nextBillingOn = addMonths(today, cycleMonths(row.cycle));
    row.paidThroughOn = row.nextBillingOn;
    record(row, 'Reactivated', {
      from: before,
      to: planText,
      effectiveOn: today,
      reason,
      amountCents: amount,
    });
    notify(row, 'Reactivation notice');
    return {
      ok: true,
      message: `${row.firm.name} restarted on ${planText}; ${money(amount)} was charged. The firm has been notified.`,
    };
  },

  /** Retries the failed charge now. Paid before suspension: back to Active. */
  retryPayment: async (body: { id: string }): Promise<ActionResult> => {
    await ready();
    const row = find(body.id);
    allow(row, ['PAST_DUE', 'SUSPENDED'], 'Retrying the payment');
    const due = amountDue(row);
    if (due <= 0) fail({ form: 'Nothing is due.' });
    const today = todayIso();
    const paymentId = newId('0004');
    const ok = !!row.card && !row.declines;
    if (row.card)
      row.payments.push({
        id: paymentId,
        on: today,
        amountCents: due,
        result: ok ? 'SUCCEEDED' : 'FAILED',
        method: cardText(row.card),
        reference: `ch_mock_${paymentId.slice(-6)}`,
        message: ok ? null : 'Card declined (mock)',
      });
    if (!ok) {
      if (row.pastDue) {
        row.pastDue = {
          ...row.pastDue,
          attempts: row.pastDue.attempts + 1,
          nextRetryOn:
            row.status === 'PAST_DUE' && row.pastDue.attempts + 1 < row.pastDue.maxAttempts
              ? addDays(today, 3)
              : null,
        };
      }
      record(row, 'Payment retry failed', {
        category: 'BILLING',
        amountCents: due,
        reason: row.card ? 'Card declined (mock)' : 'No payment method on file',
      });
      return {
        ok: false,
        message: row.card
          ? `The card was declined again. ${row.firm.name} stays ${STATUS_LABELS[row.status]}; send a payment link.`
          : 'There is no card on file. Send a payment link instead.',
      };
    }
    for (const invoice of row.invoices) if (invoice.status !== 'PAID') invoice.status = 'PAID';
    if (row.status === 'PAST_DUE') {
      row.status = 'ACTIVE';
      row.pastDue = null;
      row.paidThroughOn = row.nextBillingOn;
      record(row, 'Payment succeeded', {
        category: 'BILLING',
        from: 'Past Due',
        to: 'Active',
        amountCents: due,
      });
      notify(row, 'Payment received; account in good standing');
      return {
        ok: true,
        message: `${money(due)} was paid. ${row.firm.name} is back to Active. The firm has been notified.`,
      };
    }
    row.pastDue = null;
    record(row, 'Payment succeeded', {
      category: 'BILLING',
      amountCents: due,
      reason: 'Paid while suspended',
    });
    notify(row, 'Payment received');
    return {
      ok: true,
      message: `${money(due)} was paid. Reactivate the subscription to restore access.`,
    };
  },

  addNote: async (body: { id: string; text: string }): Promise<ActionResult> => {
    await ready();
    const row = find(body.id);
    const note = text(body.text, 'text', 'the note', 1000);
    row.notes.push({ id: newId('0005'), at: nowIso(), author: ADMIN.name, text: note });
    record(row, 'Internal note added', { category: 'NOTE' });
    return { ok: true, message: 'Note added.' };
  },

  applyDiscount: async (body: DiscountBody): Promise<ActionResult> => {
    await ready();
    const row = find(body.id);
    if (row.status === 'CLOSED' || row.status === 'CANCELLED')
      fail({
        form: `Discounts can't be added while the subscription is ${STATUS_LABELS[row.status]}.`,
      });
    const today = todayIso();
    const reason = text(body.reason, 'reason', 'a reason');
    const approvedBy = text(body.approvedBy, 'approvedBy', 'who approved it', 100);
    if (!isDay(body.startsOn) || body.startsOn < today)
      fail({ startsOn: 'Choose today or a later date.' });
    if (body.kind === 'CREDIT') {
      const amount = body.amountCents ?? 0;
      if (!Number.isInteger(amount) || amount < 100 || amount > 1_000_000)
        fail({ amount: 'Enter an amount between $1 and $10,000.' });
      row.creditCents += amount;
      record(row, 'Credit applied', {
        category: 'BILLING',
        to: money(amount),
        amountCents: -amount,
        effectiveOn: body.startsOn,
        reason: `${reason} (approved by ${approvedBy})`,
      });
      notify(row, 'Account credit added');
      return {
        ok: true,
        message: `A credit of ${money(amount)} applies to the next invoice. The firm has been notified.`,
      };
    }
    let percent: number;
    let months: number | null;
    let code: string | null = null;
    if (body.kind === 'PROMO') {
      const promo = PROMOS[body.code as PromoCode] as (typeof PROMOS)[PromoCode] | undefined;
      if (!promo) fail({ code: 'Choose a promotion code.' });
      percent = promo.percent;
      months = promo.months;
      code = promo.code;
    } else if (body.kind === 'PERCENT') {
      percent = body.percent ?? 0;
      if (!Number.isInteger(percent) || percent < 1 || percent > 100)
        fail({ percent: 'Enter a whole percentage from 1 to 100.' });
      months = body.months ?? null;
      if (months !== null && (!Number.isInteger(months) || months < 1 || months > 36))
        fail({ months: 'Choose how long it runs.' });
    } else {
      fail({ kind: 'Choose a discount type.' });
    }
    const before = netMonthly(row, body.startsOn);
    const old = row.discount?.label ?? 'None';
    row.discount = {
      id: newId('0006'),
      kind: body.kind,
      code,
      percent,
      label: code ? `${code} (${percent}% off)` : `${percent}% off`,
      startsOn: body.startsOn,
      endsOn: months === null ? null : addMonths(body.startsOn, months),
      reason,
      approvedBy,
    };
    const after = netMonthly(row, body.startsOn);
    record(row, 'Discount applied', {
      category: 'BILLING',
      from: old,
      to: row.discount.label,
      effectiveOn: body.startsOn,
      amountCents: after - before,
      reason: `${reason} (approved by ${approvedBy})`,
    });
    notify(row, 'Billing terms changed');
    return {
      ok: true,
      message: `${row.discount.label} applies from ${dayText(body.startsOn)}: ${money(after)}/mo instead of ${money(before)}. The firm has been notified.`,
    };
  },

  removeDiscount: async (body: { id: string; reason: string }): Promise<ActionResult> => {
    await ready();
    const row = find(body.id);
    if (!row.discount) fail({ form: 'There is no discount to remove.' });
    const reason = text(body.reason, 'reason', 'a reason');
    const old = row.discount.label;
    row.discount = null;
    record(row, 'Discount removed', {
      category: 'BILLING',
      from: old,
      to: 'None',
      effectiveOn: todayIso(),
      reason,
    });
    notify(row, 'Billing terms changed');
    return { ok: true, message: `${old} is removed. The firm has been notified.` };
  },

  sendPaymentLink: async (body: {
    id: string;
    purpose: 'BALANCE' | 'CARD_UPDATE';
    amountCents: number;
    channel: 'EMAIL' | 'SMS';
  }): Promise<ActionResult> => {
    await ready();
    const row = find(body.id);
    if (row.status === 'CLOSED')
      fail({ form: 'Payment links can’t be sent for a closed account.' });
    if (body.channel !== 'EMAIL' && body.channel !== 'SMS')
      fail({ channel: 'Choose how to send it.' });
    if (body.purpose === 'BALANCE') {
      if (
        !Number.isInteger(body.amountCents) ||
        body.amountCents < 100 ||
        body.amountCents > 1_000_000
      )
        fail({ amount: 'Enter an amount between $1 and $10,000.' });
    } else if (body.purpose !== 'CARD_UPDATE') {
      fail({ purpose: 'Choose what the link is for.' });
    }
    const where = body.channel === 'EMAIL' ? row.firm.email : 'the billing contact’s phone';
    const what =
      body.purpose === 'BALANCE'
        ? `Payment link for ${money(body.amountCents)}`
        : 'Card update link';
    record(row, `${what} sent`, {
      category: 'BILLING',
      to: body.channel === 'EMAIL' ? `Email: ${row.firm.email}` : 'Text message',
      amountCents: body.purpose === 'BALANCE' ? body.amountCents : null,
      effectiveOn: todayIso(),
    });
    return { ok: true, message: `${what} sent to ${where} on ${dayText(todayIso())}.` };
  },

  resendInvoice: async (body: {
    id: string;
    invoiceId: string;
    email: string;
  }): Promise<ActionResult> => {
    await ready();
    const row = find(body.id);
    const invoice = row.invoices.find((candidate) => candidate.id === body.invoiceId);
    if (!invoice) fail({ invoiceId: 'Choose an invoice.' });
    const email = (body.email ?? '').trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254)
      fail({ email: 'Enter a valid email address.' });
    invoice.lastSentOn = todayIso();
    record(row, 'Invoice resent', {
      category: 'BILLING',
      to: `${invoice.number} to ${email}`,
      amountCents: invoice.amountCents,
    });
    return { ok: true, message: `${invoice.number} was sent to ${email}.` };
  },

  changeBillingDate: async (body: {
    id: string;
    date: string;
    reason: string;
  }): Promise<ActionResult> => {
    await ready();
    const row = find(body.id);
    allow(row, ['ACTIVE', 'PAST_DUE'], 'Changing the billing date');
    const today = todayIso();
    if (!row.nextBillingOn) fail({ form: 'There is no next billing date to move.' });
    if (!isDay(body.date) || body.date <= today) fail({ date: 'Choose a date after today.' });
    if (body.date === row.nextBillingOn) fail({ date: 'Choose a different date.' });
    if (daysBetween(today, body.date) > cycleDays(row.cycle))
      fail({ date: `Choose a date within one ${row.cycle === 'ANNUAL' ? 'year' : 'month'}.` });
    const reason = text(body.reason, 'reason', 'a reason');
    const amount = previewBillingDate(row, body.date, today);
    const old = row.nextBillingOn;
    row.nextBillingOn = body.date;
    row.paidThroughOn = body.date;
    if (amount < 0) row.creditCents += -amount;
    record(row, 'Billing date changed', {
      category: 'BILLING',
      from: dayText(old),
      to: dayText(body.date),
      effectiveOn: body.date,
      amountCents: amount || null,
      reason,
    });
    notify(row, 'Billing date changed');
    return {
      ok: true,
      message: `The next billing date is ${dayText(body.date)}.${amount > 0 ? ` ${money(amount)} for the extra days is added to that invoice.` : amount < 0 ? ` A credit of ${money(-amount)} applies.` : ''} The firm has been notified.`,
    };
  },

  /** A time-limited, logged support view; the page shows a banner while it runs. */
  startSupportView: async (body: {
    id: string;
    reason: string;
    minutes: number;
  }): Promise<ActionResult> => {
    await ready();
    const row = find(body.id);
    if (row.status === 'CLOSED') fail({ form: 'A closed account has no workspace to view.' });
    if (![15, 30, 60].includes(body.minutes)) fail({ minutes: 'Choose 15, 30 or 60 minutes.' });
    const reason = text(body.reason, 'reason', 'a reason for the support view');
    const until = new Date(Date.now() + body.minutes * 60_000).toISOString();
    row.supportView = { until, reason };
    record(row, 'Support view started', { category: 'ACCESS', to: `Until ${until}`, reason });
    return {
      ok: true,
      message: `Support view of ${row.firm.name} started for ${body.minutes} minutes. It is logged.`,
    };
  },

  endSupportView: async (body: { id: string }): Promise<ActionResult> => {
    await ready();
    const row = find(body.id);
    if (!liveSupport(row)) fail({ form: 'No support view is running.' });
    row.supportView = null;
    record(row, 'Support view ended', { category: 'ACCESS' });
    return { ok: true, message: 'Support view ended.' };
  },

  closeAccount: async (body: {
    id: string;
    reason: string;
    effectiveOn: string;
    confirmName: string;
    impactReviewed: boolean;
  }): Promise<ActionResult> => {
    await ready();
    const row = find(body.id);
    if (row.status === 'CLOSED') fail({ form: 'This account is already closed.' });
    const today = todayIso();
    const reason = text(body.reason, 'reason', 'a reason');
    if (!isDay(body.effectiveOn) || body.effectiveOn < today)
      fail({ effectiveOn: 'Choose today or a later date.' });
    if ((body.confirmName ?? '').trim().toLowerCase() !== row.firm.name.toLowerCase())
      fail({ confirmName: 'Type the firm name exactly as shown.' });
    if (body.impactReviewed !== true)
      fail({ impactReviewed: 'Confirm you reviewed the data and access impact.' });
    if (body.effectiveOn > today) {
      row.scheduled = row.scheduled.filter((change) => change.kind !== 'CLOSE');
      row.scheduled.push({
        id: newId('0007'),
        kind: 'CLOSE',
        on: body.effectiveOn,
        summary: `Close account: ${reason}`,
      });
      record(row, 'Account closure scheduled', {
        to: 'Closed',
        effectiveOn: body.effectiveOn,
        reason,
      });
      notify(row, `Account closure scheduled for ${dayText(body.effectiveOn)}`);
      return {
        ok: true,
        message: `The account closes on ${dayText(body.effectiveOn)}. The firm has been notified.`,
      };
    }
    const before = STATUS_LABELS[row.status];
    row.status = 'CLOSED';
    row.autoRenew = false;
    row.nextBillingOn = null;
    row.endsOn = today;
    row.endedOn = today;
    row.supportView = null;
    row.scheduled = [];
    record(row, 'Account closed', { from: before, to: 'Closed', effectiveOn: today, reason });
    notify(row, 'Account closure notice');
    return {
      ok: true,
      message: `${row.firm.name} is closed. Its data is kept under the retention policy.`,
    };
  },

  /** Subscription and billing metadata only: no client records or documents. */
  exportCsv: async (body: { ids: string[] }): Promise<{ csv: string; count: number }> => {
    await ready();
    const today = todayIso();
    const rows = db().rows.filter((row) => body.ids.includes(row.id));
    if (!rows.length) fail({ form: 'There is nothing to export.' });
    const cell = (value: string | number) => {
      const raw = String(value);
      // A leading =, +, - or @ would run as a formula in a spreadsheet.
      const safe = /^[=+\-@]/.test(raw) ? `'${raw}` : raw;
      return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
    };
    const head = [
      'Firm',
      'Email',
      'Domain',
      'Plan',
      'Billing cycle',
      'Status',
      'Monthly list price',
      'Monthly after discount',
      'Seats used',
      'Seats allowed',
      'Next billing',
      'Ends',
      'Auto-Renew',
      'Add-ons',
      'Discount',
    ];
    const lines = rows.map((row) => {
      const item = listItem(row, today);
      return [
        row.firm.name,
        row.firm.email,
        row.firm.domain,
        PLANS[row.plan].name,
        CYCLE_LABELS[row.cycle],
        STATUS_LABELS[row.status],
        (item.monthlyCents / 100).toFixed(2),
        (item.netMonthlyCents / 100).toFixed(2),
        row.seatsUsed,
        row.seats,
        row.nextBillingOn ?? '',
        row.endsOn ?? '',
        row.autoRenew ? 'On' : 'Off',
        row.addons.map((id) => ADDONS[id].name).join('; '),
        item.discount?.label ?? '',
      ]
        .map(cell)
        .join(',');
    });
    for (const row of rows) record(row, 'Subscription data exported', { category: 'ACCESS' });
    return { csv: [head.map(cell).join(','), ...lines].join('\n'), count: rows.length };
  },
};
