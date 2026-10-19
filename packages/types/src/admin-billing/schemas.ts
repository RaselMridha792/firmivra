import { z } from 'zod';
import { SearchText, text } from '../clients/text.js';
import {
  BusinessStatus,
  PlatformCreditNoteStatus,
  PlatformEstimateStatus,
  PlatformPaymentMethod,
  PlatformPaymentStatus,
  PlatformRecurringFrequency,
  PlatformRecurringStatus,
  PlatformRefundStatus,
} from '../db-enums.js';

// Super Admin Billing (R0 stage B3, `platform_*` billing tables; contract note
// docs/work/R0-stage-b3-billing.md; notes on this contract in docs/work/R60-backend.md).
// Firmivra bills FIRMS: the firm is the customer and its billing contact is who a document is
// addressed to (Rasel, Oct 17). Invoices, recurring schedules, estimates, payments and refunds,
// credit notes, the platform Billing Settings and each firm's billing profile.
// Routes: /api/v1/admin/billing/... (the Super Admin site's session only).
// Money is integer cents in USD; dates are `YYYY-MM-DD`, times ISO. The database numbers the
// documents and keeps every total, paid, credited and refunded sum and the statuses they decide:
// nothing here sets them. Responses are plain objects; requests are strict.

const DateTime = z.iso.datetime({ offset: true });
/** `YYYY-MM-DD`. */
const Day = z.iso.date();
const Id = z.uuid();
const Cents = z.number().int();
const Money = z.number().int().min(0).max(100_000_000_00, 'That amount is too large');
const Note = (max: number) =>
  z.string().trim().max(max, `Use at most ${max} characters`).default('');

export const BillingInvoiceId = Id;
export const BillingEstimateId = Id;
export const BillingPaymentId = Id;
export const BillingCreditNoteId = Id;
export const BillingRecurringId = Id;
export const BillingFirmId = Id;

// ---------- Labels and enums ----------

/** One currency today: the database bills in USD. */
export const BillingCurrency = z.enum(['USD']);
export type BillingCurrency = z.infer<typeof BillingCurrency>;

export const BillingPaymentTerms = z.enum([
  'DUE_ON_RECEIPT',
  'NET_7',
  'NET_15',
  'NET_30',
  'NET_45',
  'NET_60',
]);
export type BillingPaymentTerms = z.infer<typeof BillingPaymentTerms>;
/** Days from the invoice date to the due date. */
export const BILLING_PAYMENT_TERM_DAYS: Readonly<Record<BillingPaymentTerms, number>> = {
  DUE_ON_RECEIPT: 0,
  NET_7: 7,
  NET_15: 15,
  NET_30: 30,
  NET_45: 45,
  NET_60: 60,
};
export const BILLING_PAYMENT_TERM_LABELS: Readonly<Record<BillingPaymentTerms, string>> = {
  DUE_ON_RECEIPT: 'Due on receipt',
  NET_7: 'Net 7',
  NET_15: 'Net 15',
  NET_30: 'Net 30',
  NET_45: 'Net 45',
  NET_60: 'Net 60',
};

/**
 * What the page shows, from the stored status and the money: PENDING is sent with nothing paid
 * yet; OVERDUE is sent or partly paid, past due, with a balance. Never set by hand.
 */
export const BillingInvoiceStatus = z.enum([
  'DRAFT',
  'PENDING',
  'PARTIALLY_PAID',
  'PAID',
  'OVERDUE',
  'VOIDED',
  'PARTIALLY_REFUNDED',
  'REFUNDED',
]);
export type BillingInvoiceStatus = z.infer<typeof BillingInvoiceStatus>;
export const BILLING_INVOICE_STATUS_LABELS: Readonly<Record<BillingInvoiceStatus, string>> = {
  DRAFT: 'Draft',
  PENDING: 'Pending',
  PARTIALLY_PAID: 'Partially Paid',
  PAID: 'Paid',
  OVERDUE: 'Overdue',
  VOIDED: 'Voided',
  PARTIALLY_REFUNDED: 'Partially Refunded',
  REFUNDED: 'Refunded',
};

/** Whether the document's email went out: NOT_SENT, SENT, or FAILED (`sendError` says why). */
export const BillingSendStatus = z.enum(['NOT_SENT', 'SENT', 'FAILED']);
export type BillingSendStatus = z.infer<typeof BillingSendStatus>;

export const BillingPaymentMethod = PlatformPaymentMethod;
export type BillingPaymentMethod = z.infer<typeof PlatformPaymentMethod>;
export const BILLING_PAYMENT_METHOD_LABELS: Readonly<Record<BillingPaymentMethod, string>> = {
  CARD: 'Credit Card',
  ACH: 'ACH',
  WIRE: 'Bank Transfer',
  CHECK: 'Check',
  CASH: 'Cash',
  CREDIT_BALANCE: 'Credit Balance',
  OTHER: 'Manual',
};
/** Methods a Super Admin records by hand (CREDIT_BALANCE is a credit note's). */
export const BillingRecordMethod = z.enum(['CARD', 'ACH', 'WIRE', 'CHECK', 'CASH', 'OTHER']);

