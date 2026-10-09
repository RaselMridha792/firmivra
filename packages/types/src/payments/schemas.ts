import { z } from 'zod';
import { CalendarDate, MemberRef } from '../clients/schemas.js';
import { SearchText, text } from '../clients/text.js';
import { InvoiceStatus, PaymentRefundStatus, PaymentStatus } from '../db-enums.js';

// Invoices and payments (R7): the firm bills a client with an invoice of lines (client record >
// Invoices, and the firm's Invoices page); the client pays it by card on Stripe's hosted checkout
// from the portal's Receipts & Invoices tab.
// Firm routes: /api/v1/business/invoices. Owner and Admin see and change every invoice of the
// firm and refund payments. Staff only read the invoices of clients assigned to them (any other
// is 404, as in R10's clients) and get 403 FORBIDDEN on every change.
// Portal routes: /api/v1/portal/{firmSlug}/me/invoices: the signed-in client's own invoices, for
// every login of that client (primary or household). Drafts never reach the portal.
// Money is whole cents with a currency ("usd"). The database computes every amount: a line is
// quantity x unit amount rounded to cents, the subtotal is the sum of the lines, the total is the
// subtotal minus the discount. Requests never carry those, and paying carries no amount at all:
// the checkout charges what the database says is due.
// Lifecycle (the database's): DRAFT -> SCHEDULED (opens on its scheduled date) or OPEN -> PAID;
// DRAFT, SCHEDULED and OPEN can be CANCELED; PAID and CANCELED are final; nothing is deleted. An
// invoice is PAID only once the money received covers its total: Stripe payments a verified
// webhook confirmed, plus check or cash payments an Owner or Admin recorded (offline payments), so
// nothing the client's browser does (Pay Now included) marks it paid. Refunds go through Stripe
// too and count once its webhook confirms them; a refunded invoice stays PAID and is never owed
// again. Voiding an offline payment that leaves a PAID invoice uncovered reopens it (OPEN).
// Errors come in the order the API checks them: 415 UNSUPPORTED_MEDIA_TYPE and 403
// ORIGIN_NOT_ALLOWED (changes, before sign-in), 401, the tenant guard (400 BUSINESS_REQUIRED and
// 404 on the firm site, 404 for a portal with no place for the caller), 403 BUSINESS_INACTIVE or
// BUSINESS_SETUP_REQUIRED, 403 FORBIDDEN (Staff on a change), 400 VALIDATION_FAILED, 404
// NOT_FOUND, 409 (InvoiceErrorCode), 503 PAYMENT_PROVIDER_UNAVAILABLE.
// Responses are plain objects (a field the API adds later is dropped, so an open page keeps
// working); requests are strict (unknown fields such as businessId or totalCents are refused).

const DateTime = z.iso.datetime({ offset: true });
const Cents = z.number().int().min(0);

/** One invoice's limits. $999,999.99 is also Stripe's largest card payment. */
export const INVOICE_LIMITS = {
  maxLines: 50,
  /** Hours or units on one line, with at most 2 decimals. */
  maxQuantity: 10_000,
  /** Any amount, and an invoice's subtotal. */
  maxCents: 99_999_999,
} as const;

/** An open invoice shows "Due Soon" this many days before its due date, and once it is past due. */
export const DUE_SOON_DAYS = 7;

// ---------- What the client sees ----------
/**
 * The client-facing status, mapped from the invoice's status on the firm's calendar by
 * `myInvoiceStatus()`: SCHEDULED is UPCOMING; OPEN is DUE_SOON when due within DUE_SOON_DAYS or
 * past due (the spec has no "Overdue" label), otherwise PENDING; PAID and CANCELED as they are.
 */
export const MyInvoiceStatus = z.enum(['PENDING', 'DUE_SOON', 'PAID', 'UPCOMING', 'CANCELED']);
export type MyInvoiceStatus = z.infer<typeof MyInvoiceStatus>;

/** The labels of Octavia's Invoices tab spec, for the portal and the firm's "client sees" column. */
export const MY_INVOICE_STATUS_LABELS: Readonly<Record<MyInvoiceStatus, string>> = {
  PENDING: 'Pending',
  DUE_SOON: 'Due Soon',
  PAID: 'Paid',
  UPCOMING: 'Upcoming',
  CANCELED: 'Canceled',
};

