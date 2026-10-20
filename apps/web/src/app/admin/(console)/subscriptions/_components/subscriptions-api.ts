import {
  AddSubscriptionNoteRequest,
  adminSubscriptionsExportPath,
  ApiError,
  ApiRequestError,
  BILLING_ERRORS,
  BILLING_INVOICE_STATUS_LABELS,
  BILLING_PAYMENT_METHOD_LABELS,
  BILLING_PAYMENT_STATUS_LABELS,
  ChangeBillingDateRequest,
  CloseSubscriptionRequest,
  CreateSubscriptionRequest,
  CreateSupportAccessRequest,
  ExtendSubscriptionTrialRequest,
  previewSubscriptionChange,
  ReactivateSubscriptionRequest,
  ReverseCancellationRequest,
  SaveBillingCreditNoteRequest,
  SetSubscriptionPriceRequest,
  SUBSCRIPTION_CHANGEABLE_STATUSES,
  SUBSCRIPTION_CYCLE_LABELS,
  SUBSCRIPTION_ERRORS,
  SUBSCRIPTION_EVENT_CATEGORY,
  SUBSCRIPTION_PAYING_STATUSES,
  SUBSCRIPTION_REACTIVATABLE_STATUSES,
  SUBSCRIPTION_REQUEST_SOURCE_LABELS,
  SUBSCRIPTION_STATUS_FILTER_LABELS,
  SUBSCRIPTION_STATUS_LABELS,
  SUBSCRIPTION_STATUS_ORDER,
  SUBSCRIPTION_SUSPENSION_LABELS,
  SUBSCRIPTION_TRIAL_DAYS,
  subscriptionAddDays,
  subscriptionAddMonths,
  subscriptionBillingDateCents,
  subscriptionCycleMonths,
  subscriptionDaysBetween,
  subscriptionEventText,
  SubscriptionId,
  subscriptionMonthlyCents,
  subscriptionPriceCents,
  subscriptionSeatRange,
  SuspendSubscriptionRequest,
  TurnOffAutoRenewRequest,
  UpdateSubscriptionLocationsRequest,
  UpdateSubscriptionSeatsRequest,
  type BillingInvoiceStatus,
  type PlatformPaymentStatus,
  type SubscriptionChangePreview,
  type SubscriptionEvent as ApiEvent,
  type SubscriptionInvoice as ApiInvoice,
  type SubscriptionMeta,
  type SubscriptionPayment as ApiPayment,
  type SubscriptionPlan as ApiPlan,
  type SubscriptionRecord,
  type SubscriptionResult,
  type SubscriptionRow,
  type SubscriptionsQuery,
  type SubscriptionStatusFilter,
} from '@firmivra/types';
import { api } from '../../../../../lib/api';
import { errorMessage as baseErrorMessage } from '../../../../../lib/errors';
import { mocked } from '../../../../../lib/mock';
import { sessionFetch } from '../../../../../lib/session';
import type * as Mock from '../../../../../mocks/admin-subscriptions';
import {
  ADDON_ORDER,
  ADDONS,
  adminSubscriptions as mockSubscriptions,
  cycleCents,
  discountRuns as mockDiscountRuns,
  monthlyListCents as mockMonthlyListCents,
  netMonthlyCents as mockNetMonthlyCents,
  PLAN_ORDER as MOCK_PLAN_ORDER,
  PLANS as MOCK_PLANS,
  previewBillingDate as mockPreviewBillingDate,
  previewChange as mockPreviewChange,
  PROMOS as MOCK_PROMOS,
  STATUS_ORDER as MOCK_STATUS_ORDER,
  SubscriptionInputError,
} from '../../../../../mocks/admin-subscriptions';

// The Subscriptions screen's data (R60): `api.adminSubscriptions` (contract
// packages/types/src/admin-subscriptions), under the names and shapes the screen was built with
// (mocks/admin-subscriptions.ts). Mock mode (NEXT_PUBLIC_API_MOCK=adminSubscriptions) keeps the
// mock. What differs from the mock (docs/work/R60-subscriptions.md, "Subscriptions screen") is
// handled here:
// - A plan is its code (SOLO_CORE …), from meta(); a request looks up the plan's id.
// - The filters go to the API; the table reads every page and sorts and pages as before.
// - Prices, previews and proration are the contract's functions, so they match what the API bills.
// - A negotiated base price is the row's discount; account credit is Billing's credit note.
// - Seats in use may be unknown (null); storage and texts are not counted.
// - Promotion codes, timed discounts, the other add-ons, scheduled changes, a card on file,
//   payment links and retries, notifying the firm and ending support access: 422.

const MODULE = 'adminSubscriptions';
const MOCKED = mocked(MODULE);

// ---------- Types the screen uses ----------

export type {
  ActionResult,
  AddonId,
  BillingCycle,
  DiscountBody,
  Effective,
  EventCategory,
  Figure,
  RequestSource,
  SubscriptionStats,
  SuspensionKind,
} from '../../../../../mocks/admin-subscriptions';

/** The mock's eight: the API has no Closed (a Canceled subscription with a closure, note 4). */
export type SubscriptionStatus = Mock.SubscriptionStatus;
export type StatusFilter = Mock.StatusFilter;

/** The plan's code (SOLO_CORE …): the same in every environment, and the mock's plan ids. */
export type PlanId = string;
/** A promotion code; none are stored on the API (note 6). */
export type PromoCode = string;

/** A plan as the dialogs show it: prices a month (an annual price ÷ 12). */
export interface Plan {
  id: PlanId;
  name: string;
  monthlyCents: number;
  includedSeats: number;
  /** null: no ceiling. */
  maxSeats: number | null;
  /** Each seat above the included ones, a month; null when the plan sells none. */
  extraSeatCents: number | null;
  locations: number;
  priceFrom: boolean;
}

/** The mock's discount, or the API's negotiated base price (NEGOTIATED: no dates or percent). */
export type Discount = Omit<
  Mock.Discount,
  'kind' | 'percent' | 'startsOn' | 'reason' | 'approvedBy'
> & {
  kind: Mock.Discount['kind'] | 'NEGOTIATED';
  percent: number | null;
  startsOn: string | null;
  reason: string | null;
  approvedBy: string | null;
};
/** No retry schedule or grace period is stored (note 12): those parts are null on the API. */
export interface PastDueInfo {
  failedOn: string | null;
  attempts: number;
  maxAttempts: number | null;
  nextRetryOn: string | null;
  graceEndsOn: string | null;
  response: string | null;
}
/** The mock's three statuses, or Billing's eight. */
export type Invoice = Omit<Mock.Invoice, 'status'> & {
  status: Mock.Invoice['status'] | BillingInvoiceStatus;
};
/** The mock's two results, or Billing's payment statuses. */
export type Payment = Omit<Mock.Payment, 'result'> & {
  result: Mock.Payment['result'] | PlatformPaymentStatus;
};
/** An audit-only event has no status, and older history rows no MRR. */
export type SubscriptionEvent = Omit<Mock.SubscriptionEvent, 'status' | 'mrrCents'> & {
  status: SubscriptionStatus | null;
  mrrCents: number | null;
};
/** `used` is null when it is not counted (seats before the rollup, locations). */
export type UsageLimit = Omit<Mock.UsageLimit, 'used'> & { used: number | null };

export type SubscriptionListItem = Omit<
  Mock.SubscriptionListItem,
  'plan' | 'seatsUsed' | 'usagePercent' | 'discount'
> & {
  plan: PlanId;
  /** null until the platform's daily rollup counts the firm's users (note 3). */
  seatsUsed: number | null;
  usagePercent: number | null;
  discount: Discount | null;
};
type DetailOwn = Omit<
  Mock.SubscriptionDetail,
  | keyof Mock.SubscriptionListItem
  | 'trial'
  | 'pastDue'
  | 'supportView'
  | 'usage'
  | 'invoices'
  | 'payments'
  | 'events'
>;
export type SubscriptionDetail = SubscriptionListItem &
  DetailOwn & {
    trial: (Mock.TrialInfo & { daysLeft: number; followUp: string | null }) | null;
    pastDue: PastDueInfo | null;
    supportView: { until: string; reason: string | null } | null;
    usage: UsageLimit[];
    invoices: Invoice[];
    payments: Payment[];
    events: SubscriptionEvent[];
  };