export const BillingPaymentStatus = PlatformPaymentStatus;
export type BillingPaymentStatus = z.infer<typeof PlatformPaymentStatus>;
export const BILLING_PAYMENT_STATUS_LABELS: Readonly<Record<BillingPaymentStatus, string>> = {
  PENDING: 'Pending',
  COMPLETED: 'Completed',
  FAILED: 'Failed',
  PARTIALLY_REFUNDED: 'Partially Refunded',
  REFUNDED: 'Refunded',
};

export const BillingEstimateStatus = PlatformEstimateStatus;
export type BillingEstimateStatus = z.infer<typeof PlatformEstimateStatus>;
export const BILLING_ESTIMATE_STATUS_LABELS: Readonly<Record<BillingEstimateStatus, string>> = {
  DRAFT: 'Draft',
  SENT: 'Sent',
  PENDING: 'Pending',
  APPROVED: 'Approved',
  DECLINED: 'Declined',
  EXPIRED: 'Expired',
  CONVERTED: 'Converted',
};
/** The statuses a Super Admin sets by hand (Expired and Converted follow from dates and invoices). */
export const BillingEstimateSetStatus = z.enum([
  'DRAFT',
  'SENT',
  'PENDING',
  'APPROVED',
  'DECLINED',
]);
export type BillingEstimateSetStatus = z.infer<typeof BillingEstimateSetStatus>;

export const BillingCreditNoteStatus = PlatformCreditNoteStatus;
export type BillingCreditNoteStatus = z.infer<typeof PlatformCreditNoteStatus>;
export const BILLING_CREDIT_NOTE_STATUS_LABELS: Readonly<Record<BillingCreditNoteStatus, string>> =
  {
    DRAFT: 'Draft',
    AVAILABLE: 'Available',
    PARTIALLY_APPLIED: 'Partially Applied',
    APPLIED: 'Applied',
    REFUNDED: 'Refunded',
    VOIDED: 'Voided',
  };

export const BillingCreditReason = z.enum([
  'SERVICE_ISSUE',
  'BILLING_ERROR',
  'DUPLICATE_CHARGE',
  'CANCELLATION',
  'PRICE_ADJUSTMENT',
  'GOODWILL',
  'OTHER',
]);
export type BillingCreditReason = z.infer<typeof BillingCreditReason>;
export const BILLING_CREDIT_REASON_LABELS: Readonly<Record<BillingCreditReason, string>> = {
  SERVICE_ISSUE: 'Service issue',
  BILLING_ERROR: 'Billing error',
  DUPLICATE_CHARGE: 'Duplicate charge',
  CANCELLATION: 'Cancellation',
  PRICE_ADJUSTMENT: 'Price adjustment',
  GOODWILL: 'Goodwill',
  OTHER: 'Other',
};
/** Line-item credits, or one adjustment amount. */
export const BillingCreditMethod = z.enum(['LINE_ITEMS', 'ADJUSTMENT']);
export type BillingCreditMethod = z.infer<typeof BillingCreditMethod>;

export const BillingRecurringFrequency = PlatformRecurringFrequency;
export type BillingRecurringFrequency = z.infer<typeof PlatformRecurringFrequency>;
export const BILLING_RECURRING_FREQUENCY_LABELS: Readonly<
  Record<BillingRecurringFrequency, string>
> = {
  WEEKLY: 'Weekly',
  MONTHLY: 'Monthly',
  QUARTERLY: 'Quarterly',
  SEMIANNUAL: 'Semi-annually',
  ANNUAL: 'Annually',
  CUSTOM: 'Custom',
};
export const BillingRecurringStatus = PlatformRecurringStatus;
export type BillingRecurringStatus = z.infer<typeof PlatformRecurringStatus>;

/** Where a refund goes: back through the original method (the only one stored today). */
export const BillingRefundMethod = z.enum(['ORIGINAL', 'CHECK', 'BANK_TRANSFER', 'CASH']);
export type BillingRefundMethod = z.infer<typeof BillingRefundMethod>;

export const BillingTemplateKind = z.enum([
  'INVOICE',
  'ESTIMATE',
  'RECEIPT',
  'CREDIT_NOTE',
  'PAYMENT_REMINDER',
  'REFUND_CONFIRMATION',
]);
export type BillingTemplateKind = z.infer<typeof BillingTemplateKind>;

export const BillingDocumentKind = z.enum(['invoice', 'estimate', 'creditNote']);
export type BillingDocumentKind = z.infer<typeof BillingDocumentKind>;

// ---------- Reference data ----------