/** The portal's invoice filter ("All Invoices" ... "Canceled Invoices"): views of one list. */
export const MyInvoiceView = z.enum(['ALL', 'DUE', 'PAID', 'UPCOMING', 'CANCELED']);
export type MyInvoiceView = z.infer<typeof MyInvoiceView>;
/** The client statuses each view shows. DUE: open ones, still to pay. */
export const MY_INVOICE_VIEWS: Readonly<Record<MyInvoiceView, readonly MyInvoiceStatus[]>> = {
  ALL: MyInvoiceStatus.options,
  DUE: ['PENDING', 'DUE_SOON'],
  PAID: ['PAID'],
  UPCOMING: ['UPCOMING'],
  CANCELED: ['CANCELED'],
};

/** The tab's two tables: CURRENT (open and upcoming) and PAST ("Past Invoices": paid, canceled). */
export const MyInvoiceSection = z.enum(['CURRENT', 'PAST']);
export type MyInvoiceSection = z.infer<typeof MyInvoiceSection>;
export const MY_INVOICE_SECTIONS: Readonly<Record<MyInvoiceSection, readonly MyInvoiceStatus[]>> = {
  CURRENT: ['PENDING', 'DUE_SOON', 'UPCOMING'],
  PAST: ['PAID', 'CANCELED'],
};

/** A calendar date (YYYY-MM-DD) plus `days`. */
const addDays = (date: string, days: number) =>
  new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

/** The fields of an invoice the client status depends on (dates as YYYY-MM-DD or ISO). */
interface InvoiceState {
  status: InvoiceStatus;
  dueOn: string | null;
  issuedAt: string | null;
  /**
   * Kept on an invoice canceled while SCHEDULED (the client saw it as Upcoming); the API clears it
   * when it opens an invoice or cancels a DRAFT.
   */
  scheduledFor: string | null;
}

/**
 * What the client sees for an invoice on `today` (YYYY-MM-DD in the firm's time zone), or null
 * when the portal never shows it: a draft, or a draft canceled before it was sent (it was never
 * shown). A canceled invoice the client saw (issued, or Upcoming when canceled) stays in its
 * history as Canceled. The API and the mocks both use this, so they never disagree.
 */
export function myInvoiceStatus(invoice: InvoiceState, today: string): MyInvoiceStatus | null {
  const { status, dueOn, issuedAt, scheduledFor } = invoice;
  if (status === 'DRAFT') return null;
  if (status === 'SCHEDULED') return 'UPCOMING';
  if (status === 'PAID') return 'PAID';
  if (status === 'CANCELED') return issuedAt === null && scheduledFor === null ? null : 'CANCELED';
  return dueOn !== null && dueOn <= addDays(today, DUE_SOON_DAYS) ? 'DUE_SOON' : 'PENDING';
}

/** Open and past its due date on `today` (the firm's calendar). */
export const isInvoiceOverdue = (invoice: InvoiceState, today: string): boolean =>
  invoice.status === 'OPEN' && invoice.dueOn !== null && invoice.dueOn < today;

// ---------- Amounts (computed by the database; these only preview them) ----------
/** One line's amount: quantity x unit amount, rounded to cents half up, as the database does. */
export function lineAmountCents(quantity: number, unitAmountCents: number): number {
  // Whole hundredths first (quantities have at most 2 decimals), so floats never round wrongly.
  const hundredths = Math.round(quantity * 100);
  return Math.floor((hundredths * unitAmountCents + 50) / 100);
}

/**
 * The amounts the database will keep for these lines and discount: the form's running total.
 * `totalCents` goes below 0 when the discount is too large (the request is then refused).
 */