/** `priceCents`: the new terms' price per billing cycle, as the API bills it. */
export type ChangePreview = Omit<Mock.ChangePreview, 'plan'> & { plan: PlanId; priceCents: number };
export type SubscriptionQuery = Omit<Mock.SubscriptionQuery, 'plan'> & { plan?: PlanId | '' };
export interface SubscriptionPage {
  items: SubscriptionListItem[];
  total: number;
  all: number;
}
export type CreateSubscriptionBody = Omit<Mock.CreateSubscriptionBody, 'plan'> & { plan: PlanId };

// ---------- Constants and labels ----------

export { ADDON_ORDER, ADDONS, cycleCents, SubscriptionInputError };

export const CYCLE_LABELS = SUBSCRIPTION_CYCLE_LABELS;
/** The contract's seven, and the mock's Closed (a Canceled subscription with a closure). */
export const STATUS_LABELS: Readonly<Record<SubscriptionStatus, string>> = {
  ...SUBSCRIPTION_STATUS_LABELS,
  CLOSED: 'Closed',
};
/** The Status filter's and the table's order: the API has no Closed. */
export const STATUS_ORDER: readonly SubscriptionStatus[] = MOCKED
  ? MOCK_STATUS_ORDER
  : SUBSCRIPTION_STATUS_ORDER;
export const SUSPENSION_LABELS = SUBSCRIPTION_SUSPENSION_LABELS;
export const REQUEST_SOURCES = SUBSCRIPTION_REQUEST_SOURCE_LABELS;
export const PAYING: readonly SubscriptionStatus[] = SUBSCRIPTION_PAYING_STATUSES;
export const CHANGEABLE: readonly SubscriptionStatus[] = SUBSCRIPTION_CHANGEABLE_STATUSES;
/** Pause / Suspend: the same statuses as a plan change. */
export const SUSPENDABLE: readonly SubscriptionStatus[] = SUBSCRIPTION_CHANGEABLE_STATUSES;
export const REACTIVATABLE: readonly SubscriptionStatus[] = SUBSCRIPTION_REACTIVATABLE_STATUSES;

/** The Status filter: the statuses, then the KPI cards' groups (the mock's "Canceled or Closed"). */
export const STATUS_FILTERS: readonly { value: StatusFilter; label: string }[] = [
  ...STATUS_ORDER.map((status) => ({ value: status, label: STATUS_LABELS[status] })),
  { value: 'PAYING', label: SUBSCRIPTION_STATUS_FILTER_LABELS.PAYING },
  { value: 'RENEWING_SOON', label: SUBSCRIPTION_STATUS_FILTER_LABELS.RENEWING_SOON },
  ...(MOCKED ? [{ value: 'ENDED' as const, label: 'Canceled or Closed' }] : []),
];
/** What the Churn card filters: the API's Canceled (note 4). */
export const CHURN_FILTER: StatusFilter = MOCKED ? 'ENDED' : 'CANCELLED';

/** The mock's promotion codes; none on the API (note 6), so its list is empty. */
export const PROMOS: Readonly<
  Record<PromoCode, { code: string; percent: number; months: number }>
> = MOCKED ? MOCK_PROMOS : {};
/** Add Subscription's owners: the mock's names; on the API the owner is Sales' (note 24). */
export const ACCOUNT_OWNERS: readonly string[] = MOCKED ? ['Jordan Sales', 'Casey Accounts'] : [];

/** The mock emails the firm about each change; the API sends nothing yet (note 18). */
export const NOTIFIES_FIRM = MOCKED;
/** The mock charges a card on file; the API issues Billing's invoices and credit notes (note 9). */
export const CHARGES_CARD = MOCKED;
/** The mock's discounts can end; a negotiated price has no end date (note 6). */
export const TIMED_DISCOUNTS = MOCKED;
/** Support access is a request the firm's Owner approves (R8, note 23); the mock starts a view. */
export const SUPPORT_BY_REQUEST = !MOCKED;

export const EXPORT_COLUMNS = MOCKED
  ? 'firm, email, domain, plan, billing cycle, status, list and discounted monthly price, seats used and allowed, next billing, end date, Auto-Renew, add-ons and discount'
  : 'firm, email, domain, plan, billing cycle, status, list, billed and monthly price, seats used and allowed, extra locations, next billing, access end, Auto-Renew and negotiated base price';

type Tone = 'success' | 'info' | 'warning' | 'danger' | 'neutral';
/** The Billing tab's invoice badges: the mock's three and Billing's eight. */
export const INVOICE_BADGE: Readonly<Record<Invoice['status'], { label: string; tone: Tone }>> = {
  OPEN: { label: 'Open', tone: 'warning' },
  FAILED: { label: 'Failed', tone: 'danger' },
  DRAFT: { label: BILLING_INVOICE_STATUS_LABELS.DRAFT, tone: 'neutral' },
  PENDING: { label: BILLING_INVOICE_STATUS_LABELS.PENDING, tone: 'warning' },
  PARTIALLY_PAID: { label: BILLING_INVOICE_STATUS_LABELS.PARTIALLY_PAID, tone: 'warning' },
  PAID: { label: BILLING_INVOICE_STATUS_LABELS.PAID, tone: 'success' },
  OVERDUE: { label: BILLING_INVOICE_STATUS_LABELS.OVERDUE, tone: 'danger' },
  VOIDED: { label: BILLING_INVOICE_STATUS_LABELS.VOIDED, tone: 'neutral' },
  PARTIALLY_REFUNDED: { label: BILLING_INVOICE_STATUS_LABELS.PARTIALLY_REFUNDED, tone: 'info' },
  REFUNDED: { label: BILLING_INVOICE_STATUS_LABELS.REFUNDED, tone: 'neutral' },
};
/** The payment badges: the mock's two results and Billing's payment statuses. */
export const PAYMENT_BADGE: Readonly<Record<Payment['result'], { label: string; tone: Tone }>> = {
  SUCCEEDED: { label: 'Succeeded', tone: 'success' },
  FAILED: { label: BILLING_PAYMENT_STATUS_LABELS.FAILED, tone: 'danger' },
  PENDING: { label: BILLING_PAYMENT_STATUS_LABELS.PENDING, tone: 'warning' },
  COMPLETED: { label: BILLING_PAYMENT_STATUS_LABELS.COMPLETED, tone: 'success' },
  PARTIALLY_REFUNDED: { label: BILLING_PAYMENT_STATUS_LABELS.PARTIALLY_REFUNDED, tone: 'info' },
  REFUNDED: { label: BILLING_PAYMENT_STATUS_LABELS.REFUNDED, tone: 'neutral' },
};

// ---------- Days and money ----------

export const addDays = subscriptionAddDays;
export const daysBetween = subscriptionDaysBetween;
export const addMonths = subscriptionAddMonths;
export const cycleMonths = subscriptionCycleMonths;

const utcToday = () => new Date().toISOString().slice(0, 10);
const dayOf = (iso: string) => new Date(iso).toISOString().slice(0, 10);
const money = (cents: number) =>
  (cents / 100).toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: cents % 100 === 0 ? 0 : 2,
  });
const dayText = (day: string | null) =>
  day
    ? new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeZone: 'UTC' }).format(
        new Date(`${day}T00:00:00.000Z`),
      )
    : '—';
const seatText = (seats: number) => `${seats} ${seats === 1 ? 'seat' : 'seats'}`;
const locationText = (count: number) => `${count} extra ${count === 1 ? 'location' : 'locations'}`;
const planText = (row: Pick<SubscriptionRow, 'plan' | 'billingCycle'>) =>
  `${row.plan.name} (${CYCLE_LABELS[row.billingCycle]})`;

// ---------- Errors ----------

/** A feature the API has no data or route for yet, or another module's error: shown as written. */
class SubscriptionNotice extends ApiRequestError {
  constructor(status: number, code: string, message: string) {
    super(status, code, message);
    this.name = 'SubscriptionNotice';
  }
}
const notYet = (message: string) => new SubscriptionNotice(422, 'NOT_SUPPORTED_YET', message);