/** A firm Firmivra bills: the firm, its billing profile (the firm's overrides) and its plan. */
export const BillingFirm = z.object({
  id: Id,
  slug: z.string(),
  name: z.string(),
  status: BusinessStatus,
  /** Who documents are addressed to: the billing profile's contact, else the firm's first owner. */
  contactName: z.string(),
  contactEmail: z.string(),
  contactPhone: z.string(),
  /** The firm's override; null uses the platform default. */
  paymentTermDays: z.number().int().nullable(),
  /** The firm's tax rate in percent; null uses the platform default. */
  taxPercent: z.number().nullable(),
  taxExempt: z.boolean(),
  autoPay: z.boolean(),
  notes: z.string(),
  /** A billing profile is saved for the firm (else the contact is its owner). */
  hasProfile: z.boolean(),
  /** The firm's subscription, when it has one. */
  plan: z.object({ name: z.string(), status: z.string(), cycle: z.string() }).nullable(),
  /** New documents go only to ACTIVE firms; the others keep their history. */
  canBill: z.boolean(),
});
export type BillingFirm = z.infer<typeof BillingFirm>;

/** A Super Admin team member (Created By, Recorded By, Assign To). */
export const BillingAdmin = z.object({ id: Id, name: z.string(), email: z.string() });
export type BillingAdmin = z.infer<typeof BillingAdmin>;

/** A plan from the price list, for the "Item / Service" pickers. */
export const BillingItem = z.object({
  id: Id,
  name: z.string(),
  description: z.string(),
  unitPriceCents: Cents,
});
export type BillingItem = z.infer<typeof BillingItem>;

/** One history entry (from the audit log): who did what, when, and the amount when money moved. */
export const BillingEvent = z.object({
  id: Id,
  at: DateTime,
  actor: z.string(),
  action: z.string(),
  detail: z.string(),
  amountCents: Cents.nullable(),
});
export type BillingEvent = z.infer<typeof BillingEvent>;

/** A document line; amount and tax are the database's. */
export const BillingLine = z.object({
  id: Id,
  description: z.string(),
  quantity: z.number(),
  rateCents: Cents,
  taxPercent: z.number(),
  amountCents: Cents,
  taxCents: Cents,
});
export type BillingLine = z.infer<typeof BillingLine>;

// ---------- Invoices ----------

export const BillingInvoice = z.object({
  id: Id,
  /** "INV-1001", given by the database when the invoice is created. */
  number: z.string(),
  firmId: Id,
  firmName: z.string(),
  /** Who it is addressed to (the firm's billing contact when it was made). */
  billToName: z.string(),
  billToEmail: z.string(),
  currency: BillingCurrency,
  /** The terms the due date matches, or null for a custom due date. */
  paymentTerms: BillingPaymentTerms.nullable(),
  issueDate: Day,
  dueDate: Day,
  periodStart: Day.nullable(),
  periodEnd: Day.nullable(),
  reference: z.string(),
  notes: z.string(),
  internalNote: z.string(),
  lines: z.array(BillingLine),
  subtotalCents: Cents,
  discountCents: Cents,
  taxCents: Cents,
  totalCents: Cents,
  /** Completed payments, before refunds. */
  paidCents: Cents,
  refundedCents: Cents,
  creditedCents: Cents,
  /** What the firm still owes: total - paid - credits (refunds don't reopen it). */
  balanceCents: Cents,
  status: BillingInvoiceStatus,
  allowOnlinePayment: z.boolean(),
  recurringId: Id.nullable(),
  estimateId: Id.nullable(),
  estimateNumber: z.string().nullable(),
  sentAt: DateTime.nullable(),
  sendStatus: BillingSendStatus,
  sendError: z.string().nullable(),
  paidAt: DateTime.nullable(),
  voidedAt: DateTime.nullable(),
  voidReason: z.string().nullable(),
  createdAt: DateTime,
  updatedAt: DateTime,
  createdBy: z.string(),
});
export type BillingInvoice = z.infer<typeof BillingInvoice>;

/** A credit note applied to an invoice. */
export const BillingInvoiceCredit = z.object({
  id: Id,
  creditNoteId: Id,
  creditNoteNumber: z.string(),
  amountCents: Cents,
  at: DateTime,
  by: z.string(),
});
export type BillingInvoiceCredit = z.infer<typeof BillingInvoiceCredit>;

export const BillingRefund = z.object({
  id: Id,
  paymentId: Id,
  amountCents: Cents,
  type: z.enum(['FULL', 'PARTIAL']),
  status: PlatformRefundStatus,
  reason: z.string(),
  notes: z.string(),
  method: BillingRefundMethod,
  at: DateTime,
  by: z.string(),
});
export type BillingRefund = z.infer<typeof BillingRefund>;