export function invoiceTotals(draft: {
  lines: readonly { quantity?: number; unitAmountCents: number }[];
  discountCents?: number;
}): { lineAmountsCents: number[]; subtotalCents: number; totalCents: number } {
  const lineAmountsCents = draft.lines.map((l) =>
    lineAmountCents(l.quantity ?? 1, l.unitAmountCents),
  );
  const subtotalCents = lineAmountsCents.reduce((sum, cents) => sum + cents, 0);
  return {
    lineAmountsCents,
    subtotalCents,
    totalCents: subtotalCents - (draft.discountCents ?? 0),
  };
}

// ---------- Shared shapes ----------
export const InvoiceId = z.uuid();

/** The client's service (engagement) an invoice bills: the engagement's id and title. */
const ServiceLink = z.object({ id: z.uuid(), title: z.string() });

/** One line, with the amount the database computed. */
export const InvoiceLine = z.object({
  id: z.uuid(),
  description: z.string(),
  /** Up to 2 decimals. */
  quantity: z.number(),
  unitAmountCents: Cents,
  amountCents: Cents,
});
export type InvoiceLine = z.infer<typeof InvoiceLine>;

/**
 * One payment the client submitted on Stripe's checkout. Checkouts the client opened and left are
 * not listed. No card or bank details exist here (Stripe keeps them).
 */
export const InvoicePayment = z.object({
  id: z.uuid(),
  amountCents: Cents,
  currency: z.string(),
  /**
   * PENDING: submitted, waiting for Stripe's confirmation (a bank debit can take days);
   * SUCCEEDED; FAILED (the invoice stays open); REFUNDED: refunds cover all of it.
   */
  status: PaymentStatus,
  /** Confirmed refunds of this payment ("Refunded $x"). The invoice stays PAID. */
  refundedCents: Cents,
  paidAt: DateTime.nullable(),
  createdAt: DateTime,
});
export type InvoicePayment = z.infer<typeof InvoicePayment>;

/** One refund of a payment, as the firm sees it. */
export const InvoiceRefund = z.object({
  id: z.uuid(),
  amountCents: Cents,
  currency: z.string(),
  /**
   * PENDING: asked of Stripe, waiting for its confirmation; SUCCEEDED (counted in
   * `refundedCents`); FAILED (Stripe could not return the money; it never counts).
   */
  status: PaymentRefundStatus,
  refundedAt: DateTime.nullable(),
  createdAt: DateTime,
});
export type InvoiceRefund = z.infer<typeof InvoiceRefund>;

/**
 * A payment on the firm's invoice detail: the client's view plus Stripe's failure code and the
 * refunds (refunds the firm made in its own Stripe dashboard show here too, once confirmed).
 */
export const FirmInvoicePayment = InvoicePayment.extend({
  /** FAILED ones: Stripe's short code (e.g. "card_declined"); otherwise null. */
  failureCode: z.string().nullable(),
  /** Newest first. */
  refunds: z.array(InvoiceRefund),
  /**
   * What a new refund may still take: the amount less every refund that is not FAILED (pending
   * ones included), while SUCCEEDED; 0 for any other status.
   */
  refundableCents: Cents,
});
export type FirmInvoicePayment = z.infer<typeof FirmInvoicePayment>;

/**
 * How an offline payment arrived: CHECK or CASH. Card and bank payments go through Stripe
 * (`payments`). The same values as the database's OfflinePaymentMethod (R0).
 */
const OfflineMethod = z.enum(['CHECK', 'CASH']);

/**
 * A check or cash payment the firm recorded on the invoice (Owner or Admin). It never changes; a
 * mistake is voided with a reason and then no longer counts (record it again if needed).
 */
export const OfflinePayment = z.object({
  id: z.uuid(),
  method: OfflineMethod,
  amountCents: Cents,
  currency: z.string(),
  /** The check number, or a cash receipt number; null for cash without one. */
  reference: z.string().nullable(),
  /** The day the firm received the money (its calendar). */
  receivedOn: CalendarDate,
  /** The firm's note; never shown to the client. */
  note: z.string().nullable(),
  recordedBy: MemberRef,
  recordedAt: DateTime,
  /** Voided: it no longer counts. All three are set together, once. */
  voidedAt: DateTime.nullable(),
  voidedBy: MemberRef.nullable(),
  voidReason: z.string().nullable(),
});
export type OfflinePayment = z.infer<typeof OfflinePayment>;