/** R8's codes on a support access request. */
const SUPPORT_ERRORS: Readonly<Record<string, string>> = {
  SUPPORT_REQUEST_OPEN: 'You already have an open support access request for this firm.',
  FIRM_NOT_ACTIVE: 'This firm is not active, so no Owner can approve support access.',
};

/**
 * lib/errors' errorMessage with the Subscriptions codes (SUBSCRIPTION_ERRORS). A field error, an
 * adapter 422 or another module's error read as their own text.
 */
export function errorMessage(error: unknown): string {
  if (error instanceof SubscriptionInputError)
    return error.fields['form'] ?? Object.values(error.fields)[0] ?? error.message;
  if (error instanceof SubscriptionNotice) return error.message;
  return baseErrorMessage(error, { ...SUBSCRIPTION_ERRORS, ...SUPPORT_ERRORS });
}

interface Issue {
  readonly path: readonly PropertyKey[];
  readonly message: string;
}
interface Checked<T> {
  safeParse(
    value: unknown,
  ): { success: true; data: T } | { success: false; error: { issues: readonly Issue[] } };
}

/**
 * The contract's checks before anything is sent, each message next to the field `fields` names for
 * the issue's first key ('form' when none: the dialog's general line).
 */
function check<T>(schema: Checked<T>, value: unknown, fields: Readonly<Record<string, string>>): T {
  const result = schema.safeParse(value);
  if (result.success) return result.data;
  const found: Record<string, string> = {};
  for (const issue of result.error.issues)
    found[fields[String(issue.path[0])] ?? 'form'] ??= issue.message;
  throw new SubscriptionInputError(found);
}

/** The API's codes for one field (`codes`: code → field) go next to that field. */
async function fieldsOf<T>(call: Promise<T>, codes: Readonly<Record<string, string>>): Promise<T> {
  try {
    return await call;
  } catch (error) {
    const field = error instanceof ApiRequestError ? codes[error.code] : undefined;
    if (field) throw new SubscriptionInputError({ [field]: errorMessage(error) });
    throw error;
  }
}

/** A Billing call: its errors read with Billing's messages (BILLING_ERRORS). */
async function billing<T>(call: Promise<T>): Promise<T> {
  try {
    return await call;
  } catch (error) {
    if (!(error instanceof ApiRequestError)) throw error;
    throw new SubscriptionNotice(error.status, error.code, baseErrorMessage(error, BILLING_ERRORS));
  }
}

const PLAN_CODES = {
  PLAN_INACTIVE: 'plan',
  SEATS_IN_USE: 'plan',
  SEATS_OUT_OF_RANGE: 'plan',
  LOCATIONS_NOT_OFFERED: 'plan',
};

/** Every change applies now (note 8): a change "at next billing" has no table to wait in. */
function applyNow(effective: Mock.Effective, message: string) {
  if (effective === 'NEXT_BILLING') throw notYet(message);
}
const LATER = 'Changes at the next billing date are not available yet. Choose Immediately.';

// ---------- Plans ----------

let meta: SubscriptionMeta | undefined;
let loadingMeta: Promise<SubscriptionMeta> | undefined;

/** The plans and today: read once, and again on every meta(). */
function loadMeta(fresh = false): Promise<SubscriptionMeta> {
  if (fresh || !loadingMeta)
    loadingMeta = api.adminSubscriptions.meta().then(
      (read) => (meta = read),
      (error: unknown) => {
        loadingMeta = undefined;
        throw error;
      },
    );
  return loadingMeta;
}

const apiPlanOf = (code: PlanId) => meta?.plans.find((plan) => plan.code === code);
/** Plan names from the rows read, for a plan the plans read last no longer list. */
const names = new Map<PlanId, string>();

/** The plan by its code; a plan no longer listed is the form's error. */
async function planFor(code: PlanId, field: string): Promise<ApiPlan> {
  const plan = (await loadMeta()).plans.find((item) => item.code === code);
  if (!plan) throw new SubscriptionInputError({ [field]: 'Choose a plan.' });
  return plan;
}

function planOut(plan: ApiPlan): Plan {
  const range = subscriptionSeatRange(plan);
  return {
    id: plan.code,
    name: plan.name,
    monthlyCents: subscriptionMonthlyCents(plan.priceCents, plan.billingCycle),
    includedSeats: range.min,
    maxSeats: range.max,
    extraSeatCents:
      plan.seatPriceCents === null
        ? null
        : subscriptionMonthlyCents(plan.seatPriceCents, plan.billingCycle),
    locations: plan.includedLocations,
    // "From $799/mo" is not stored (note 1).
    priceFrom: false,
  };
}

const mockPlans = (): Plan[] => MOCK_PLAN_ORDER.map((id) => MOCK_PLANS[id]);

/** Every plan in display order (the API's as read last, inactive ones too): the plan filter. */
export function planList(): Plan[] {
  return MOCKED ? mockPlans() : (meta?.plans ?? []).map(planOut);
}
/** The plans a firm can be put on: the active ones, and `current` (it may keep an inactive one). */
export function planChoices(current?: PlanId): Plan[] {
  if (MOCKED) return mockPlans();
  return (meta?.plans ?? []).filter((plan) => plan.active || plan.code === current).map(planOut);
}
export function planOf(id: PlanId): Plan | undefined {
  if (MOCKED) return mockPlans().find((plan) => plan.id === id);
  const plan = apiPlanOf(id);
  return plan ? planOut(plan) : undefined;
}
export const planName = (id: PlanId): string => planOf(id)?.name ?? names.get(id) ?? id;
/** The plan's place in the display order, for the table's sort (an unknown plan last). */
export function planRank(id: PlanId): number {
  const index = planList().findIndex((plan) => plan.id === id);
  return index < 0 ? Number.MAX_SAFE_INTEGER : index;
}

// ---------- Records ----------

/** The records last read, by id: the previews and the Billing calls need their API fields. */
const records = new Map<string, SubscriptionRecord>();

async function recordFor(id: string): Promise<SubscriptionRecord> {
  const known = records.get(id);
  if (known) return known;
  const record = await api.adminSubscriptions.subscription(id);
  records.set(id, record);
  return record;
}

/** The negotiated base price as the row's discount; its reason is the latest PRICE_CHANGED's. */
function discountOut(row: SubscriptionRow, events: readonly ApiEvent[]): Discount | null {
  if (row.baseOverrideCents === null) return null;
  const set = events.find(
    (event) => event.action === 'PRICE_CHANGED' && event.toCents === row.baseOverrideCents,
  );
  return {
    id: set?.id ?? row.id,
    kind: 'NEGOTIATED',
    code: null,
    percent: null,
    label: 'Negotiated price',
    startsOn: set ? dayOf(set.at) : null,
    endsOn: null,
    reason: set?.reason ?? null,
    approvedBy: set?.approvedBy ?? null,
  };
}

function rowOut(row: SubscriptionRow, events: readonly ApiEvent[] = []): SubscriptionListItem {
  names.set(row.plan.code, row.plan.name);
  return {
    id: row.id,
    firm: {
      id: row.firm.id,
      name: row.firm.name,
      email: row.firm.email ?? '',
      domain: row.firm.domain ?? '',
    },
    plan: row.plan.code,
    cycle: row.billingCycle,
    status: row.status,
    seats: row.seatsAllowed,
    seatsUsed: row.seatsUsed,
    usagePercent: row.usagePercent,
    // The mock's list price a month (before the discount) and the price as billed.
    monthlyCents: subscriptionMonthlyCents(row.listPriceCents, row.billingCycle),
    netMonthlyCents: row.monthlyCents,
    // The Additional Location add-on is the only one stored (note 5).
    addons: row.extraLocations > 0 ? ['EXTRA_LOCATION'] : [],
    discount: discountOut(row, events),
    creditCents: row.creditCents,
    autoRenew: row.autoRenew,
    nextBillingOn: row.nextBillingOn,
    endsOn: row.accessEndsOn,
    trialEndsOn: row.trialEndsOn,
    supportViewUntil: row.supportAccessUntil,
  };
}