export const BillingPayment = z.object({
  id: Id,
  invoiceId: Id,
  invoiceNumber: z.string(),
  firmId: Id,
  firmName: z.string(),
  billToName: z.string(),
  currency: BillingCurrency,
  amountCents: Cents,
  paidOn: Day,
  method: PlatformPaymentMethod,
  /** Reference or transaction id. */
  reference: z.string(),
  status: PlatformPaymentStatus,
  refundedCents: Cents,
  /** What may still be refunded (0 unless Completed or Partially Refunded). */
  refundableCents: Cents,
  refunds: z.array(BillingRefund),
  notes: z.string(),
  failureReason: z.string().nullable(),
  recordedBy: z.string(),
  recordedAt: DateTime,
  receiptSentAt: DateTime.nullable(),
});
export type BillingPayment = z.infer<typeof BillingPayment>;

/** Invoice Details: the invoice with its firm, payments, credits and history. */
export const BillingInvoiceDetail = BillingInvoice.extend({
  firm: BillingFirm,
  payments: z.array(BillingPayment),
  credits: z.array(BillingInvoiceCredit),
  history: z.array(BillingEvent),
  schedule: z.object({ id: Id, description: z.string() }).nullable(),
});
export type BillingInvoiceDetail = z.infer<typeof BillingInvoiceDetail>;

// ---------- Estimates ----------

export const BillingEstimate = z.object({
  id: Id,
  number: z.string(),
  firmId: Id,
  firmName: z.string(),
  contactName: z.string(),
  email: z.string(),
  phone: z.string(),
  currency: BillingCurrency,
  issueDate: Day,
  expirationDate: Day,
  reference: z.string(),
  lines: z.array(BillingLine),
  subtotalCents: Cents,
  discountCents: Cents,
  taxCents: Cents,
  totalCents: Cents,
  notes: z.string(),
  status: PlatformEstimateStatus,
  assignedToId: Id.nullable(),
  assignedToName: z.string().nullable(),
  convertedInvoiceId: Id.nullable(),
  convertedInvoiceNumber: z.string().nullable(),
  sentAt: DateTime.nullable(),
  decidedAt: DateTime.nullable(),
  createdBy: z.string(),
  createdAt: DateTime,
  updatedAt: DateTime,
  history: z.array(BillingEvent),
});
export type BillingEstimate = z.infer<typeof BillingEstimate>;

// ---------- Credit notes ----------

export const BillingCreditApplication = z.object({
  id: Id,
  invoiceId: Id,
  invoiceNumber: z.string(),
  amountCents: Cents,
  at: DateTime,
  by: z.string(),
});
export type BillingCreditApplication = z.infer<typeof BillingCreditApplication>;

export const BillingCreditNote = z.object({
  id: Id,
  number: z.string(),
  firmId: Id,
  firmName: z.string(),
  invoiceId: Id.nullable(),
  invoiceNumber: z.string().nullable(),
  currency: BillingCurrency,
  date: Day,
  reason: BillingCreditReason,
  method: BillingCreditMethod,
  lines: z.array(BillingLine),
  subtotalCents: Cents,
  taxCents: Cents,
  /** The original amount. */
  totalCents: Cents,
  appliedCents: Cents,
  refundedCents: Cents,
  /** original = applied + refunded + remaining. */
  remainingCents: Cents,
  internalNote: z.string(),
  customerNote: z.string(),
  status: PlatformCreditNoteStatus,
  issuedAt: DateTime.nullable(),
  voidedAt: DateTime.nullable(),
  voidReason: z.string().nullable(),
  applications: z.array(BillingCreditApplication),
  createdBy: z.string(),
  createdAt: DateTime,
  updatedAt: DateTime,
  history: z.array(BillingEvent),
});
export type BillingCreditNote = z.infer<typeof BillingCreditNote>;

// ---------- Recurring ----------

export const BillingRecurring = z.object({
  id: Id,
  firmId: Id,
  firmName: z.string(),
  /** What it bills ("Premium Plan"): the first line of each invoice. */
  template: z.string(),
  /** "Monthly subscription". */
  description: z.string(),
  frequency: PlatformRecurringFrequency,
  /** Days between invoices when CUSTOM. */
  customIntervalDays: z.number().int().nullable(),
  amountCents: Cents,
  currency: BillingCurrency,
  startDate: Day,
  /** Null once the schedule has no more invoices to make. */
  nextInvoiceDate: Day.nullable(),
  endDate: Day.nullable(),
  autoSend: z.boolean(),
  autoPay: z.boolean(),
  status: PlatformRecurringStatus,
  /** The invoices it made, newest first. */
  invoices: z.array(
    z.object({ id: Id, number: z.string(), issueDate: Day, status: BillingInvoiceStatus }),
  ),
  createdAt: DateTime,
  updatedAt: DateTime,
  history: z.array(BillingEvent),
});
export type BillingRecurring = z.infer<typeof BillingRecurring>;

// ---------- Settings ----------

const ReminderRule = z.strictObject({
  enabled: z.boolean(),
  days: z.number().int().min(0).max(365),
});
const DocumentTemplate = z.strictObject({
  name: text(100, 'one', 'Name the template'),
  subject: text(200, 'one', 'Enter a subject'),
  body: text(2000, 'many', 'Write the message'),
});