/** An offline payment on the client's "View": live ones only, method, amount and day. */
export const MyOfflinePayment = OfflinePayment.pick({
  id: true,
  method: true,
  amountCents: true,
  currency: true,
  receivedOn: true,
});
export type MyOfflinePayment = z.infer<typeof MyOfflinePayment>;

/** Amounts on an invoice's detail, both sides. */
const AmountDetail = {
  lines: z.array(InvoiceLine).max(INVOICE_LIMITS.maxLines),
  subtotalCents: Cents,
  discountCents: Cents,
  /**
   * Money received: Stripe payments that succeeded (refunded ones in full) plus live offline
   * payments. The balance due is the total less this.
   */
  amountPaidCents: Cents,
  /** Confirmed refunds of those payments. */
  refundedCents: Cents,
};

// ---------- Firm side ----------
/** One row of the firm's invoice lists. */
export const InvoiceListItem = z.object({
  id: z.uuid(),
  /** Given by the API, unique in the firm, never changes (e.g. INV-2026-0042). */
  number: z.string(),
  client: z.object({ id: z.uuid(), displayName: z.string() }),
  service: ServiceLink.nullable(),
  /** What it is for: the service's title, or else the first line's description. */
  title: z.string(),
  status: InvoiceStatus,
  /**
   * What the client sees; null while the portal does not show it (a draft, or a draft canceled
   * before it was sent).
   */
  clientStatus: MyInvoiceStatus.nullable(),
  currency: z.string(),
  totalCents: Cents,
  /**
   * Still to pay: the total less the money received (`amountPaidCents`: a refund never makes money
   * owed again; never below 0) while DRAFT, SCHEDULED or OPEN; 0 once PAID or CANCELED.
   */
  balanceDueCents: Cents,
  /**
   * SCHEDULED: the day it opens (it shows as Upcoming until then). Kept when a SCHEDULED invoice
   * is canceled (the client then sees it as Canceled); null once it opens or a draft is canceled.
   */
  scheduledFor: CalendarDate.nullable(),
  dueOn: CalendarDate.nullable(),
  /** Open and past its due date (the firm's calendar). */
  overdue: z.boolean(),
  /** When it opened (sent, or its scheduled day came). */
  issuedAt: DateTime.nullable(),
  paidAt: DateTime.nullable(),
  canceledAt: DateTime.nullable(),
  createdAt: DateTime,
  updatedAt: DateTime,
});
export type InvoiceListItem = z.infer<typeof InvoiceListItem>;

/** GET /business/invoices/{id} and the answer of every change: lines, totals and payments. */
export const Invoice = InvoiceListItem.extend({
  ...AmountDetail,
  /** Newest first. */
  payments: z.array(FirmInvoicePayment),
  /** Check and cash payments, voided ones included; newest first. */
  offlinePayments: z.array(OfflinePayment),
  /** The firm's reason; never shown to the client. */
  cancelReason: z.string().nullable(),
  createdBy: MemberRef.nullable(),
});
export type Invoice = z.infer<typeof Invoice>;

/**
 * GET /business/invoices: newest first, one page at a time. `clientId` is the client record's
 * Invoices tab (a client Staff may not see is 404); search matches the invoice number or the
 * client's name.
 */
export const ListInvoicesQuery = z.strictObject({
  clientId: z.uuid().optional(),
  status: InvoiceStatus.optional(),
  search: SearchText.optional(),
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional().default(25),
});
export type ListInvoicesQuery = z.input<typeof ListInvoicesQuery>;

export const InvoiceList = z.object({
  items: z.array(InvoiceListItem).max(100),
  /** Null on the last page. */
  nextCursor: z.string().nullable(),
  /**
   * The firm's Stripe account takes charges now. False: clients cannot pay online yet (the
   * portal hides Pay Now); say so on the Invoices page. Invoices can still be created and sent.
   */
  paymentsEnabled: z.boolean(),
});
export type InvoiceList = z.infer<typeof InvoiceList>;

const Amount = z
  .number()
  .int('Use whole cents')
  .min(0, 'An amount cannot be negative')
  .max(INVOICE_LIMITS.maxCents, 'Use at most $999,999.99');