const priceOf = (cents: number | null) => (cents === null ? 'Plan price' : money(cents));

/** The old and new values an event reads with (the mock kept them as prepared text). */
function changeOf(event: ApiEvent): { from: string | null; to: string | null } {
  const pair = (from: string | null, to: string | null) =>
    from === to ? { from: null, to: null } : { from, to };
  const status = (value: SubscriptionStatus | null) => (value ? STATUS_LABELS[value] : null);
  switch (event.action) {
    case 'TRIAL_EXTENDED':
    case 'BILLING_DATE_CHANGED':
      return pair(event.fromDay && dayText(event.fromDay), event.toDay && dayText(event.toDay));
    case 'PRICE_CHANGED':
      return pair(priceOf(event.fromCents), priceOf(event.toCents));
    case 'LOCATIONS_CHANGED':
      return pair(
        event.fromLocations === null ? null : locationText(event.fromLocations),
        event.toLocations === null ? null : locationText(event.toLocations),
      );
    case 'SEATS_CHANGED':
      return pair(
        event.fromSeats === null ? null : seatText(event.fromSeats),
        event.toSeats === null ? null : seatText(event.toSeats),
      );
    case 'CREATED':
      return { from: null, to: event.toPlan };
    case 'UPGRADED':
    case 'DOWNGRADED':
      return pair(event.fromPlan, event.toPlan);
    // The history keeps no cycles (note 19); notes and exports change nothing.
    case 'CYCLE_CHANGED':
    case 'NOTE_ADDED':
    case 'EXPORTED':
      return { from: null, to: null };
    default:
      return pair(status(event.fromStatus), status(event.toStatus));
  }
}

function eventOut(event: ApiEvent): SubscriptionEvent {
  const { from, to } = changeOf(event);
  const approved = event.approvedBy;
  return {
    id: event.id,
    at: event.at,
    category: SUBSCRIPTION_EVENT_CATEGORY[event.action],
    action: subscriptionEventText(event),
    actor: event.actor.name,
    role: event.actor.kind === 'USER' ? 'Super Admin' : 'System',
    from,
    to,
    effectiveOn: null,
    reason:
      approved && event.reason
        ? `${event.reason} (approved by ${approved})`
        : approved
          ? `Approved by ${approved}`
          : event.reason,
    amountCents: event.amountCents,
    status: event.toStatus,
    mrrCents: event.mrrCents,
  };
}

const invoiceOut = (invoice: ApiInvoice): Invoice => ({
  id: invoice.id,
  number: invoice.number,
  issuedOn: invoice.issueDate,
  amountCents: invoice.totalCents,
  status: invoice.status,
  description: invoice.description,
  lastSentOn: invoice.sentAt ? dayOf(invoice.sentAt) : null,
});

const paymentOut = (payment: ApiPayment): Payment => ({
  id: payment.id,
  on: payment.paidOn,
  amountCents: payment.amountCents,
  result: payment.status,
  method: BILLING_PAYMENT_METHOD_LABELS[payment.method],
  reference: [payment.invoiceNumber, payment.reference].filter(Boolean).join(' · '),
  message: payment.failureReason,
});

/** Seats (in use from the rollup) and locations (allowed only); storage and texts are not counted. */
function usageOut(record: SubscriptionRecord): UsageLimit[] {
  return [
    {
      id: 'seats',
      label: 'Seats',
      used: record.seatsUsed,
      limit: record.seatsAllowed,
      unit: 'seats',
    },
    ...(record.locationsAllowed > 1
      ? [
          {
            id: 'locations' as const,
            label: 'Locations',
            used: null,
            limit: record.locationsAllowed,
            unit: 'locations',
          },
        ]
      : []),
  ];
}

function detailOut(record: SubscriptionRecord): SubscriptionDetail {
  records.set(record.id, record);
  const renews = record.autoRenew && (record.status === 'ACTIVE' || record.status === 'PAST_DUE');
  const due = record.pastDue;
  return {
    ...rowOut(record, record.events),
    today: record.today,
    startedOn: record.startedOn,
    renewalOn: renews
      ? record.nextBillingOn
      : record.status === 'TRIAL' && record.autoRenew
        ? record.trialEndsOn
        : null,
    paidThroughOn: record.paidThroughOn,
    endedOn:
      record.status === 'CANCELLED' || record.status === 'EXPIRED' ? record.accessEndsOn : null,
    // No expiry reminder is stored (note 17).
    trial: record.trial ? { ...record.trial, followUp: null } : null,
    pastDue: due
      ? {
          failedOn: due.lastFailure?.on ?? (due.since ? dayOf(due.since) : null),
          attempts: due.failedPayments,
          maxAttempts: null,
          nextRetryOn: null,
          graceEndsOn: null,
          response: due.lastFailure?.reason ?? null,
        }
      : null,
    suspension: record.suspension
      ? {
          kind: record.suspension.kind,
          reason: record.suspension.reason,
          since: dayOf(record.suspension.since),
        }
      : null,
    // No card is kept for Firmivra's billing (note 10).
    card: null,
    accountOwner: record.accountOwner?.name ?? null,
    scheduled: [],
    supportView: record.supportAccessUntil
      ? { until: record.supportAccessUntil, reason: null }
      : null,
    amountDueCents: record.amountDueCents,
    usage: usageOut(record),
    invoices: record.invoices.map(invoiceOut),
    payments: record.payments.map(paymentOut),
    events: record.events.map(eventOut),
    notes: record.notes.map((note) => ({
      id: note.id,
      at: note.createdAt,
      author: note.author,
      text: note.body,
    })),
  };
}

/** The result line's billing documents ("INV-1003 for $88.50 is open in Billing."). */
function documentsText(result: SubscriptionResult): string {
  const { invoice, creditNote } = result;
  return [
    invoice ? ` ${invoice.number} for ${money(invoice.totalCents)} is open in Billing.` : '',
    creditNote
      ? ` Credit note ${creditNote.number} for ${money(creditNote.totalCents)} is on the firm’s account.`
      : '',
  ].join('');
}

// ---------- Previews ----------

/** The preview's refusal in words, with the plan's numbers (the mock's sentences). */
function blockedText(
  preview: SubscriptionChangePreview,
  record: SubscriptionRecord,
  plan: ApiPlan,
): string | null {
  const range = subscriptionSeatRange(plan);
  const used = record.seatsUsed ?? 0;
  switch (preview.blocked) {
    case null:
      return null;
    case 'SEATS_IN_USE':
      return range.max !== null && used > range.max
        ? `${plan.name} allows up to ${range.max} ${range.max === 1 ? 'user' : 'users'}; this firm has ${used}. Remove users first or choose a larger plan.`
        : `The firm already uses ${used} seats. Remove users before lowering the allowance.`;
    case 'SEATS_OUT_OF_RANGE':
      return preview.seats < range.min
        ? `${plan.name} includes ${range.min} seats in its base price.`
        : `${plan.name} allows up to ${range.max ?? preview.seats} seats.`;
    case 'LOCATIONS_NOT_OFFERED':
      return `${plan.name} doesn’t offer extra locations.`;
  }
}

/** The extra locations the Add-ons dialog's choice means: on keeps the count (at least one). */
const locationsFor = (record: SubscriptionRecord, addons: readonly Mock.AddonId[]) =>
  addons.includes('EXTRA_LOCATION') ? Math.max(1, record.extraLocations) : 0;

/**
 * The financial impact of a plan, cycle, seat or add-on change, shown before confirming: the
 * contract's previewSubscriptionChange on the record, so it is what the API bills. Nothing moves
 * for a change at the next billing date (the API refuses those).
 */