/**
 * Platform Billing Settings. `general`, `taxes`, `reminders` and `templates` are stored.
 * `numbering` is read-only (the database numbers documents). `preferences` are the page's other
 * options: they read their defaults and a change is 422 NOT_SUPPORTED_YET until the database
 * stores them (docs/work/R60-backend.md, "Needs from others").
 */
export const BillingSettings = z.strictObject({
  general: z.strictObject({
    currency: BillingCurrency,
    invoiceTerms: BillingPaymentTerms,
    estimateValidityDays: z.number().int().min(1, 'At least 1 day').max(365, 'At most 365 days'),
    enablePartialPayments: z.boolean(),
    footerNote: Note(1000),
  }),
  taxes: z.strictObject({
    /** The default tax rate in percent (two decimals). */
    defaultTaxPercent: z.number().min(0).max(100),
    lateFee: z.strictObject({
      enabled: z.boolean(),
      percent: z.number().min(0).max(100),
      graceDays: z.number().int().min(0).max(365),
    }),
  }),
  reminders: z.strictObject({
    invoiceDue: ReminderRule,
    overdue: ReminderRule.extend({
      repeatEveryDays: z.number().int().min(1).max(90),
      maxReminders: z.number().int().min(1).max(12),
    }),
    estimateExpiring: ReminderRule,
    failedPayment: ReminderRule,
  }),
  templates: z.record(BillingTemplateKind, DocumentTemplate),
  numbering: z.strictObject({
    invoice: z.strictObject({ prefix: z.string(), next: z.number().int() }),
    estimate: z.strictObject({ prefix: z.string(), next: z.number().int() }),
    creditNote: z.strictObject({ prefix: z.string(), next: z.number().int() }),
  }),
  preferences: z.strictObject({
    language: z.string(),
    timeZone: z.string(),
    dateFormat: z.enum(['MM/DD/YYYY', 'DD/MM/YYYY', 'YYYY-MM-DD']),
    enableCreditNotes: z.boolean(),
    enableEstimates: z.boolean(),
    requirePurchaseOrder: z.boolean(),
    termsAndConditions: z.string(),
    discountBeforeTax: z.boolean(),
    onlinePaymentDefault: z.boolean(),
    sendReceipts: z.boolean(),
    requireRefundReason: z.boolean(),
    taxMode: z.enum(['EXCLUSIVE', 'INCLUSIVE']),
    firmsMayOverride: z.boolean(),
  }),
  updatedAt: DateTime.nullable(),
  updatedBy: z.string().nullable(),
});
export type BillingSettings = z.infer<typeof BillingSettings>;
/** What Save sends: the page, without the read-only parts. */
export const UpdateBillingSettingsRequest = BillingSettings.omit({
  numbering: true,
  updatedAt: true,
  updatedBy: true,
});
export type UpdateBillingSettingsRequest = z.input<typeof UpdateBillingSettingsRequest>;

/** A firm's billing profile: who documents go to, and the firm's own terms and tax. */
export const SaveBillingProfileRequest = z.strictObject({
  contactName: text(200, 'one', 'Enter the billing contact'),
  contactEmail: z.email('Enter an email address').max(320),
  paymentTermDays: z.number().int().min(0).max(365).nullable().default(null),
  taxPercent: z.number().min(0).max(100).nullable().default(null),
  taxExempt: z.boolean().default(false),
  autoPay: z.boolean().default(false),
  notes: Note(2000),
});
export type SaveBillingProfileRequest = z.input<typeof SaveBillingProfileRequest>;

// ---------- Lists ----------

/** Several values in one query parameter: an array in, `a,b` on the wire. */
const listOf = <T extends z.ZodType>(item: T) =>
  z
    .preprocess(
      (value) => (typeof value === 'string' ? value.split(',').filter(Boolean) : value),
      z.array(item).max(20),
    )
    .optional();

const PageFields = {
  search: SearchText.optional(),
  firmId: Id.optional(),
  /** The list's own date column, from and to (inclusive). */
  from: Day.optional(),
  to: Day.optional(),
  descending: z
    .preprocess((v) => (v === 'true' ? true : v === 'false' ? false : v), z.boolean())
    .optional(),
  page: z.coerce.number().int().min(1).optional(),
  pageSize: z.coerce.number().int().min(1).max(100).optional(),
};

const pageOf = <T extends z.ZodType>(item: T) =>
  z.object({
    items: z.array(item),
    total: z.number().int(),
    page: z.number().int(),
    pageSize: z.number().int(),
    pageCount: z.number().int(),
  });

export const BillingInvoicesQuery = z.strictObject({
  ...PageFields,
  status: listOf(BillingInvoiceStatus),
  dueFrom: Day.optional(),
  dueTo: Day.optional(),
  minCents: z.coerce.number().int().min(0).optional(),
  maxCents: z.coerce.number().int().min(0).optional(),
  sort: z.enum(['number', 'firm', 'issueDate', 'dueDate', 'amount', 'status']).optional(),
});
export type BillingInvoicesQuery = z.input<typeof BillingInvoicesQuery>;
export const BillingInvoicePage = pageOf(BillingInvoice);
export type BillingInvoicePage = z.infer<typeof BillingInvoicePage>;