/** One line of a draft; the database computes its amount. */
const LineInput = z.strictObject({
  description: text(200, 'one', 'Describe the line'),
  /** More than 0, at most 2 decimals; 1 when left out. */
  quantity: z
    .number()
    .positive('The quantity must be more than 0')
    .max(INVOICE_LIMITS.maxQuantity, `Use a quantity of at most ${INVOICE_LIMITS.maxQuantity}`)
    .multipleOf(0.01, 'Use at most 2 decimals in the quantity')
    .optional()
    .default(1),
  unitAmountCents: Amount,
});

/** A draft's fields: what create takes (with the client) and what update replaces. */
const DraftFields = {
  /** One of this client's services (an engagement id from api.engagements); null or left out: none. */
  engagementId: z.uuid().nullable().optional(),
  lines: z
    .array(LineInput)
    .min(1, 'Add at least one line')
    .max(INVOICE_LIMITS.maxLines, `Use at most ${INVOICE_LIMITS.maxLines} lines`),
  discountCents: Amount.optional().default(0),
  dueOn: z.iso.date('Choose a due date'),
  /** A later day makes `send` schedule it (Upcoming) to open that day; left out, it opens when sent. */
  scheduledFor: CalendarDate.nullable().optional(),
};

type DraftBody = {
  lines: readonly unknown[];
  discountCents?: unknown;
  dueOn?: unknown;
  scheduledFor?: string | null;
};
const isLine = (l: unknown): l is { quantity: number; unitAmountCents: number } =>
  typeof l === 'object' &&
  l !== null &&
  typeof (l as { quantity?: unknown }).quantity === 'number' &&
  typeof (l as { unitAmountCents?: unknown }).unitAmountCents === 'number';

/** Rules across fields: the subtotal's limit, a discount within it, due on or after the schedule. */
const draftRules = (body: DraftBody, ctx: z.RefinementCtx) => {
  const lines = body.lines.filter(isLine);
  // A line of the wrong shape has its own issue already.
  if (lines.length !== body.lines.length) return;
  const { subtotalCents } = invoiceTotals({ lines });
  if (subtotalCents > INVOICE_LIMITS.maxCents) {
    ctx.addIssue({
      code: 'custom',
      path: ['lines'],
      message: 'An invoice can be at most $999,999.99',
    });
  }
  if (typeof body.discountCents === 'number' && body.discountCents > subtotalCents) {
    ctx.addIssue({
      code: 'custom',
      path: ['discountCents'],
      message: 'The discount cannot be more than the subtotal',
    });
  }
  if (typeof body.dueOn === 'string' && body.scheduledFor && body.dueOn < body.scheduledFor) {
    ctx.addIssue({
      code: 'custom',
      path: ['dueOn'],
      message: 'The due date must be on or after the scheduled date',
    });
  }
};

/**
 * POST /business/invoices (Owner and Admin): a DRAFT for one of the firm's clients, numbered by the
 * API. 404 for a client or service that isn't the firm's (or the service isn't this client's); 409
 * CLIENT_ARCHIVED.
 */
export const CreateInvoiceRequest = z
  .strictObject({ clientId: z.uuid(), ...DraftFields })
  .superRefine(draftRules);
export type CreateInvoiceRequest = z.input<typeof CreateInvoiceRequest>;

/**
 * PUT /business/invoices/{id} (Owner and Admin): the whole draft again, lines included; what is
 * sent replaces it. Only a DRAFT (409 NOT_DRAFT) of a client not archived (409 CLIENT_ARCHIVED);
 * the client never changes.
 */
export const UpdateInvoiceRequest = z.strictObject(DraftFields).superRefine(draftRules);
export type UpdateInvoiceRequest = z.input<typeof UpdateInvoiceRequest>;

/** POST /business/invoices/{id}/cancel (Owner and Admin). The reason stays with the firm. */
export const CancelInvoiceRequest = z.strictObject({
  reason: text(500, 'many', 'Say why the invoice is canceled'),
});
export type CancelInvoiceRequest = z.input<typeof CancelInvoiceRequest>;