export function previewChange(
  sub: SubscriptionDetail,
  change: {
    plan?: PlanId;
    cycle?: Mock.BillingCycle;
    seats?: number;
    addons?: readonly Mock.AddonId[];
  },
  effective: Mock.Effective,
  today: string,
): ChangePreview {
  if (MOCKED) {
    const preview = mockPreviewChange(
      sub as unknown as Mock.Priced,
      change as Parameters<typeof mockPreviewChange>[1],
      effective,
      today,
    );
    return { ...preview, priceCents: cycleCents(preview.netMonthlyCents, preview.cycle) };
  }
  const code = change.plan ?? sub.plan;
  const record = records.get(sub.id);
  const plan = apiPlanOf(code);
  if (!record || !plan)
    return {
      plan: code,
      cycle: change.cycle ?? sub.cycle,
      seats: sub.seats,
      addons: sub.addons,
      dropped: [],
      oldNetMonthlyCents: sub.netMonthlyCents,
      monthlyCents: sub.monthlyCents,
      netMonthlyCents: sub.netMonthlyCents,
      amountCents: 0,
      nextBillingOn: sub.nextBillingOn,
      priceCents: 0,
      blocked: 'Refresh to see the latest plans and prices.',
    };
  const preview = previewSubscriptionChange(
    record,
    plan,
    {
      billingCycle: change.cycle,
      seats: change.seats,
      extraLocations: change.addons ? locationsFor(record, change.addons) : undefined,
    },
    today,
  );
  const list = subscriptionPriceCents(plan, {
    billingCycle: preview.billingCycle,
    extraSeats: preview.extraSeats,
    extraLocations: preview.extraLocations,
  });
  const scheduled = effective === 'NEXT_BILLING' && record.status !== 'TRIAL';
  return {
    plan: code,
    cycle: preview.billingCycle,
    seats: preview.seats,
    addons: preview.extraLocations > 0 ? ['EXTRA_LOCATION'] : [],
    dropped: preview.droppedLocations > 0 ? ['EXTRA_LOCATION'] : [],
    oldNetMonthlyCents: record.monthlyCents,
    monthlyCents: subscriptionMonthlyCents(list, preview.billingCycle),
    netMonthlyCents: preview.monthlyCents,
    amountCents: scheduled ? 0 : preview.amountCents,
    nextBillingOn: scheduled ? record.nextBillingOn : preview.nextBillingOn,
    priceCents: preview.priceCents,
    blocked: blockedText(preview, record, plan),
  };
}

/** A billing-date move: the days added (invoiced) or removed (credited), as the API bills them. */
export function previewBillingDate(sub: SubscriptionDetail, date: string, today: string): number {
  if (MOCKED) return mockPreviewBillingDate(sub as unknown as Mock.Priced, date, today);
  const record = records.get(sub.id);
  return record ? subscriptionBillingDateCents(record, date) : 0;
}

/** A discount running on `day`; a negotiated price has no dates, so it always runs. */
export function discountRuns(discount: Discount | null, day: string): discount is Discount {
  if (MOCKED) return mockDiscountRuns(discount as Mock.Discount | null, day);
  return discount !== null;
}

/** The price a month on `day`, after any discount running then. */
export function netMonthlyOn(sub: SubscriptionListItem, day: string): number {
  if (!MOCKED) return sub.netMonthlyCents;
  const list = mockMonthlyListCents(sub.plan as Mock.PlanId, sub.seats, sub.addons);
  return mockNetMonthlyCents(list, sub.discount as Mock.Discount | null, day);
}

/**
 * The price a month with `percent` off. The mock takes it off the whole list price; the API sets a
 * negotiated base price that much under the plan's (extras still add at the plan's rates).
 */
export function percentOffMonthlyCents(sub: SubscriptionDetail, percent: number): number {
  if (MOCKED) return Math.round((sub.monthlyCents * (100 - percent)) / 100);
  const record = records.get(sub.id);
  const plan = apiPlanOf(sub.plan);
  if (!record || !plan) return sub.netMonthlyCents;
  const price = subscriptionPriceCents(plan, {
    billingCycle: record.billingCycle,
    extraSeats: record.extraSeats,
    extraLocations: record.extraLocations,
    baseCents: negotiatedBase(plan, percent),
  });
  return subscriptionMonthlyCents(price, record.billingCycle);
}
const negotiatedBase = (plan: ApiPlan, percent: number) =>
  Math.round((plan.priceCents * (100 - percent)) / 100);

/** A new subscription's first price per billing cycle (Add Subscription). */
export function startPriceCents(id: PlanId, seats: number, cycle: Mock.BillingCycle): number {
  if (MOCKED) return cycleCents(mockMonthlyListCents(id as Mock.PlanId, seats, []), cycle);
  const plan = apiPlanOf(id);
  if (!plan) return 0;
  return subscriptionPriceCents(plan, {
    billingCycle: cycle,
    extraSeats: Math.max(0, seats - plan.includedSeats),
  });
}

/** One row of the Manage Add-ons dialog: null price when none is stored. */
export interface AddonOption {
  id: Mock.AddonId;
  name: string;
  description: string;
  monthlyCents: number | null;
  offered: boolean;
}

/**
 * The Manage Add-ons rows. On the API only the Additional Location add-on is stored, priced by the
 * plan's location price; AI Tools, SMS Package and Extra Storage are not available yet (note 5).
 */
export function addonOptions(sub: SubscriptionDetail): AddonOption[] {
  const name = planName(sub.plan);
  if (MOCKED)
    return ADDON_ORDER.map((id) => {
      const addon = ADDONS[id];
      const offered = addon.plans.includes(sub.plan as Mock.PlanId);
      return {
        id,
        name: addon.name,
        description: offered ? addon.description : `Not offered on ${name}`,
        monthlyCents: addon.monthlyCents,
        offered,
      };
    });
  const plan = apiPlanOf(sub.plan);
  const extra = records.get(sub.id)?.extraLocations ?? 0;
  return ADDON_ORDER.map((id) => {
    if (id !== 'EXTRA_LOCATION')
      return {
        id,
        name: ADDONS[id].name,
        description: 'Not available yet',
        monthlyCents: null,
        offered: false,
      };
    const price = plan?.locationPriceCents ?? null;
    return {
      id,
      name: ADDONS[id].name,
      description:
        price === null || !plan
          ? `Not offered on ${name}`
          : extra > 1
            ? `${extra} extra locations now, from location ${plan.includedLocations + 1}`
            : `One more office location, from location ${plan.includedLocations + 1}`,
      monthlyCents:
        price === null || !plan ? null : subscriptionMonthlyCents(price, plan.billingCycle),
      offered: price !== null,
    };
  });
}

// ---------- Queries ----------

const PAGE = 100;

type ListFilters = Pick<
  SubscriptionsQuery,
  'search' | 'planId' | 'status' | 'billingCycle' | 'from' | 'to'
>;

/** Both days or neither (the API's current month). */
const periodOf = (query: { from?: string; to?: string }) =>
  query.from && query.to ? { from: query.from, to: query.to } : {};

/** The screen's filters in the contract's terms; null when a plan filter names no plan. */
function listQuery(query: SubscriptionQuery): ListFilters | null {
  const plan = query.plan ? apiPlanOf(query.plan) : undefined;
  if (query.plan && !plan) return null;
  // The mock's Closed and "Canceled or Closed" are the API's Canceled (note 4).
  const status: SubscriptionStatusFilter | undefined = !query.status
    ? undefined
    : query.status === 'ENDED' || query.status === 'CLOSED'
      ? 'CANCELLED'
      : query.status;
  return {
    search: query.search?.trim() || undefined,
    planId: plan?.id,
    status,
    billingCycle: query.cycle || undefined,
    ...periodOf(query),
  };
}

/** A CSV download (`GET /export`), read here so the screen saves it as before. */
async function downloadText(path: string): Promise<string> {
  const response = await sessionFetch(`/api/v1${path}`, { headers: { accept: 'text/csv' } });
  if (!response.ok) {
    const body = ApiError.safeParse(await response.json().catch(() => undefined));
    const code = body.success ? body.data.error.code : `HTTP_${response.status}`;
    throw new ApiRequestError(response.status, code, body.success ? body.data.error.message : '');
  }
  return response.text();
}

/** The CSV's records after its header (a quoted cell may hold a line break). */
function csvRecords(csv: string): number {
  let rows = 0;
  let quoted = false;
  let content = false;
  for (const char of csv) {
    if (char === '"') quoted = !quoted;
    if (char === '\n' && !quoted) {
      if (content) rows += 1;
      content = false;
    } else if (char !== '\r') content = true;
  }
  if (content) rows += 1;
  return Math.max(0, rows - 1);
}