export const BillingPaymentsQuery = z.strictObject({
  ...PageFields,
  status: listOf(PlatformPaymentStatus),
  method: listOf(PlatformPaymentMethod),
  invoiceId: Id.optional(),
  sort: z.enum(['paidOn', 'firm', 'invoice', 'amount', 'method', 'status']).optional(),
});
export type BillingPaymentsQuery = z.input<typeof BillingPaymentsQuery>;
export const BillingPaymentPage = pageOf(BillingPayment);
export type BillingPaymentPage = z.infer<typeof BillingPaymentPage>;

export const BillingEstimatesQuery = z.strictObject({
  ...PageFields,
  status: listOf(PlatformEstimateStatus),
  sort: z.enum(['number', 'firm', 'issueDate', 'expirationDate', 'amount', 'status']).optional(),
});
export type BillingEstimatesQuery = z.input<typeof BillingEstimatesQuery>;
export const BillingEstimatePage = pageOf(BillingEstimate.omit({ history: true }));
export type BillingEstimatePage = z.infer<typeof BillingEstimatePage>;

export const BillingCreditNotesQuery = z.strictObject({
  ...PageFields,
  status: listOf(PlatformCreditNoteStatus),
  invoiceId: Id.optional(),
  sort: z
    .enum(['number', 'firm', 'invoice', 'date', 'amount', 'applied', 'remaining', 'status'])
    .optional(),
});
export type BillingCreditNotesQuery = z.input<typeof BillingCreditNotesQuery>;
export const BillingCreditNotePage = pageOf(BillingCreditNote.omit({ history: true }));
export type BillingCreditNotePage = z.infer<typeof BillingCreditNotePage>;

export const BillingRecurringQuery = z.strictObject({
  ...PageFields,
  status: listOf(PlatformRecurringStatus),
  sort: z.enum(['firm', 'template', 'frequency', 'amount', 'nextInvoiceDate', 'status']).optional(),
});
export type BillingRecurringQuery = z.input<typeof BillingRecurringQuery>;
export const BillingRecurringPage = pageOf(
  BillingRecurring.omit({ history: true, invoices: true }),
);
export type BillingRecurringPage = z.infer<typeof BillingRecurringPage>;

const Trend = z.number().int().nullable();

/** The Billing dashboard's cards, over the same filtered invoices as the table. */
export const BillingInvoiceSummary = z.object({
  /** Issued invoices (not drafts, not voided). */
  invoicedCents: Cents,
  invoicedCount: z.number().int(),
  /** Percent change against the previous period of the same length; null without one. */
  invoicedTrend: Trend,
  /** Money received, net of refunds. */
  paidCents: Cents,
  paidCount: z.number().int(),
  paidTrend: Trend,
  /** Open balances: pending, partly paid and overdue invoices. */
  outstandingCents: Cents,
  outstandingCount: z.number().int(),
  overdueCents: Cents,
  overdueCount: z.number().int(),
});
export type BillingInvoiceSummary = z.infer<typeof BillingInvoiceSummary>;

export const BillingPaymentSummary = z.object({
  totalCents: Cents,
  totalCount: z.number().int(),
  totalTrend: Trend,
  /** Completed payments this calendar month, against last month. */
  monthCents: Cents,
  monthCount: z.number().int(),
  monthTrend: Trend,
  refundsCents: Cents,
  refundsCount: z.number().int(),
  averageCents: Cents,
});
export type BillingPaymentSummary = z.infer<typeof BillingPaymentSummary>;

export const BillingEstimateSummary = z.object({
  totalCents: Cents,
  totalCount: z.number().int(),
  approvedCents: Cents,
  approvedCount: z.number().int(),
  /** Sent and Pending. */
  pendingCents: Cents,
  pendingCount: z.number().int(),
  declinedCents: Cents,
  declinedCount: z.number().int(),
});
export type BillingEstimateSummary = z.infer<typeof BillingEstimateSummary>;

export const BillingCreditNoteSummary = z.object({
  count: z.number().int(),
  /** Issued (not draft, not voided). */
  issuedCents: Cents,
  appliedCents: Cents,
  /** Still available on Available and Partially Applied notes. */
  availableCents: Cents,
  refundedCents: Cents,
});
export type BillingCreditNoteSummary = z.infer<typeof BillingCreditNoteSummary>;

export const BillingRecurringCounts = z.object({
  all: z.number().int(),
  active: z.number().int(),
  paused: z.number().int(),
  canceled: z.number().int(),
});
export type BillingRecurringCounts = z.infer<typeof BillingRecurringCounts>;

// ---------- Changes ----------