export const PaymentId = z.uuid();

/**
 * POST /business/invoices/{id}/payments/{paymentId}/refunds (Owner and Admin): returns part or
 * all of a SUCCEEDED payment to the client's card or account through Stripe. The refund is
 * PENDING until Stripe's webhook confirms it; the invoice stays PAID. 409 NOT_REFUNDABLE or
 * REFUND_TOO_LARGE; 503 PAYMENT_PROVIDER_UNAVAILABLE.
 */
export const RefundPaymentRequest = z.strictObject({
  /** At most the payment's `refundableCents`. */
  amountCents: Amount.min(1, 'Refund at least $0.01'),
  /**
   * A new random id each time the refund dialog opens (`crypto.randomUUID()`), sent again
   * unchanged on a retry: the API passes it to Stripe as the idempotency key, so a double click
   * or a retry after a timeout or a 503 refunds once. A retry of a refund already made answers the
   * invoice as it is (200, no second refund), even once that refund has used up the payment.
   */
  idempotencyKey: z.uuid(),
});
export type RefundPaymentRequest = z.input<typeof RefundPaymentRequest>;

export const OfflinePaymentId = z.uuid();

/**
 * POST /business/invoices/{id}/offline-payments (Owner and Admin): records a check or cash payment
 * on an OPEN invoice, at most its balance due; the invoice turns PAID when the money received
 * covers the total. The API first ends an open Pay Now checkout the client left (409
 * PAYMENT_IN_PROGRESS when the client already paid on it). 409 NOT_OPEN, AMOUNT_TOO_LARGE or
 * PAYMENT_IN_PROGRESS; 400 for a day after the firm's today.
 */
export const RecordOfflinePaymentRequest = z
  .strictObject({
    method: OfflineMethod,
    amountCents: Amount.min(1, 'Record at least $0.01'),
    /** The check number (required for a check) or a cash receipt number: letters, digits, hyphens. */
    reference: z
      .string()
      .trim()
      .regex(/^[A-Za-z0-9-]{1,20}$/, 'Use up to 20 letters, digits or hyphens')
      .optional(),
    /** The day the money arrived; not after the firm's today. */
    receivedOn: CalendarDate,
    /** For the firm only. */
    note: text(500, 'many', 'Add a note').optional(),
    /**
     * A new random id each time the dialog opens, sent again unchanged on a retry: a retry of a
     * payment already recorded answers the invoice as it is (200, nothing recorded twice).
     */
    idempotencyKey: z.uuid(),
  })
  .superRefine((body, ctx) => {
    if (body.method === 'CHECK' && !body.reference) {
      ctx.addIssue({ code: 'custom', path: ['reference'], message: 'Enter the check number' });
    }
  });
export type RecordOfflinePaymentRequest = z.input<typeof RecordOfflinePaymentRequest>;

/**
 * POST /business/invoices/{id}/offline-payments/{offlinePaymentId}/void (Owner and Admin): the
 * payment no longer counts; a PAID invoice it no longer covers reopens (OPEN). 409 ALREADY_VOIDED.
 */
export const VoidOfflinePaymentRequest = z.strictObject({
  reason: text(500, 'many', 'Say why the payment is voided'),
});
export type VoidOfflinePaymentRequest = z.input<typeof VoidOfflinePaymentRequest>;

// ---------- Portal (the signed-in client) ----------
/** One of the client's invoices (Receipts & Invoices). Never a draft. */
export const MyInvoice = z.object({
  id: z.uuid(),
  number: z.string(),
  service: ServiceLink.nullable(),
  /** The Service column: the service's title, or else the first line's description. */
  title: z.string(),
  status: MyInvoiceStatus,
  section: MyInvoiceSection,
  currency: z.string(),
  /** Past Invoices show this (the amount billed). */
  totalCents: Cents,
  /** Current invoices show this (what is left to pay); 0 once paid or canceled. */
  balanceDueCents: Cents,
  /** The day it was issued, or (Upcoming, or canceled while Upcoming) its scheduled day. */
  issuedOn: CalendarDate,
  dueOn: CalendarDate.nullable(),
  /** Open and past its due date: for styling the date only (the status stays Due Soon). */
  overdue: z.boolean(),
  paidAt: DateTime.nullable(),
  canceledAt: DateTime.nullable(),
  /** A payment was submitted and waits for Stripe's confirmation: show "Processing", not Paid. */
  paymentProcessing: z.boolean(),
  /**
   * Pay Now shows: open, something left to pay, nothing processing, and the firm takes online
   * payments. Upcoming, paid and canceled invoices are never payable.
   */
  canPay: z.boolean(),
});
export type MyInvoice = z.infer<typeof MyInvoice>;