// ---------- The client the screen calls ----------

const real = {
  /** The plans (display order) and today: the plan filter's options. */
  meta: async (): Promise<{ today: string; plans: Plan[] }> => {
    const read = await loadMeta(true);
    return { today: read.today, plans: read.plans.map(planOut) };
  },

  /** The seven cards; churn in basis points becomes a percent with one decimal, as the mock's. */
  stats: async (query: { from?: string; to?: string } = {}): Promise<Mock.SubscriptionStats> => {
    const summary = await api.adminSubscriptions.summary(periodOf(query));
    const percent = (bp: number) => Math.round(bp / 10) / 10;
    return {
      period: { from: summary.from, to: summary.to },
      active: summary.active,
      trial: summary.trial,
      mrrCents: summary.mrrCents,
      arrCents: summary.arrCents,
      pastDue: summary.pastDue,
      renewals: summary.renewals,
      churn: {
        rate: percent(summary.churn.rateBp),
        previousRate:
          summary.churn.previousRateBp === null ? null : percent(summary.churn.previousRateBp),
        churned: summary.churn.churned,
        base: summary.churn.base,
      },
    };
  },

  /** Filtered by the API; every page is read (100 a page), and the table sorts and pages. */
  subscriptions: async (query: SubscriptionQuery = {}): Promise<SubscriptionPage> => {
    await loadMeta();
    const filters = listQuery(query);
    if (!filters) {
      const none = await api.adminSubscriptions.subscriptions({ pageSize: 1 });
      return { items: [], total: 0, all: none.all };
    }
    const first = await api.adminSubscriptions.subscriptions({
      ...filters,
      page: 1,
      pageSize: PAGE,
    });
    const pages = Math.ceil(first.total / Math.max(1, first.pageSize));
    const rest = await Promise.all(
      Array.from({ length: Math.max(0, pages - 1) }, (_, index) =>
        api.adminSubscriptions.subscriptions({
          ...filters,
          page: index + 2,
          pageSize: first.pageSize,
        }),
      ),
    );
    return {
      items: [first, ...rest].flatMap((page) => page.items).map((row) => rowOut(row)),
      total: first.total,
      all: first.all,
    };
  },

  subscription: async (id: string): Promise<SubscriptionDetail> => {
    if (!SubscriptionId.safeParse(id).success)
      throw new ApiRequestError(404, 'NOT_FOUND', SUBSCRIPTION_ERRORS.NOT_FOUND);
    const [record] = await Promise.all([api.adminSubscriptions.subscription(id), loadMeta()]);
    return detailOut(record);
  },

  /** Approved firms without one. Only an Active firm can be billed: that is the paid start's check. */
  firmsWithoutSubscription: async (): Promise<Mock.FirmWithoutSubscription[]> => {
    const [firms] = await Promise.all([api.adminSubscriptions.availableFirms(), loadMeta()]);
    return firms.map((firm) => ({
      id: firm.id,
      name: firm.name,
      email: firm.email ?? '',
      domain: '',
      hasCard: firm.canBill,
    }));
  },

  /** Add Subscription / Start Trial for Firm; the account owner is Sales' (note 24). */
  create: async (body: CreateSubscriptionBody): Promise<Mock.ActionResult> => {
    if (body.accountOwner.trim())
      throw notYet('The account owner is set in Sales. Leave it unassigned here.');
    const errors: Record<string, string> = {};
    if (!body.firmId) errors['firmId'] = 'Choose a firm.';
    const plan = (await loadMeta()).plans.find((item) => item.code === body.plan);
    if (!plan) errors['plan'] = 'Choose a plan.';
    else {
      const range = subscriptionSeatRange(plan);
      const outside =
        !Number.isInteger(body.seats) ||
        body.seats < range.min ||
        (range.max !== null && body.seats > range.max);
      if (outside)
        errors['seats'] =
          range.max === range.min
            ? `${plan.name} has ${seatText(range.min)}.`
            : range.max === null
              ? `${plan.name} starts at ${seatText(range.min)}.`
              : `${plan.name} allows ${range.min} to ${range.max} seats.`;
    }
    if (Object.keys(errors).length || !plan) throw new SubscriptionInputError(errors);
    const input = check(
      CreateSubscriptionRequest,
      {
        firmId: body.firmId,
        mode: body.mode,
        planId: plan.id,
        billingCycle: body.cycle,
        seats: body.seats,
        extraLocations: 0,
      },
      { firmId: 'firmId', mode: 'mode', planId: 'plan', billingCycle: 'cycle', seats: 'seats' },
    );
    const result = await fieldsOf(api.adminSubscriptions.create(input), {
      ALREADY_SUBSCRIBED: 'firmId',
      FIRM_NOT_AVAILABLE: 'firmId',
      FIRM_NOT_BILLABLE: 'mode',
      PLAN_INACTIVE: 'plan',
      SEATS_OUT_OF_RANGE: 'seats',
      SEATS_IN_USE: 'seats',
    });
    const sub = result.subscription;
    return {
      ok: true,
      message:
        body.mode === 'TRIAL'
          ? `${sub.firm.name} started a ${meta?.trialDays ?? SUBSCRIPTION_TRIAL_DAYS}-day ${sub.plan.name} trial.`
          : `${sub.firm.name} is on ${planText(sub)}.${documentsText(result)}`,
    };
  },

  changePlan: async (body: {
    id: string;
    plan: PlanId;
    cycle: Mock.BillingCycle;
    effective: Mock.Effective;
  }): Promise<Mock.ActionResult> => {
    applyNow(body.effective, LATER);
    const [plan, record] = await Promise.all([planFor(body.plan, 'plan'), recordFor(body.id)]);
    if (plan.code === record.plan.code && body.cycle === record.billingCycle)
      throw new SubscriptionInputError({ plan: 'Choose a different plan or billing cycle.' });
    const preview = previewSubscriptionChange(
      record,
      plan,
      { billingCycle: body.cycle },
      record.today,
    );
    const blocked = blockedText(preview, record, plan);
    if (blocked) throw new SubscriptionInputError({ plan: blocked });
    const result = await fieldsOf(
      api.adminSubscriptions.changePlan(body.id, { planId: plan.id, billingCycle: body.cycle }),
      { ...PLAN_CODES, NO_CHANGE: 'plan' },
    );
    return {
      ok: true,
      message: `Plan changed: ${planText(result.subscription)}.${documentsText(result)}`,
    };
  },

  updateSeats: async (body: {
    id: string;
    seats: number;
    effective: Mock.Effective;
  }): Promise<Mock.ActionResult> => {
    applyNow(body.effective, LATER);
    const record = await recordFor(body.id);
    if (body.seats === record.seatsAllowed)
      throw new SubscriptionInputError({ seats: 'Choose a different number of seats.' });
    const input = check(UpdateSubscriptionSeatsRequest, { seats: body.seats }, { seats: 'seats' });
    const plan = await planFor(record.plan.code, 'seats');
    const preview = previewSubscriptionChange(record, plan, { seats: input.seats }, record.today);
    const blocked = blockedText(preview, record, plan);
    if (blocked) throw new SubscriptionInputError({ seats: blocked });
    const result = await fieldsOf(api.adminSubscriptions.updateSeats(body.id, input), {
      SEATS_IN_USE: 'seats',
      SEATS_OUT_OF_RANGE: 'seats',
      NO_CHANGE: 'seats',
    });
    return {
      ok: true,
      message: `Seats changed: ${seatText(result.subscription.seatsAllowed)}.${documentsText(result)}`,
    };
  },

  /** Only the Additional Location add-on is stored (note 5): on keeps the count, off removes all. */
  updateAddons: async (body: {
    id: string;
    addons: Mock.AddonId[];
    effective: Mock.Effective;
  }): Promise<Mock.ActionResult> => {
    applyNow(body.effective, LATER);
    const others = body.addons.filter((id) => id !== 'EXTRA_LOCATION');
    if (others.length)
      throw notYet(
        `${others.map((id) => ADDONS[id].name).join(' and ')} ${others.length === 1 ? 'is' : 'are'} not available yet.`,
      );
    const record = await recordFor(body.id);
    const extraLocations = locationsFor(record, body.addons);
    if (extraLocations === record.extraLocations)
      throw new SubscriptionInputError({ addons: 'Change at least one add-on.' });
    const plan = await planFor(record.plan.code, 'addons');
    const preview = previewSubscriptionChange(record, plan, { extraLocations }, record.today);
    const blocked = blockedText(preview, record, plan);
    if (blocked) throw new SubscriptionInputError({ addons: blocked });
    const input = check(
      UpdateSubscriptionLocationsRequest,
      { extraLocations },
      { extraLocations: 'addons' },
    );
    const result = await fieldsOf(api.adminSubscriptions.updateLocations(body.id, input), {
      LOCATIONS_NOT_OFFERED: 'addons',
      NO_CHANGE: 'addons',
    });
    const count = result.subscription.extraLocations;
    return {
      ok: true,
      message: `Add-ons changed: ${count ? locationText(count) : 'No add-ons'}.${documentsText(result)}`,
    };
  },

  /** No notification is sent yet (note 17): telling the firm answers 422. */
  extendTrial: async (body: {
    id: string;
    days: number;
    reason: string;
    notifyFirm: boolean;
  }): Promise<Mock.ActionResult> => {
    if (body.notifyFirm)
      throw notYet('Telling the firm is not available yet. Clear that box to extend the trial.');
    const input = check(
      ExtendSubscriptionTrialRequest,
      { days: body.days, reason: body.reason },
      { days: 'days', reason: 'reason' },
    );
    const result = await api.adminSubscriptions.extendTrial(body.id, input);
    return {
      ok: true,
      message: `The trial now ends on ${dayText(result.subscription.trialEndsOn)}.`,
    };
  },

  /** No card is charged: the firm is Active today and its first invoice is open (note 11). */
  convertToPaid: async (body: {
    id: string;
    plan: PlanId;
    cycle: Mock.BillingCycle;
  }): Promise<Mock.ActionResult> => {
    const [plan, record] = await Promise.all([planFor(body.plan, 'plan'), recordFor(body.id)]);
    const preview = previewSubscriptionChange(
      record,
      plan,
      { billingCycle: body.cycle },
      record.today,
    );
    const blocked = blockedText(preview, record, plan);
    if (blocked) throw new SubscriptionInputError({ plan: blocked });
    const result = await fieldsOf(
      api.adminSubscriptions.convertToPaid(body.id, { planId: plan.id, billingCycle: body.cycle }),
      PLAN_CODES,
    );
    const sub = result.subscription;
    return {
      ok: true,
      message: `Converted to ${planText(sub)}.${sub.status === 'NON_RENEWING' ? ' Auto-Renew stays off, so it ends with this period.' : ''}${documentsText(result)}`,
    };
  },

  turnOffAutoRenew: async (body: {
    id: string;
    confirmed: boolean;
    source: Mock.RequestSource | '';
    notes: string;
  }): Promise<Mock.ActionResult> => {
    const fields = { confirmed: 'confirmed', source: 'source', notes: 'notes' };
    if (!body.source) {
      const errors: Record<string, string> = { source: 'Choose where the request came from.' };
      if (body.confirmed !== true) errors['confirmed'] = 'Confirm that the client asked for this.';
      throw new SubscriptionInputError(errors);
    }
    const input = check(
      TurnOffAutoRenewRequest,
      { confirmed: body.confirmed, source: body.source, notes: body.notes },
      fields,
    );
    const result = await api.adminSubscriptions.turnOffAutoRenew(body.id, input);
    return {
      ok: true,
      message: `Auto-Renew is off. Access continues until ${dayText(result.subscription.accessEndsOn)}.`,
    };
  },

  reverseCancellation: async (body: {
    id: string;
    autoRenewOn: boolean;
    reason: string;
  }): Promise<Mock.ActionResult> => {
    const input = check(
      ReverseCancellationRequest,
      { autoRenewOn: body.autoRenewOn, reason: body.reason },
      { autoRenewOn: 'autoRenewOn', reason: 'reason' },
    );
    const result = await api.adminSubscriptions.reverseCancellation(body.id, input);
    const next = result.subscription.nextBillingOn;
    return {
      ok: true,
      message: `The cancellation is reversed and Auto-Renew is on${next ? `; it renews on ${dayText(next)}` : ''}.`,
    };
  },

  suspend: async (body: {
    id: string;
    kind: Mock.SuspensionKind;
    reason: string;
    timing: Mock.Effective;
  }): Promise<Mock.ActionResult> => {
    applyNow(body.timing, 'Scheduled suspensions are not available yet. Choose Immediately.');
    const input = check(
      SuspendSubscriptionRequest,
      { kind: body.kind, reason: body.reason },
      { kind: 'kind', reason: 'reason' },
    );
    const result = await fieldsOf(api.adminSubscriptions.suspend(body.id, input), {
      NONPAYMENT_NOT_PAST_DUE: 'kind',
    });
    return {
      ok: true,
      message: `${result.subscription.firm.name} is suspended. Data is preserved; access is restricted.`,
    };
  },

  /**
   * Suspended: back once nothing is due (record a payment in Billing first, note 14). Canceled or
   * Expired: a restart today on the plan, with its first invoice.
   */
  reactivate: async (body: {
    id: string;
    reason: string;
    paymentSettled: boolean;
    plan?: PlanId;
    cycle?: Mock.BillingCycle;
  }): Promise<Mock.ActionResult> => {
    const record = await recordFor(body.id);
    const restart = body.plan !== undefined && body.cycle !== undefined;
    let planId: string | undefined;
    if (body.plan !== undefined && body.cycle !== undefined) {
      const plan = await planFor(body.plan, 'plan');
      const preview = previewSubscriptionChange(
        record,
        plan,
        { billingCycle: body.cycle },
        record.today,
      );
      const blocked = blockedText(preview, record, plan);
      if (blocked) throw new SubscriptionInputError({ plan: blocked });
      planId = plan.id;
    }
    const input = check(
      ReactivateSubscriptionRequest,
      {
        reason: body.reason,
        paymentConfirmed: body.paymentSettled,
        ...(planId ? { planId, billingCycle: body.cycle } : {}),
      },
      {
        reason: 'reason',
        paymentConfirmed: 'paymentSettled',
        planId: 'plan',
        billingCycle: 'cycle',
      },
    );
    const result = await fieldsOf(api.adminSubscriptions.reactivate(body.id, input), {
      ...PLAN_CODES,
      PAYMENT_CONFIRMATION_REQUIRED: 'paymentSettled',
      PLAN_REQUIRED: 'plan',
    });
    const sub = result.subscription;
    return {
      ok: true,
      message: restart
        ? `${sub.firm.name} restarted on ${planText(sub)}.${documentsText(result)}`
        : `${sub.firm.name} is ${STATUS_LABELS[sub.status]} again.${documentsText(result)}`,
    };
  },

  /** Retries need a card processor (note 10): a payment is recorded in Billing. */
  retryPayment: async (_body: { id: string }): Promise<Mock.ActionResult> => {
    throw notYet('Payment retries are not available yet. Record the payment in Billing.');
  },

  addNote: async (body: { id: string; text: string }): Promise<Mock.ActionResult> => {
    const input = check(AddSubscriptionNoteRequest, { body: body.text }, { body: 'text' });
    await api.adminSubscriptions.addNote(body.id, input);
    return { ok: true, message: 'Note added.' };
  },

  /**
   * A percentage is a negotiated base price that much under the plan's, with no end date; account
   * credit is Billing's credit note; promotion codes are not stored (notes 6 and 7).
   */
  applyDiscount: async (body: Mock.DiscountBody): Promise<Mock.ActionResult> => {
    if (body.kind === 'PROMO') throw notYet('Promotion codes are not available yet.');
    const record = await recordFor(body.id);
    if (body.startsOn < record.today)
      throw new SubscriptionInputError({ startsOn: 'Choose today or a later date.' });
    if (body.kind === 'CREDIT') {
      const amount = body.amountCents ?? 0;
      const errors: Record<string, string> = {};
      if (!Number.isInteger(amount) || amount < 100 || amount > 1_000_000)
        errors['amount'] = 'Enter an amount between $1 and $10,000.';
      if (!body.reason.trim()) errors['reason'] = 'Add a reason.';
      if (!body.approvedBy.trim()) errors['approvedBy'] = 'Enter who approved it.';
      if (Object.keys(errors).length) throw new SubscriptionInputError(errors);
      const input = check(
        SaveBillingCreditNoteRequest,
        {
          firmId: record.firm.id,
          date: body.startsOn,
          reason: 'OTHER',
          method: 'ADJUSTMENT',
          adjustmentCents: amount,
          internalNote: `${body.reason.trim()}\n\nApproved by: ${body.approvedBy.trim()}`,
          issue: true,
        },
        { date: 'startsOn', adjustmentCents: 'amount', internalNote: 'reason' },
      );
      const note = await billing(api.adminBilling.createCreditNote(input));
      return {
        ok: true,
        message: `Credit note ${note.number} for ${money(amount)} is on ${record.firm.name}’s account.`,
      };
    }
    if (body.months !== null && body.months !== undefined)
      throw notYet('Discounts with an end date are not available yet. Choose No end date.');
    if (body.startsOn !== record.today)
      throw notYet('Discounts that start later are not available yet. Choose today.');
    const percent = body.percent ?? 0;
    if (!Number.isInteger(percent) || percent < 1 || percent > 100)
      throw new SubscriptionInputError({ percent: 'Enter a whole percentage from 1 to 100.' });
    const plan = await planFor(record.plan.code, 'percent');
    const input = check(
      SetSubscriptionPriceRequest,
      {
        baseCents: negotiatedBase(plan, percent),
        reason: body.reason,
        approvedBy: body.approvedBy,
      },
      { baseCents: 'percent', reason: 'reason', approvedBy: 'approvedBy' },
    );
    const result = await fieldsOf(api.adminSubscriptions.setPrice(body.id, input), {
      NO_CHANGE: 'percent',
    });
    return {
      ok: true,
      message: `${percent}% off the plan’s base price: ${money(result.subscription.monthlyCents)}/mo from the next invoice.`,
    };
  },

  /** Back to the plan's price. */
  removeDiscount: async (body: { id: string; reason: string }): Promise<Mock.ActionResult> => {
    const input = check(
      SetSubscriptionPriceRequest,
      { baseCents: null, reason: body.reason },
      { reason: 'reason' },
    );
    const result = await api.adminSubscriptions.setPrice(body.id, input);
    return {
      ok: true,
      message: `The negotiated price is removed: ${money(result.subscription.monthlyCents)}/mo from the next invoice.`,
    };
  },

  /** No card, processor or payment link is stored (note 10). */
  sendPaymentLink: async (body: {
    id: string;
    purpose: 'BALANCE' | 'CARD_UPDATE';
    amountCents: number;
    channel: 'EMAIL' | 'SMS';
  }): Promise<Mock.ActionResult> => {
    throw notYet(
      body.purpose === 'CARD_UPDATE'
        ? 'Card updates are not available yet: no card is kept on file.'
        : 'Payment links are not available yet. Record the payment in Billing.',
    );
  },

  /** Billing's sendInvoice, to the invoice's bill-to address (note 21). */
  resendInvoice: async (body: {
    id: string;
    invoiceId: string;
    email: string;
  }): Promise<Mock.ActionResult> => {
    const record = await recordFor(body.id);
    const invoice = record.invoices.find((item) => item.id === body.invoiceId);
    if (!invoice) throw new SubscriptionInputError({ invoiceId: 'Choose an invoice.' });
    const billTo = record.firm.email ?? '';
    if (body.email.trim().toLowerCase() !== billTo.toLowerCase())
      throw notYet(
        `Sending to another address is not available yet. Invoices go to ${billTo || 'the firm’s billing contact'}.`,
      );
    const sent = await billing(api.adminBilling.sendInvoice(invoice.id, { email: true }));
    return {
      ok: true,
      message:
        sent.sendStatus === 'SENT'
          ? `${sent.number} was sent to ${sent.billToEmail}.`
          : `${sent.number} was not emailed: invoice emails are not set up yet.`,
    };
  },

  changeBillingDate: async (body: {
    id: string;
    date: string;
    reason: string;
  }): Promise<Mock.ActionResult> => {
    if (!body.date) throw new SubscriptionInputError({ date: 'Choose a date after today.' });
    const input = check(
      ChangeBillingDateRequest,
      { date: body.date, reason: body.reason },
      { date: 'date', reason: 'reason' },
    );
    const result = await fieldsOf(api.adminSubscriptions.changeBillingDate(body.id, input), {
      BILLING_DATE_OUT_OF_RANGE: 'date',
      NO_CHANGE: 'date',
    });
    return {
      ok: true,
      message: `The next billing date is ${dayText(input.date)}.${documentsText(result)}`,
    };
  },

  /** R8's support access request: one of the firm's Owners approves it and sets how long. */
  startSupportView: async (body: {
    id: string;
    reason: string;
    minutes: number;
  }): Promise<Mock.ActionResult> => {
    const record = await recordFor(body.id);
    const input = check(CreateSupportAccessRequest, { reason: body.reason }, { reason: 'reason' });
    await api.adminSupportAccess.request(record.firm.id, input);
    return {
      ok: true,
      message: `Support access to ${record.firm.name} is requested. One of its Owners approves it and sets how long it lasts; every step is logged.`,
    };
  },

  /** R8 has no admin-side end (note 23). */
  endSupportView: async (_body: { id: string }): Promise<Mock.ActionResult> => {
    throw notYet(
      'Ending support access from here is not available yet. The firm’s Owner can revoke it.',
    );
  },

  /** Close Account, today only (note 16). */
  closeAccount: async (body: {
    id: string;
    reason: string;
    effectiveOn: string;
    confirmName: string;
    impactReviewed: boolean;
  }): Promise<Mock.ActionResult> => {
    const record = await recordFor(body.id);
    if (!body.effectiveOn || body.effectiveOn < record.today)
      throw new SubscriptionInputError({ effectiveOn: 'Choose today or a later date.' });
    if (body.effectiveOn > record.today)
      throw notYet('Closing on a later date is not available yet. Choose today.');
    const input = check(
      CloseSubscriptionRequest,
      { reason: body.reason, confirmName: body.confirmName, impactReviewed: body.impactReviewed },
      { reason: 'reason', confirmName: 'confirmName', impactReviewed: 'impactReviewed' },
    );
    const result = await fieldsOf(api.adminSubscriptions.close(body.id, input), {
      CONFIRM_NAME_MISMATCH: 'confirmName',
    });
    return {
      ok: true,
      message: `${result.subscription.firm.name} is closed. Its data is kept under the retention policy.`,
    };
  },

  /**
   * The CSV download: `query`, the table's filters (at most 1,000 rows), or else the selected ids
   * (at most 100). The API writes an EXPORTED event on each.
   */
  exportCsv: async (body: {
    ids: string[];
    query?: SubscriptionQuery;
  }): Promise<{ csv: string; count: number }> => {
    let path: string;
    if (body.query) {
      await loadMeta();
      const filters = listQuery(body.query);
      if (!filters) throw new SubscriptionInputError({ form: 'There is nothing to export.' });
      path = adminSubscriptionsExportPath(filters);
    } else {
      if (!body.ids.length)
        throw new SubscriptionInputError({ form: 'There is nothing to export.' });
      if (body.ids.length > PAGE)
        throw notYet(
          `Export at most ${PAGE} selected subscriptions at a time, or export the filtered list.`,
        );
      path = adminSubscriptionsExportPath({ ids: body.ids });
    }
    const csv = await downloadText(path);
    return { csv, count: csvRecords(csv) };
  },
};

/** Mock mode: the mock as it is, plus the plans call it never had (its six plans, all active). */
const mockMode: typeof real = {
  ...(mockSubscriptions as unknown as typeof real),
  meta: async () => ({ today: utcToday(), plans: mockPlans() }),
};

/** What the Subscriptions screen calls: the API, or the mock in mock mode. */
export const adminSubscriptions: typeof real = MOCKED ? mockMode : real;