const Quantity = z
  .number()
  .positive('Enter a quantity above 0')
  .max(99_999_999, 'That quantity is too large')
  .refine((q) => Math.round(q * 100) === q * 100, 'Use at most two decimals');
const TaxPercent = z
  .number()
  .min(0)
  .max(100)
  .refine((t) => Math.round(t * 100) === t * 100, 'Use at most two decimals');

export const SaveBillingLine = z.strictObject({
  description: text(500, 'one', 'Describe the item'),
  quantity: Quantity,
  rateCents: Money,
  taxPercent: TaxPercent.default(0),
});
export type SaveBillingLine = z.input<typeof SaveBillingLine>;
const Lines = z
  .array(SaveBillingLine)
  .min(1, 'Add at least one line')
  .max(100, 'At most 100 lines');

/** Create Invoice and Edit Invoice (drafts only). */
export const SaveBillingInvoiceRequest = z
  .strictObject({
    firmId: Id,
    issueDate: Day,
    dueDate: Day,
    periodStart: Day.nullable().default(null),
    periodEnd: Day.nullable().default(null),
    reference: Note(100),
    notes: Note(2000),
    internalNote: Note(2000),
    lines: Lines,
    discountCents: Money.default(0),
    allowOnlinePayment: z.boolean().default(true),
    /** Save & Send: issue it now (and email it unless `emailFirm` is false). */
    send: z.boolean().default(false),
    emailFirm: z.boolean().default(true),
    /** The estimate this invoice converts (the estimate becomes Converted). */
    estimateId: Id.nullable().default(null),
  })
  .refine((b) => b.dueDate >= b.issueDate, {
    message: 'The due date is before the invoice date',
    path: ['dueDate'],
  })
  .refine((b) => !b.periodStart || !b.periodEnd || b.periodEnd >= b.periodStart, {
    message: 'The period ends before it starts',
    path: ['periodEnd'],
  });
export type SaveBillingInvoiceRequest = z.input<typeof SaveBillingInvoiceRequest>;

export const VoidBillingRequest = z.strictObject({ reason: text(500, 'many', 'Give a reason') });
export type VoidBillingRequest = z.input<typeof VoidBillingRequest>;

export const SendBillingRequest = z.strictObject({
  /** False issues it without emailing. */
  email: z.boolean().default(true),
});
export type SendBillingRequest = z.input<typeof SendBillingRequest>;

export const RecordBillingPaymentRequest = z.strictObject({
  /** One per form opening: a retry never records the payment twice. */
  requestId: Id,
  amountCents: Money.min(1, 'Enter an amount'),
  paidOn: Day,
  method: BillingRecordMethod,
  reference: Note(100),
  notes: Note(1000),
  sendReceipt: z.boolean().default(false),
});
export type RecordBillingPaymentRequest = z.input<typeof RecordBillingPaymentRequest>;

export const RefundBillingPaymentRequest = z.strictObject({
  type: z.enum(['FULL', 'PARTIAL']),
  /** For a partial refund; a full one refunds what is left. */
  amountCents: Money.default(0),
  reason: text(500, 'one', 'Give a reason'),
  notes: Note(1000),
  method: BillingRefundMethod.default('ORIGINAL'),
  /** The confirmation checkbox. */
  confirmed: z.literal(true, 'Confirm the refund'),
});
export type RefundBillingPaymentRequest = z.input<typeof RefundBillingPaymentRequest>;

export const ApplyBillingCreditRequest = z.strictObject({
  invoiceId: Id,
  amountCents: Money.min(1, 'Enter an amount'),
  confirmed: z.literal(true, 'Confirm the credit'),
});
export type ApplyBillingCreditRequest = z.input<typeof ApplyBillingCreditRequest>;

/** Create Estimate and Edit Estimate (drafts only). */
export const SaveBillingEstimateRequest = z
  .strictObject({
    firmId: Id,
    contactName: text(200, 'one', 'Enter the contact'),
    email: z.email('Enter an email address').max(320),
    phone: Note(40),
    issueDate: Day,
    expirationDate: Day,
    reference: Note(100),
    lines: Lines,
    discountCents: Money.default(0),
    notes: Note(4000),
    assignedToId: Id.nullable().default(null),
    /** Send Estimate: mark it Sent (and email it unless `emailFirm` is false). */
    send: z.boolean().default(false),
    emailFirm: z.boolean().default(true),
  })
  .refine((b) => b.expirationDate >= b.issueDate, {
    message: 'The expiration date is before the issue date',
    path: ['expirationDate'],
  });
export type SaveBillingEstimateRequest = z.input<typeof SaveBillingEstimateRequest>;

export const SetBillingEstimateStatusRequest = z.strictObject({ status: BillingEstimateSetStatus });
export type SetBillingEstimateStatusRequest = z.input<typeof SetBillingEstimateStatusRequest>;