/** GET /portal/{firmSlug}/me/invoices/{id} ("View"): lines, totals and the payment history. */
export const MyInvoiceDetail = MyInvoice.extend({
  ...AmountDetail,
  /** Newest first. */
  payments: z.array(InvoicePayment),
  /** Check and cash payments the firm recorded, live ones only; newest first. */
  offlinePayments: z.array(MyOfflinePayment),
});
export type MyInvoiceDetail = z.infer<typeof MyInvoiceDetail>;

/**
 * GET /portal/{firmSlug}/me/invoices. The view, the status filter and the search work together on
 * one list. Search matches the invoice number and the Service column. `section` gives one of the
 * two tables (left out: both, CURRENT first). CURRENT: soonest due date first (none last); PAST:
 * newest first (paid or canceled).
 */
export const ListMyInvoicesQuery = z.strictObject({
  view: MyInvoiceView.optional().default('ALL'),
  status: MyInvoiceStatus.optional(),
  search: SearchText.optional(),
  section: MyInvoiceSection.optional(),
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional().default(25),
});
export type ListMyInvoicesQuery = z.input<typeof ListMyInvoicesQuery>;

export const MyInvoiceList = z.object({
  items: z.array(MyInvoice).max(100),
  nextCursor: z.string().nullable(),
  /**
   * The firm takes online payments now (its Stripe account can take charges). False: no Pay
   * Now anywhere; say "Contact the firm to pay".
   */
  paymentsEnabled: z.boolean(),
});
export type MyInvoiceList = z.infer<typeof MyInvoiceList>;

/**
 * POST /portal/{firmSlug}/me/invoices/{id}/checkout ("Pay Now"): no fields at all. The amount,
 * currency and invoice come from the database, so a body with any field (an amount, say) is 400.
 */
export const PayInvoiceRequest = z.strictObject({});
export type PayInvoiceRequest = z.input<typeof PayInvoiceRequest>;

/**
 * Stripe's hosted checkout only: https, the host exactly checkout.stripe.com, no port and no user
 * part. So a bug or a tampered answer can never send a client to a lookalike payment page. A
 * custom checkout domain, if Rasel ever wants one, is added here.
 */
const StripeCheckoutUrl = z
  .url({ protocol: /^https$/, hostname: /^checkout\.stripe\.com$/ })
  .refine((url) => {
    const u = new URL(url);
    return u.port === '' && u.username === '' && u.password === '';
  }, 'Not a Stripe checkout link');