/** Create Credit Note (a draft, or issued at once). */
export const SaveBillingCreditNoteRequest = z
  .strictObject({
    firmId: Id,
    invoiceId: Id.nullable().default(null),
    date: Day,
    reason: BillingCreditReason,
    method: BillingCreditMethod,
    lines: z.array(SaveBillingLine).max(100).default([]),
    /** ADJUSTMENT: the amount credited. */
    adjustmentCents: Money.default(0),
    internalNote: Note(2000),
    customerNote: Note(2000),
    /** Issue Credit Note; false saves a draft. */
    issue: z.boolean().default(false),
  })
  .refine((b) => (b.method === 'LINE_ITEMS' ? b.lines.length > 0 : b.adjustmentCents > 0), {
    message: 'Add a line or an amount to credit',
    path: ['lines'],
  });
export type SaveBillingCreditNoteRequest = z.input<typeof SaveBillingCreditNoteRequest>;

export const RefundBillingCreditRequest = z.strictObject({
  amountCents: Money.min(1, 'Enter an amount'),
  reason: text(500, 'one', 'Give a reason'),
  method: BillingRefundMethod.default('ORIGINAL'),
});
export type RefundBillingCreditRequest = z.input<typeof RefundBillingCreditRequest>;

/** The recurring drawer. */
export const SaveBillingRecurringRequest = z
  .strictObject({
    firmId: Id,
    template: text(200, 'one', 'Name what it bills'),
    description: text(500, 'one', 'Describe the schedule'),
    frequency: PlatformRecurringFrequency,
    customIntervalDays: z.number().int().min(1).max(365).nullable().default(null),
    amountCents: Money.min(1, 'Enter an amount'),
    startDate: Day,
    nextInvoiceDate: Day,
    endDate: Day.nullable().default(null),
    autoSend: z.boolean().default(true),
    autoPay: z.boolean().default(false),
  })
  .refine((b) => b.frequency !== 'CUSTOM' || b.customIntervalDays !== null, {
    message: 'Enter the days between invoices',
    path: ['customIntervalDays'],
  })
  .refine((b) => b.nextInvoiceDate >= b.startDate, {
    message: 'The next invoice is before the start',
    path: ['nextInvoiceDate'],
  })
  .refine((b) => !b.endDate || b.endDate >= b.startDate, {
    message: 'The end is before the start',
    path: ['endDate'],
  });
export type SaveBillingRecurringRequest = z.input<typeof SaveBillingRecurringRequest>;

export const SetBillingRecurringStatusRequest = z.strictObject({ status: PlatformRecurringStatus });
export type SetBillingRecurringStatusRequest = z.input<typeof SetBillingRecurringStatusRequest>;

export const BillingNextNumber = z.object({ number: z.string() });
export type BillingNextNumber = z.infer<typeof BillingNextNumber>;

export const BillingOk = z.object({ ok: z.literal(true) });
export type BillingOk = z.infer<typeof BillingOk>;

// ---------- Errors ----------

export const BillingErrorCode = z.enum([
  'NOT_FOUND',
  'FORBIDDEN',
  'FIRM_NOT_BILLABLE',
  'NOT_A_DRAFT',
  'ALREADY_VOIDED',
  'HAS_MONEY',
  'NOT_ISSUED',
  'OVER_BALANCE',
  'OVER_REFUNDABLE',
  'OVER_CREDIT',
  'CREDIT_NOT_AVAILABLE',
  'OTHER_FIRM',
  'ESTIMATE_DECIDED',
  'ESTIMATE_CONVERTED',
  'SCHEDULE_CANCELED',
  'NOT_SUPPORTED_YET',
]);
export type BillingErrorCode = z.infer<typeof BillingErrorCode>;

/** Messages for `errorMessage(error, BILLING_ERRORS)`. */
export const BILLING_ERRORS: Readonly<Record<BillingErrorCode, string>> = {
  NOT_FOUND: 'This record is no longer available. Refresh to see the latest.',
  FORBIDDEN: 'Your role does not allow this.',
  FIRM_NOT_BILLABLE: 'Only active firms can get new billing documents.',
  NOT_A_DRAFT: 'Only drafts can be changed. This one was already issued.',
  ALREADY_VOIDED: 'This was already voided.',
  HAS_MONEY: 'Payments or credits are recorded on it, so it cannot be voided.',
  NOT_ISSUED: 'Send it first.',
  OVER_BALANCE: 'That is more than the invoice still owes.',
  OVER_REFUNDABLE: 'That is more than can still be refunded.',
  OVER_CREDIT: 'That is more than the credit note has left.',
  CREDIT_NOT_AVAILABLE: 'This credit note cannot be used now.',
  OTHER_FIRM: 'The credit note and the invoice belong to different firms.',
  ESTIMATE_DECIDED: 'This estimate was already decided.',
  ESTIMATE_CONVERTED: 'This estimate was already converted to an invoice.',
  SCHEDULE_CANCELED: 'This schedule was canceled.',
  NOT_SUPPORTED_YET: 'This option cannot be saved yet.',
};