/** Mock mode's link: it opens nothing, so the page stays where it is. */
const MockCheckoutUrl = z.string().regex(/^mock:checkout\//, 'Not a checkout link');

/** Where to send the browser: Stripe's hosted checkout for this invoice, until `expiresAt`. */
export const CheckoutLink = z.object({
  url: z.union([StripeCheckoutUrl, MockCheckoutUrl]),
  expiresAt: DateTime,
});
export type CheckoutLink = z.infer<typeof CheckoutLink>;

/**
 * Stripe sends the client back to /{firmSlug}/invoices with `?checkout=success&invoice={id}` or
 * `?checkout=canceled&invoice={id}`. Success is not Paid yet: the invoice shows Paid (or
 * processing) once the webhook confirms it, usually within seconds, so refetch. Parse the page's
 * search params with this; anything else reads as no return.
 */
export const CheckoutReturn = z.object({
  checkout: z.enum(['success', 'canceled']).optional().catch(undefined),
  invoice: z.uuid().optional().catch(undefined),
});
export type CheckoutReturn = z.infer<typeof CheckoutReturn>;

/** Stable `error.code` values of this module, besides the generic ones in ApiError. */
export const InvoiceErrorCode = z.enum([
  /** 409: only a draft can be changed or sent. */
  'NOT_DRAFT',
  /** 409: a draft with nothing to pay (a zero total) cannot be sent; cancel it instead. */
  'ZERO_TOTAL',
  /** 409: the due date is before the day the invoice would open; change it first. */
  'DUE_DATE_PASSED',
  /** 409: the invoice is paid or canceled, which is final. */
  'INVOICE_CLOSED',
  /**
   * 409 (cancel): the invoice holds money (a live offline payment, or a Stripe payment not refunded
   * in full): void or refund it first.
   */
  'HAS_PAYMENTS',
  /** 409 (offline payment): only an open invoice takes a payment (not a draft, upcoming, paid or canceled). */
  'NOT_OPEN',
  /** 409 (offline payment): more than the balance due. */
  'AMOUNT_TOO_LARGE',
  /** 409 (void): the offline payment is voided already. */
  'ALREADY_VOIDED',
  /** 409: the client is archived; restore the client first (as in api.clients). */
  'CLIENT_ARCHIVED',
  /** 409 (Pay Now): not open for payment: upcoming, paid, canceled, or nothing left to pay. */
  'NOT_PAYABLE',
  /**
   * 409: a submitted payment waits for Stripe's confirmation: no second payment, and the firm
   * cannot cancel the invoice until it settles.
   */
  'PAYMENT_IN_PROGRESS',
  /** 409 (Pay Now): the firm cannot take online payments yet (no Stripe account taking charges). */
  'PAYMENTS_NOT_SET_UP',
  /** 409 (refund): the payment is not SUCCEEDED (pending, failed, or refunded in full already). */
  'NOT_REFUNDABLE',
  /** 409 (refund): more than the payment's `refundableCents`. */
  'REFUND_TOO_LARGE',
  /**
   * 503 (Pay Now, refund): Stripe did not answer; nothing was charged or refunded. Try again in a
   * moment (a refund with the same `idempotencyKey`).
   */
  'PAYMENT_PROVIDER_UNAVAILABLE',
]);
export type InvoiceErrorCode = z.infer<typeof InvoiceErrorCode>;

/**
 * What users see for this module's codes: `errorMessage(error, INVOICE_ERRORS)` on the firm's
 * invoice pages and the portal's Receipts & Invoices. errorMessage() alone
 * (apps/web/src/lib/errors.ts) knows only the generic codes.
 */
export const INVOICE_ERRORS = {
  NOT_DRAFT: 'This invoice has been sent, so it can no longer be changed. Reload to see it.',
  ZERO_TOTAL: 'There is nothing to pay on this invoice. Cancel it instead.',
  DUE_DATE_PASSED: 'The due date has passed. Choose a later due date, then send it.',
  INVOICE_CLOSED: 'This invoice is paid or canceled, so it can no longer be changed.',
  HAS_PAYMENTS:
    'This invoice has payments. Void its check or cash payments and refund its card payments first.',
  NOT_OPEN: 'Only an open invoice can take a payment. Reload to see its status.',
  AMOUNT_TOO_LARGE: 'The payment is more than the balance due on this invoice.',
  ALREADY_VOIDED: 'This payment is voided already. Reload to see it.',
  CLIENT_ARCHIVED: 'This client is archived. Restore the client first.',
  NOT_PAYABLE: 'This invoice is not open for payment. Reload to see its status.',
  PAYMENT_IN_PROGRESS:
    'A payment for this invoice is being processed. It will show here once it is confirmed.',
  PAYMENTS_NOT_SET_UP: 'Online payment is not available yet. Please contact the firm to pay.',
  NOT_REFUNDABLE: 'This payment cannot be refunded. Reload to see its status.',
  REFUND_TOO_LARGE: 'The refund is more than what is left of this payment.',
  PAYMENT_PROVIDER_UNAVAILABLE:
    'The payment service is not answering. Nothing was charged or refunded. Try again in a moment.',
} as const satisfies Record<InvoiceErrorCode, string>;
