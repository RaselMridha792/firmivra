import { ApiRequestError } from '@firmivra/types';
import { mockDelay, mocked, mockedEmpty } from '../lib/mock';
import { mockBusiness } from './me';

/**
 * Super Admin Billing (S01; docs/mockups/super-admin/billing/source/ and its developer docx):
 * invoices, recurring schedules, estimates, payments and refunds, credit notes and the platform
 * Billing Settings, across every firm. There is no Billing API or contract yet, so the types and
 * the client live here and pages call `adminBilling.<fn>()` through useApiQuery / useApiMutation.
 *
 * The mock plays the server: totals, balances and statuses are recalculated here from the lines,
 * payments, refunds and credits (never taken from the form), numbers are unique, and every change
 * appends to the record's history (the audit trail). Money is in integer cents, dates are
 * `YYYY-MM-DD`, times ISO. Synthetic data only.
 *
 * Switches: NEXT_PUBLIC_API_MOCK=adminBilling (or all). NEXT_PUBLIC_API_MOCK_EMPTY=adminBilling
 * keeps the firms, clients and settings but starts with no invoices, payments, estimates, credit
 * notes or schedules. Outside mock mode every call fails like an unreachable API.
 */
const MODULE = 'adminBilling';
/** The Super Admin signed in to the mock console (mocks/admin-auth.ts). */
const ACTOR = 'Morgan Admin';

/** No Super Admin billing API yet: outside mock mode every call fails like an unreachable API. */
async function ready() {
  await mockDelay();
  if (!mocked(MODULE)) throw new TypeError('Failed to fetch');
}

// ---------------------------------------------------------------------------------------------
// Enumerations
// ---------------------------------------------------------------------------------------------

export const CURRENCIES = ['USD', 'CAD', 'EUR', 'GBP'] as const;
export type Currency = (typeof CURRENCIES)[number];

export const PAYMENT_TERMS = [
  'DUE_ON_RECEIPT',
  'NET_7',
  'NET_15',
  'NET_30',
  'NET_45',
  'NET_60',
] as const;
export type PaymentTerms = (typeof PAYMENT_TERMS)[number];
/** Days from the invoice date to the due date for each payment term. */
export const PAYMENT_TERM_DAYS: Record<PaymentTerms, number> = {
  DUE_ON_RECEIPT: 0,
  NET_7: 7,
  NET_15: 15,
  NET_30: 30,
  NET_45: 45,
  NET_60: 60,
};

export const INVOICE_TYPES = ['STANDARD', 'DEPOSIT', 'PROGRESS', 'FINAL', 'ADJUSTMENT'] as const;
export type InvoiceType = (typeof INVOICE_TYPES)[number];

/** Derived from the invoice's lifecycle and money (docx §8.1, §18); never set by hand. */
export const INVOICE_STATUSES = [
  'DRAFT',
  'PENDING',
  'PARTIALLY_PAID',
  'PAID',
  'OVERDUE',
  'VOIDED',
  'REFUNDED',
  'PARTIALLY_REFUNDED',
] as const;
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];
export type SendStatus = 'NOT_SENT' | 'SENT' | 'FAILED';

export const PAYMENT_METHODS = [
  'CREDIT_CARD',
  'ACH',
  'BANK_TRANSFER',
  'CHECK',
  'CASH',
  'MANUAL',
] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];
export const PAYMENT_STATUSES = [
  'COMPLETED',
  'PENDING',
  'FAILED',
  'REFUNDED',
  'PARTIALLY_REFUNDED',
] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];
/** Where a refund goes: back through the original processor, or paid out another way. */
export const REFUND_METHODS = ['ORIGINAL', 'CHECK', 'BANK_TRANSFER', 'CASH'] as const;
export type RefundMethod = (typeof REFUND_METHODS)[number];

export const ESTIMATE_STATUSES = [
  'DRAFT',
  'SENT',
  'PENDING',
  'APPROVED',
  'DECLINED',
  'EXPIRED',
  'CONVERTED',
] as const;
export type EstimateStatus = (typeof ESTIMATE_STATUSES)[number];
/** The statuses a Super Admin may set on an estimate (Expired and Converted are derived). */
export type EstimateSetStatus = 'DRAFT' | 'SENT' | 'PENDING' | 'APPROVED' | 'DECLINED';
export const ESTIMATE_TEMPLATES = ['STANDARD', 'DETAILED', 'SIMPLE'] as const;
export type EstimateTemplate = (typeof ESTIMATE_TEMPLATES)[number];

export const CREDIT_NOTE_STATUSES = [
  'DRAFT',
  'AVAILABLE',
  'APPLIED',
  'PARTIALLY_APPLIED',
  'REFUNDED',
  'VOIDED',
] as const;
export type CreditNoteStatus = (typeof CREDIT_NOTE_STATUSES)[number];
export const CREDIT_REASONS = [
  'SERVICE_ISSUE',
  'BILLING_ERROR',
  'DUPLICATE_CHARGE',
  'CANCELLATION',
  'PRICE_ADJUSTMENT',
  'GOODWILL',
  'OTHER',
] as const;
export type CreditReason = (typeof CREDIT_REASONS)[number];
/** Line-item credits, or one adjustment amount (docx §14.2). */
export type CreditMethod = 'LINE_ITEMS' | 'ADJUSTMENT';

export const RECURRING_FREQUENCIES = [
  'WEEKLY',
  'MONTHLY',
  'QUARTERLY',
  'SEMIANNUALLY',
  'ANNUALLY',
  'CUSTOM',
] as const;
export type RecurringFrequency = (typeof RECURRING_FREQUENCIES)[number];
export const RECURRING_STATUSES = ['ACTIVE', 'PAUSED', 'CANCELED'] as const;
export type RecurringStatus = (typeof RECURRING_STATUSES)[number];

export const ADMIN_ROLES = ['OWNER', 'ADMIN', 'BILLING', 'SUPPORT'] as const;
export type AdminRole = (typeof ADMIN_ROLES)[number];
/** The capabilities docx §19 asks to control separately. */
export const BILLING_CAPABILITIES = [
  'CREATE_INVOICES',
  'EDIT_INVOICES',
  'SEND_INVOICES',
  'VOID_INVOICES',
  'RECORD_PAYMENTS',
  'ISSUE_REFUNDS',
  'CREATE_CREDIT_NOTES',
  'APPLY_CREDITS',
  'VOID_CREDIT_NOTES',
  'MANAGE_RECURRING',
  'EDIT_SETTINGS',
  'VIEW_CROSS_FIRM',
] as const;
export type BillingCapability = (typeof BILLING_CAPABILITIES)[number];
export const TEMPLATE_KINDS = [
  'INVOICE',
  'ESTIMATE',
  'RECEIPT',
  'CREDIT_NOTE',
  'PAYMENT_REMINDER',
  'REFUND_CONFIRMATION',
] as const;
export type TemplateKind = (typeof TEMPLATE_KINDS)[number];
export const DOCUMENT_KINDS = [
  'INVOICE',
  'ESTIMATE',
  'CREDIT_NOTE',
  'RECEIPT',
  'REFUND',
  'ATTACHMENT',
] as const;
export type BillingDocumentKind = (typeof DOCUMENT_KINDS)[number];

// ---------------------------------------------------------------------------------------------
// Records
// ---------------------------------------------------------------------------------------------

export interface BillingAddress {
  line1: string;
  line2: string;
  city: string;
  state: string;
  zip: string;
}

export type BillingFirmStatus = 'ACTIVE' | 'PENDING_SETUP' | 'SUSPENDED';
/** A firm that bills its clients. Its details brand every customer-facing document (docx §7.5). */
export interface BillingFirm {
  id: string;
  slug: string;
  name: string;
  /** Only ACTIVE firms can get new documents; the others keep their history (docx §20). */
  status: BillingFirmStatus;
  email: string;
  phone: string;
  address: BillingAddress;
  currency: Currency;
  paymentTerms: PaymentTerms;
  defaultTaxRateId: string | null;
  invoiceFooter: string;
  paymentInstructions: string;
  /** The firm's estimate terms; null falls back to the platform default in Billing Settings. */
  estimateTerms: string | null;
  /** Payment and tax setup done: sending a document needs it (docx §7.6). */
  setupComplete: boolean;
}

/** A firm's client ("Client / Event", "Customer"): who an invoice, estimate or credit is for. */
export interface BillingClient {
  id: string;
  firmId: string;
  /** "Client #1001". */
  number: number;
  name: string;
  contactName: string;
  email: string;
  phone: string;
  address: BillingAddress;
  /** The invoice's "Ship To" (an office or event location); null when it is the billing address. */
  shipTo: { label: string; address: BillingAddress } | null;
}

/** A Super Admin team member (Created By, Recorded By, Assign To). */
export interface BillingAdmin {
  id: string;
  name: string;
  email: string;
  role: AdminRole;
}

/** A catalog service for the "Item / Service" pickers. */
export interface BillingItem {
  id: string;
  name: string;
  description: string;
  unitPriceCents: number;
}

/** One history entry: who did what, when, and the amount when it moved money. */
export interface BillingEvent {
  id: string;
  at: string;
  actor: string;
  action: string;
  detail: string;
  amountCents: number | null;
}

export interface InvoiceLine {
  id: string;
  description: string;
  quantity: number;
  rateCents: number;
  taxRateId: string | null;
  /** The tax rate when the line was saved, so a later rate change leaves issued invoices alone. */
  taxPercent: number;
  amountCents: number;
  taxCents: number;
}

export interface BillingAttachment {
  id: string;
  name: string;
  contentType: string;
  sizeBytes: number;
  uploadedAt: string;
}

export interface BillingInvoice {
  id: string;
  number: string;
  firmId: string;
  firmName: string;
  clientId: string;
  clientName: string;
  type: InvoiceType;
  currency: Currency;
  paymentTerms: PaymentTerms;
  issueDate: string;
  dueDate: string;
  reference: string;
  notes: string;
  lines: InvoiceLine[];
  subtotalCents: number;
  discountCents: number;
  taxCents: number;
  totalCents: number;
  /** Completed payments, before refunds. */
  paidCents: number;
  refundedCents: number;
  creditedCents: number;
  /** What the client still owes: total − paid − credits (refunds don't reopen it). */
  balanceCents: number;
  status: InvoiceStatus;
  allowOnlinePayment: boolean;
  recurringScheduleId: string | null;
  estimateId: string | null;
  estimateNumber: string | null;
  attachments: BillingAttachment[];
  /** When it stopped being a draft. */
  issuedAt: string | null;
  sentAt: string | null;
  sendStatus: SendStatus;
  voidedAt: string | null;
  voidReason: string | null;
  createdAt: string;
  updatedAt: string;
  createdBy: string;
  history: BillingEvent[];
}

/** A credit note applied to an invoice. */
export interface InvoiceCredit {
  id: string;
  creditNoteId: string;
  creditNoteNumber: string;
  amountCents: number;
  at: string;
  by: string;
}

/** A downloadable file next to a record (Related Documents). */
export interface BillingDocument {
  id: string;
  kind: BillingDocumentKind;
  /** The invoice, estimate, credit note, payment, refund or attachment it comes from. */
  refId: string;
  fileName: string;
  /** "Generated", "Converted to Invoice", "Uploaded"... */
  description: string;
  date: string | null;
}

/** A file to save: `saveFile()` in billing/_components hands it to the browser. */
export interface BillingFile {
  fileName: string;
  blob: Blob;
}

/** Invoice Details: the invoice with its firm, client, payments, credits and documents. */
export interface InvoiceDetail extends BillingInvoice {
  firm: BillingFirm;
  client: BillingClient;
  payments: BillingPayment[];
  credits: InvoiceCredit[];
  documents: BillingDocument[];
  schedule: { id: string; template: string } | null;
}

export interface BillingRefund {
  id: string;
  paymentId: string;
  amountCents: number;
  type: 'FULL' | 'PARTIAL';
  reason: string;
  notes: string;
  method: RefundMethod;
  at: string;
  by: string;
  /** The refund confirmation's number ("RF-0002"). */
  confirmation: string;
}

export interface BillingPayment {
  id: string;
  /** The receipt number ("RCPT-0007"). */
  number: string;
  invoiceId: string;
  invoiceNumber: string;
  firmId: string;
  firmName: string;
  clientId: string;
  clientName: string;
  currency: Currency;
  amountCents: number;
  paidOn: string;
  method: PaymentMethod;
  /** Reference / transaction id. */
  reference: string;
  processor: string;
  status: PaymentStatus;
  refundedCents: number;
  /** What may still be refunded (0 unless Completed or Partially Refunded). */
  refundableCents: number;
  refunds: BillingRefund[];
  notes: string;
  failureReason: string | null;
  recordedBy: string;
  recordedAt: string;
  receiptSentAt: string | null;
}

export interface EstimateLine {
  id: string;
  description: string;
  quantity: number;
  rateCents: number;
  amountCents: number;
}

export interface BillingEstimate {
  id: string;
  number: string;
  firmId: string;
  firmName: string;
  clientId: string;
  clientName: string;
  contactName: string;
  email: string;
  phone: string;
  currency: Currency;
  issueDate: string;
  expirationDate: string;
  reference: string;
  lines: EstimateLine[];
  subtotalCents: number;
  discountCents: number;
  taxRateId: string | null;
  taxPercent: number;
  taxCents: number;
  totalCents: number;
  notes: string;
  terms: string;
  status: EstimateStatus;
  sendNotification: boolean;
  template: EstimateTemplate;
  assignedToId: string | null;
  assignedToName: string | null;
  convertedInvoiceId: string | null;
  convertedInvoiceNumber: string | null;
  sentAt: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  history: BillingEvent[];
}

export interface CreditLine {
  id: string;
  /** The catalog item's name, or free text. */
  item: string;
  description: string;
  quantity: number;
  unitPriceCents: number;
  taxRateId: string | null;
  taxPercent: number;
  amountCents: number;
  taxCents: number;
}

export interface CreditApplication {
  id: string;
  invoiceId: string;
  invoiceNumber: string;
  amountCents: number;
  at: string;
  by: string;
}

export interface CreditRefund {
  id: string;
  amountCents: number;
  reason: string;
  method: RefundMethod;
  at: string;
  by: string;
}

export interface BillingCreditNote {
  id: string;
  number: string;
  firmId: string;
  firmName: string;
  clientId: string;
  clientName: string;
  invoiceId: string | null;
  invoiceNumber: string | null;
  currency: Currency;
  date: string;
  reason: CreditReason;
  method: CreditMethod;
  lines: CreditLine[];
  adjustmentCents: number;
  subtotalCents: number;
  taxCents: number;
  /** The original amount. */
  totalCents: number;
  appliedCents: number;
  refundedCents: number;
  /** original = applied + refunded + remaining (docx §18). */
  remainingCents: number;
  keepAvailable: boolean;
  internalNote: string;
  customerNote: string;
  status: CreditNoteStatus;
  issuedAt: string | null;
  sentAt: string | null;
  voidedAt: string | null;
  voidReason: string | null;
  applications: CreditApplication[];
  refunds: CreditRefund[];
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  history: BillingEvent[];
}

export interface BillingRecurring {
  id: string;
  firmId: string;
  firmName: string;
  clientId: string;
  clientName: string;
  clientNumber: number;
  /** "Premium Plan". */
  template: string;
  /** "Monthly subscription". */
  description: string;
  frequency: RecurringFrequency;
  /** Days between invoices when the frequency is CUSTOM. */
  customIntervalDays: number | null;
  amountCents: number;
  currency: Currency;
  startDate: string;
  nextInvoiceDate: string;
  endDate: string | null;
  autoSend: boolean;
  allowOnlinePayment: boolean;
  status: RecurringStatus;
  /** Every invoice this schedule generated (docx §9.2). */
  invoiceIds: string[];
  createdAt: string;
  updatedAt: string;
  history: BillingEvent[];
}

export interface TaxRate {
  id: string;
  name: string;
  ratePercent: number;
}
/** A service or late fee: `amount` is cents when FLAT, a percent when PERCENT. */
export interface FeeRule {
  enabled: boolean;
  type: 'FLAT' | 'PERCENT';
  amount: number;
}
/** `days`: before the due or expiry date, or after it for overdue and failed payments. */
export interface ReminderRule {
  enabled: boolean;
  days: number;
}
export interface NumberingRule {
  /** "INV-{####}", "CN-{YYYY}-{####}": {YYYY} is the document's year, # the zero-padded counter. */
  format: string;
  next: number;
}
export interface DocumentTemplate {
  name: string;
  subject: string;
  body: string;
  /** Firms may replace it with their own. */
  firmOverride: boolean;
}

/** Platform Billing Settings (docx §15): defaults for every firm, never one firm's branding. */
export interface BillingSettings {
  general: {
    currency: Currency;
    language: string;
    invoiceTerms: PaymentTerms;
    estimateValidityDays: number;
    timeZone: string;
    dateFormat: 'MM/DD/YYYY' | 'DD/MM/YYYY' | 'YYYY-MM-DD';
    decimalPrecision: number;
    rounding: 'STANDARD' | 'UP' | 'DOWN';
    enableCreditNotes: boolean;
    enableEstimates: boolean;
    enablePartialPayments: boolean;
    enableLateFees: boolean;
    requirePurchaseOrder: boolean;
    requireTax: boolean;
    termsAndConditions: string;
    footerNote: string;
    platformNotes: string;
  };
  invoices: {
    defaultInvoiceType: InvoiceType;
    defaultTaxRateId: string | null;
    discountBeforeTax: boolean;
    allowAttachments: boolean;
    maxAttachmentMb: number;
    attachmentTypes: string[];
    onlinePaymentDefault: boolean;
    sendNowDefault: boolean;
    estimateTemplate: EstimateTemplate;
    /** Estimate to invoice: copy notes and terms too, or the lines only. */
    conversion: 'COPY_ALL' | 'LINES_ONLY';
    allowDuplicateConversion: boolean;
  };
  payments: {
    methods: PaymentMethod[];
    allowOverpayments: boolean;
    autoPay: boolean;
    sendReceipts: boolean;
    requireRefundReason: boolean;
    processor: 'STRIPE' | 'MANUAL_ONLY';
  };
  taxes: {
    mode: 'EXCLUSIVE' | 'INCLUSIVE';
    rates: TaxRate[];
    serviceFee: FeeRule;
    lateFee: FeeRule & { graceDays: number };
    firmsMayOverride: boolean;
  };
  reminders: {
    invoiceDue: ReminderRule;
    overdue: ReminderRule & { repeatEveryDays: number; maxReminders: number };
    estimateExpiring: ReminderRule;
    failedPayment: ReminderRule;
    firmsMayOverride: boolean;
  };
  templates: Record<TemplateKind, DocumentTemplate>;
  numbering: {
    invoice: NumberingRule;
    estimate: NumberingRule;
    creditNote: NumberingRule;
    resetRule: 'NEVER' | 'YEARLY';
    /** Numbers are unique per firm instead of across the platform. */
    perFirm: boolean;
  };
  permissions: Record<BillingCapability, AdminRole[]>;
  updatedAt: string;
  updatedBy: string;
}

// ---------------------------------------------------------------------------------------------
// Inputs, queries and results
// ---------------------------------------------------------------------------------------------

/** One page of a list. */
export interface BillingPage<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
}

/** Shared list filters: `from`/`to` (YYYY-MM-DD) filter each list's own date column. */
export interface PageQuery<S extends string = string> {
  search?: string;
  firmId?: string;
  from?: string;
  to?: string;
  sort?: S;
  descending?: boolean;
  /** 1-based. */
  page?: number;
  /** Default 10, at most 100. */
  pageSize?: number;
}

export type InvoiceSort =
  'number' | 'client' | 'firm' | 'issueDate' | 'dueDate' | 'amount' | 'status';
export interface InvoiceQuery extends PageQuery<InvoiceSort> {
  status?: InvoiceStatus;
  clientId?: string;
  type?: InvoiceType;
  dueFrom?: string;
  dueTo?: string;
  minCents?: number;
  maxCents?: number;
}
export type PaymentSort = 'paidOn' | 'client' | 'firm' | 'invoice' | 'amount' | 'method' | 'status';
export interface PaymentQuery extends PageQuery<PaymentSort> {
  status?: PaymentStatus;
  method?: PaymentMethod;
  invoiceId?: string;
  clientId?: string;
}
export type EstimateSort =
  'number' | 'client' | 'firm' | 'issueDate' | 'expirationDate' | 'amount' | 'status';
export interface EstimateQuery extends PageQuery<EstimateSort> {
  status?: EstimateStatus;
  clientId?: string;
}
export type CreditNoteSort =
  'number' | 'client' | 'invoice' | 'date' | 'amount' | 'applied' | 'remaining' | 'status';
export interface CreditNoteQuery extends PageQuery<CreditNoteSort> {
  status?: CreditNoteStatus;
  clientId?: string;
  invoiceId?: string;
}
export type RecurringSort =
  'client' | 'template' | 'frequency' | 'amount' | 'nextInvoiceDate' | 'status';
export interface RecurringQuery extends PageQuery<RecurringSort> {
  status?: RecurringStatus;
  clientId?: string;
}

/** The Billing dashboard's cards, from the same filtered invoices as the table (docx §6.2). */
export interface InvoiceSummary {
  /** Issued invoices (not drafts, not voided). */
  invoicedCents: number;
  invoicedCount: number;
  /** Percent change against the previous period of the same length; null without one. */
  invoicedTrend: number | null;
  /** Money received, net of refunds. */
  paidCents: number;
  paidCount: number;
  paidTrend: number | null;
  /** Open balances: pending, partially paid and overdue invoices. */
  outstandingCents: number;
  outstandingCount: number;
  overdueCents: number;
  overdueCount: number;
}
export interface PaymentSummary {
  totalCents: number;
  totalCount: number;
  totalTrend: number | null;
  /** Completed payments in the current calendar month, against last month. */
  monthCents: number;
  monthCount: number;
  monthTrend: number | null;
  refundsCents: number;
  refundsCount: number;
  averageCents: number;
}
export interface EstimateSummary {
  totalCents: number;
  totalCount: number;
  approvedCents: number;
  approvedCount: number;
  /** Sent and Pending. */
  pendingCents: number;
  pendingCount: number;
  declinedCents: number;
  declinedCount: number;
}
export interface CreditNoteSummary {
  count: number;
  /** Issued (not draft, not voided). */
  issuedCents: number;
  appliedCents: number;
  /** Still available on Available and Partially Applied notes. */
  availableCents: number;
  refundedCents: number;
}
export interface RecurringCounts {
  all: number;
  active: number;
  paused: number;
  canceled: number;
}

export interface SaveInvoiceLine {
  description: string;
  quantity: number;
  rateCents: number;
  taxRateId: string | null;
}
/** A file picked in the form; `file` is kept so the download gives it back. */
export interface NewAttachment {
  name: string;
  contentType: string;
  sizeBytes: number;
  file: Blob | null;
}
/** Create Invoice and Edit Invoice (docx §7). */
export interface SaveInvoice {
  firmId: string;
  clientId: string;
  number: string;
  issueDate: string;
  dueDate: string;
  type: InvoiceType;
  currency: Currency;
  paymentTerms: PaymentTerms;
  reference: string;
  notes: string;
  lines: SaveInvoiceLine[];
  discountCents: number;
  allowOnlinePayment: boolean;
  /** Save & Send: issue it and send it to the client now. */
  send: boolean;
  /** The estimate this invoice converts (sets the estimate to Converted). */
  estimateId: string | null;
  attachments: NewAttachment[];
  /** Edit mode: the existing attachments to keep. */
  keepAttachmentIds: string[];
}

export interface RecordPaymentInput {
  invoiceId: string;
  amountCents: number;
  paidOn: string;
  method: PaymentMethod;
  reference: string;
  notes: string;
  sendReceipt: boolean;
}
export interface RefundInput {
  paymentId: string;
  type: 'FULL' | 'PARTIAL';
  amountCents: number;
  reason: string;
  notes: string;
  method: RefundMethod;
  /** The confirmation checkbox (docx §17.2). */
  confirmed: boolean;
}
export interface ApplyCreditInput {
  invoiceId: string;
  creditNoteId: string;
  amountCents: number;
  confirmed: boolean;
}

export interface SaveEstimateLine {
  description: string;
  quantity: number;
  rateCents: number;
}
/** Create Estimate and Edit Estimate (docx §11). The firm is the client's firm. */
export interface SaveEstimate {
  clientId: string;
  contactName: string;
  email: string;
  phone: string;
  number: string;
  issueDate: string;
  expirationDate: string;
  reference: string;
  lines: SaveEstimateLine[];
  discountCents: number;
  taxRateId: string | null;
  notes: string;
  terms: string;
  status: EstimateSetStatus;
  sendNotification: boolean;
  template: EstimateTemplate;
  assignedToId: string | null;
  /** Send Estimate: mark it Sent and email it when `sendNotification`. */
  send: boolean;
}

export interface SaveCreditLine {
  item: string;
  description: string;
  quantity: number;
  unitPriceCents: number;
  taxRateId: string | null;
}
/** Create Credit Note (docx §14). The firm is the customer's firm. */
export interface SaveCreditNote {
  clientId: string;
  invoiceId: string | null;
  date: string;
  reason: CreditReason;
  method: CreditMethod;
  lines: SaveCreditLine[];
  adjustmentCents: number;
  keepAvailable: boolean;
  internalNote: string;
  customerNote: string;
  /** Issue Credit Note; false saves a draft. */
  issue: boolean;
}

/** The recurring drawer (docx §9.2). The firm is the client's firm. */
export interface SaveRecurring {
  clientId: string;
  template: string;
  description: string;
  frequency: RecurringFrequency;
  customIntervalDays: number | null;
  amountCents: number;
  startDate: string;
  nextInvoiceDate: string;
  endDate: string | null;
  autoSend: boolean;
  allowOnlinePayment: boolean;
  status: RecurringStatus;
  /** Create Invoice's "Set up as recurring invoice": link the invoice it started from. */
  sourceInvoiceId: string | null;
}

/** Field messages for a form: keyed by field (or settings path), plus per-line messages. */
export interface LineErrors {
  description?: string;
  quantity?: string;
  rate?: string;
}
export interface FormErrors {
  fields: Partial<Record<string, string>>;
  lines: LineErrors[];
}
/** True when a FormErrors has any message. */
export function hasErrors(errors: FormErrors): boolean {
  return (
    Object.values(errors.fields).some(Boolean) ||
    errors.lines.some((line) => Boolean(line.description || line.quantity || line.rate))
  );
}
const firstMessage = (errors: FormErrors): string =>
  Object.values(errors.fields).find(Boolean) ??
  errors.lines
    .flatMap((line) => [line.description, line.quantity, line.rate])
    .find((text): text is string => Boolean(text)) ??
  'Some details need fixing';

// ---------------------------------------------------------------------------------------------
// Pure rules (the "server" uses them; forms use them for live totals and field messages)
// ---------------------------------------------------------------------------------------------

const pad = (value: number, width = 2) => String(value).padStart(width, '0');
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const isDate = (value: string) =>
  DATE.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));
function todayIso(): string {
  const now = new Date();
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}
function addDays(iso: string, days: number): string {
  const [y = 1970, m = 1, d = 1] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}
function addMonths(iso: string, months: number): string {
  const [y = 1970, m = 1, d = 1] = iso.split('-').map(Number);
  const last = new Date(Date.UTC(y, m - 1 + months + 1, 0)).getUTCDate();
  return new Date(Date.UTC(y, m - 1 + months, Math.min(d, last))).toISOString().slice(0, 10);
}
const daysBetween = (from: string, to: string) =>
  Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
const nowIso = () => new Date().toISOString();
const sum = (values: number[]) => values.reduce((total, value) => total + value, 0);
const money = (cents: number, currency: Currency = 'USD') =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(cents / 100);

/** The next invoice date after `date` for a schedule's frequency. */
export function nextOccurrence(
  date: string,
  frequency: RecurringFrequency,
  customIntervalDays: number | null,
): string {
  switch (frequency) {
    case 'WEEKLY':
      return addDays(date, 7);
    case 'MONTHLY':
      return addMonths(date, 1);
    case 'QUARTERLY':
      return addMonths(date, 3);
    case 'SEMIANNUALLY':
      return addMonths(date, 6);
    case 'ANNUALLY':
      return addMonths(date, 12);
    case 'CUSTOM':
      return addDays(date, Math.max(1, customIntervalDays ?? 30));
  }
}

export interface TotalsLine {
  quantity: number;
  rateCents: number;
  taxPercent: number;
}
export interface Totals {
  lines: { amountCents: number; taxCents: number }[];
  subtotalCents: number;
  discountCents: number;
  taxCents: number;
  totalCents: number;
}
/**
 * Line amounts, subtotal, discount, tax and total. The discount comes off before tax: each line's
 * tax is on its share of the discounted subtotal. Used live by the forms and again on save.
 */
export function computeTotals(lines: readonly TotalsLine[], discountCents = 0): Totals {
  const amounts = lines.map((line) =>
    Math.max(0, Math.round((Number.isFinite(line.quantity) ? line.quantity : 0) * line.rateCents)),
  );
  const subtotalCents = sum(amounts);
  const discount = Math.min(Math.max(0, Math.round(discountCents)), subtotalCents);
  const factor = subtotalCents > 0 ? (subtotalCents - discount) / subtotalCents : 0;
  const rows = lines.map((line, index) => {
    const amountCents = amounts[index] ?? 0;
    return {
      amountCents,
      taxCents: Math.round((amountCents * factor * Math.max(0, line.taxPercent)) / 100),
    };
  });
  const taxCents = sum(rows.map((row) => row.taxCents));
  return {
    lines: rows,
    subtotalCents,
    discountCents: discount,
    taxCents,
    totalCents: subtotalCents - discount + taxCents,
  };
}

const MAX_CENTS = 100_000_000_00;
const lineErrors = (
  lines: readonly { description: string; quantity: number; rate: number }[],
): LineErrors[] =>
  lines.map((line) => ({
    description: line.description.trim()
      ? line.description.length > 200
        ? 'Use 200 characters or fewer'
        : undefined
      : 'Enter a description',
    quantity:
      Number.isFinite(line.quantity) && line.quantity > 0 && line.quantity <= 100_000
        ? undefined
        : 'Enter a quantity above 0',
    rate:
      Number.isInteger(line.rate) && line.rate >= 0 && line.rate <= MAX_CENTS
        ? undefined
        : 'Enter a rate of 0 or more',
  }));

/** Create / Edit Invoice field messages (docx §7.6); uniqueness is checked on save. */
export function invoiceErrors(body: SaveInvoice): FormErrors {
  const fields: Partial<Record<string, string>> = {};
  if (!body.firmId) fields['firmId'] = 'Select a firm';
  if (!body.clientId) fields['clientId'] = 'Select a client';
  if (!body.number.trim()) fields['number'] = 'Enter an invoice number';
  else if (body.number.trim().length > 40) fields['number'] = 'Use 40 characters or fewer';
  if (!isDate(body.issueDate)) fields['issueDate'] = 'Enter the invoice date';
  if (!isDate(body.dueDate)) fields['dueDate'] = 'Enter the due date';
  else if (isDate(body.issueDate) && body.dueDate < body.issueDate)
    fields['dueDate'] = 'The due date cannot be before the invoice date';
  if (body.reference.length > 120) fields['reference'] = 'Use 120 characters or fewer';
  if (body.notes.length > 1000) fields['notes'] = 'Use 1000 characters or fewer';
  if (body.lines.length === 0) fields['lines'] = 'Add at least one line item';
  if (!Number.isInteger(body.discountCents) || body.discountCents < 0)
    fields['discountCents'] = 'Enter a discount of 0 or more';
  return {
    fields,
    lines: lineErrors(body.lines.map((line) => ({ ...line, rate: line.rateCents }))),
  };
}

/** Create / Edit Estimate field messages (docx §11). */
export function estimateErrors(body: SaveEstimate): FormErrors {
  const fields: Partial<Record<string, string>> = {};
  if (!body.clientId) fields['clientId'] = 'Select a client';
  if (!body.number.trim()) fields['number'] = 'Enter an estimate number';
  if (!isDate(body.issueDate)) fields['issueDate'] = 'Enter the issue date';
  if (!isDate(body.expirationDate)) fields['expirationDate'] = 'Enter the expiration date';
  else if (isDate(body.issueDate) && body.expirationDate < body.issueDate)
    fields['expirationDate'] = 'The expiration date cannot be before the issue date';
  if (body.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email.trim()))
    fields['email'] = 'Enter a valid email';
  if (body.lines.length === 0) fields['lines'] = 'Add at least one line item';
  if (!Number.isInteger(body.discountCents) || body.discountCents < 0)
    fields['discountCents'] = 'Enter a discount of 0 or more';
  if (body.terms.length > 2000) fields['terms'] = 'Use 2000 characters or fewer';
  if (body.notes.length > 1000) fields['notes'] = 'Use 1000 characters or fewer';
  return {
    fields,
    lines: lineErrors(body.lines.map((line) => ({ ...line, rate: line.rateCents }))),
  };
}

/** Create Credit Note field messages (docx §14). */
export function creditNoteErrors(body: SaveCreditNote): FormErrors {
  const fields: Partial<Record<string, string>> = {};
  if (!body.clientId) fields['clientId'] = 'Select a customer';
  if (!isDate(body.date)) fields['date'] = 'Enter the credit note date';
  if (!CREDIT_REASONS.includes(body.reason)) fields['reason'] = 'Select a reason';
  if (body.method === 'ADJUSTMENT') {
    if (!Number.isInteger(body.adjustmentCents) || body.adjustmentCents <= 0)
      fields['adjustmentCents'] = 'Enter a credit amount above 0';
  } else if (body.lines.length === 0) fields['lines'] = 'Add at least one line item';
  if (body.internalNote.length > 1000) fields['internalNote'] = 'Use 1000 characters or fewer';
  if (body.customerNote.length > 1000) fields['customerNote'] = 'Use 1000 characters or fewer';
  return {
    fields,
    lines:
      body.method === 'LINE_ITEMS'
        ? lineErrors(
            body.lines.map((line) => ({
              description: line.description || line.item,
              quantity: line.quantity,
              rate: line.unitPriceCents,
            })),
          )
        : [],
  };
}

/** Recurring drawer field messages (docx §9.2). */
export function recurringErrors(body: SaveRecurring): FormErrors {
  const fields: Partial<Record<string, string>> = {};
  if (!body.clientId) fields['clientId'] = 'Select a client';
  if (!body.template.trim()) fields['template'] = 'Enter a template or description';
  else if (body.template.length > 120) fields['template'] = 'Use 120 characters or fewer';
  if (body.description.length > 300) fields['description'] = 'Use 300 characters or fewer';
  if (!RECURRING_FREQUENCIES.includes(body.frequency)) fields['frequency'] = 'Select a frequency';
  if (
    body.frequency === 'CUSTOM' &&
    !(
      body.customIntervalDays !== null &&
      Number.isInteger(body.customIntervalDays) &&
      body.customIntervalDays >= 1 &&
      body.customIntervalDays <= 365
    )
  )
    fields['customIntervalDays'] = 'Enter 1 to 365 days';
  if (!Number.isInteger(body.amountCents) || body.amountCents <= 0)
    fields['amountCents'] = 'Enter an amount above 0';
  if (!isDate(body.startDate)) fields['startDate'] = 'Enter the start date';
  if (!isDate(body.nextInvoiceDate)) fields['nextInvoiceDate'] = 'Enter the next invoice date';
  else if (isDate(body.startDate) && body.nextInvoiceDate < body.startDate)
    fields['nextInvoiceDate'] = 'The next invoice date cannot be before the start date';
  if (body.endDate !== null && body.endDate !== '') {
    if (!isDate(body.endDate)) fields['endDate'] = 'Enter a valid end date';
    else if (isDate(body.startDate) && body.endDate < body.startDate)
      fields['endDate'] = 'The end date cannot be before the start date';
  }
  return { fields, lines: [] };
}

/** Billing Settings field messages, keyed by path ("general.estimateValidityDays"). */
export function settingsErrors(next: BillingSettings): FormErrors {
  const fields: Partial<Record<string, string>> = {};
  const { general, invoices, payments, taxes, reminders, numbering, templates } = next;
  if (!(general.estimateValidityDays >= 1 && general.estimateValidityDays <= 365))
    fields['general.estimateValidityDays'] = 'Enter 1 to 365 days';
  if (![0, 2, 3].includes(general.decimalPrecision))
    fields['general.decimalPrecision'] = 'Choose 0, 2 or 3 decimal places';
  if (general.termsAndConditions.length > 1000)
    fields['general.termsAndConditions'] = 'Use 1000 characters or fewer';
  if (general.footerNote.length > 1000)
    fields['general.footerNote'] = 'Use 1000 characters or fewer';
  if (general.platformNotes.length > 1000)
    fields['general.platformNotes'] = 'Use 1000 characters or fewer';
  if (!(invoices.maxAttachmentMb >= 1 && invoices.maxAttachmentMb <= 25))
    fields['invoices.maxAttachmentMb'] = 'Enter 1 to 25 MB';
  if (payments.methods.length === 0)
    fields['payments.methods'] = 'Keep at least one payment method';
  taxes.rates.forEach((rate, index) => {
    if (!rate.name.trim()) fields[`taxes.rates.${index}.name`] = 'Name the tax rate';
    if (!(rate.ratePercent >= 0 && rate.ratePercent <= 100))
      fields[`taxes.rates.${index}.ratePercent`] = 'Enter 0 to 100';
  });
  for (const [key, fee] of [
    ['serviceFee', taxes.serviceFee],
    ['lateFee', taxes.lateFee],
  ] as const) {
    if (fee.amount < 0 || (fee.type === 'PERCENT' && fee.amount > 100))
      fields[`taxes.${key}.amount`] = fee.type === 'PERCENT' ? 'Enter 0 to 100' : 'Enter 0 or more';
  }
  if (!(taxes.lateFee.graceDays >= 0 && taxes.lateFee.graceDays <= 90))
    fields['taxes.lateFee.graceDays'] = 'Enter 0 to 90 days';
  for (const [key, rule] of Object.entries(reminders)) {
    if (typeof rule === 'object' && !(rule.days >= 0 && rule.days <= 90))
      fields[`reminders.${key}.days`] = 'Enter 0 to 90 days';
  }
  for (const key of ['invoice', 'estimate', 'creditNote'] as const) {
    const rule = numbering[key];
    if (!/\{#+\}/.test(rule.format) || rule.format.length > 30)
      fields[`numbering.${key}.format`] = 'Include {####} and use 30 characters or fewer';
    if (!(Number.isInteger(rule.next) && rule.next >= 1))
      fields[`numbering.${key}.next`] = 'Enter a whole number from 1';
  }
  for (const kind of TEMPLATE_KINDS) {
    if (!templates[kind].subject.trim()) fields[`templates.${kind}.subject`] = 'Enter a subject';
  }
  return { fields, lines: [] };
}

/** "INV-{####}" with 13 → "INV-0013"; {YYYY} takes the document date's year. */
export function formatDocumentNumber(format: string, counter: number, date: string): string {
  return format
    .replace(/\{YYYY\}/g, date.slice(0, 4))
    .replace(/\{(#+)\}/g, (_match, hashes: string) => String(counter).padStart(hashes.length, '0'));
}

// ---------------------------------------------------------------------------------------------
// The in-memory store
// ---------------------------------------------------------------------------------------------

interface LineRec {
  id: string;
  description: string;
  quantity: number;
  rateCents: number;
  taxRateId: string | null;
  taxPercent: number;
}
interface InvoiceRec {
  id: string;
  number: string;
  firmId: string;
  clientId: string;
  type: InvoiceType;
  currency: Currency;
  paymentTerms: PaymentTerms;
  issueDate: string;
  dueDate: string;
  reference: string;
  notes: string;
  lines: LineRec[];
  discountCents: number;
  allowOnlinePayment: boolean;
  recurringScheduleId: string | null;
  estimateId: string | null;
  attachments: BillingAttachment[];
  issuedAt: string | null;
  sentAt: string | null;
  sendStatus: SendStatus;
  voidedAt: string | null;
  voidReason: string | null;
  createdAt: string;
  updatedAt: string;
  createdBy: string;
  history: BillingEvent[];
}
interface PaymentRec {
  id: string;
  number: string;
  invoiceId: string;
  amountCents: number;
  paidOn: string;
  method: PaymentMethod;
  reference: string;
  processor: string;
  state: 'COMPLETED' | 'PENDING' | 'FAILED';
  notes: string;
  failureReason: string | null;
  recordedBy: string;
  recordedAt: string;
  receiptSentAt: string | null;
}
interface CreditLineRec {
  id: string;
  item: string;
  description: string;
  quantity: number;
  unitPriceCents: number;
  taxRateId: string | null;
  taxPercent: number;
}
interface CreditNoteRec {
  id: string;
  number: string;
  firmId: string;
  clientId: string;
  invoiceId: string | null;
  date: string;
  reason: CreditReason;
  method: CreditMethod;
  lines: CreditLineRec[];
  adjustmentCents: number;
  keepAvailable: boolean;
  internalNote: string;
  customerNote: string;
  issuedAt: string | null;
  sentAt: string | null;
  voidedAt: string | null;
  voidReason: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  history: BillingEvent[];
}
interface ApplicationRec {
  id: string;
  creditNoteId: string;
  invoiceId: string;
  amountCents: number;
  at: string;
  by: string;
}
interface CreditRefundRec extends CreditRefund {
  creditNoteId: string;
}
interface EstimateLineRec {
  id: string;
  description: string;
  quantity: number;
  rateCents: number;
}
interface EstimateRec {
  id: string;
  number: string;
  firmId: string;
  clientId: string;
  contactName: string;
  email: string;
  phone: string;
  issueDate: string;
  expirationDate: string;
  reference: string;
  lines: EstimateLineRec[];
  discountCents: number;
  taxRateId: string | null;
  taxPercent: number;
  notes: string;
  terms: string;
  state: EstimateSetStatus | 'CONVERTED';
  sendNotification: boolean;
  template: EstimateTemplate;
  assignedToId: string | null;
  convertedInvoiceId: string | null;
  sentAt: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  history: BillingEvent[];
}
interface RecurringRec {
  id: string;
  firmId: string;
  clientId: string;
  template: string;
  description: string;
  frequency: RecurringFrequency;
  customIntervalDays: number | null;
  amountCents: number;
  startDate: string;
  nextInvoiceDate: string;
  endDate: string | null;
  autoSend: boolean;
  allowOnlinePayment: boolean;
  status: RecurringStatus;
  invoiceIds: string[];
  /** The scheduled dates already invoiced: one invoice per occurrence (docx §20). */
  occurrences: string[];
  createdAt: string;
  updatedAt: string;
  history: BillingEvent[];
}
interface Store {
  firms: BillingFirm[];
  clients: BillingClient[];
  admins: BillingAdmin[];
  items: BillingItem[];
  invoices: InvoiceRec[];
  payments: PaymentRec[];
  refunds: BillingRefund[];
  creditNotes: CreditNoteRec[];
  applications: ApplicationRec[];
  creditRefunds: CreditRefundRec[];
  estimates: EstimateRec[];
  recurring: RecurringRec[];
  settings: BillingSettings;
  /** Uploaded attachments' files, so a download returns what was picked. */
  files: Map<string, Blob>;
  seq: number;
}

/** Ids: uuid-shaped, block 0199d1a0-0bXX per kind of record. */
const uid = (block: string, n: number) => `0199d1a0-${block}-7000-8000-${pad(n, 12)}`;
const FIRM_LVP = mockBusiness.id;
const FIRM_NORTHSIDE = '0199b6a3-0000-7000-8000-000000000005';
const FIRM_RIVERSIDE = '0199b6a3-0000-7000-8000-000000000004';
const FIRM_OLD = '0199b6a3-0000-7000-8000-000000000007';
const clientIdOf = (clientNumber: number) => uid('0b01', clientNumber - 1000);
const TAX_SALES = '0199d1a0-0b0b-7000-8000-000000000001';
const TAX_SERVICE = '0199d1a0-0b0b-7000-8000-000000000002';
const TAX_REDUCED = '0199d1a0-0b0b-7000-8000-000000000003';

let store: Store | undefined;
/** The data, built on first use: importing this file runs nothing. */
const db = (): Store => (store ??= seed(mockedEmpty(MODULE)));
const clone = <T>(value: T): T => structuredClone(value);
const fail = (status: number, code: string, message: string) =>
  new ApiRequestError(status, code, message);
const notFound = (what: string) => fail(404, 'NOT_FOUND', `${what} not found`);

function nextId(s: Store, block: string) {
  s.seq += 1;
  return uid(block, s.seq);
}
function event(
  s: Store,
  action: string,
  detail: string,
  amountCents: number | null = null,
  at = nowIso(),
  actor = ACTOR,
): BillingEvent {
  return { id: nextId(s, '0b07'), at, actor, action, detail, amountCents };
}
const byAt = (a: BillingEvent, b: BillingEvent) => a.at.localeCompare(b.at);

const findFirm = (s: Store, id: string) => {
  const firm = s.firms.find((row) => row.id === id);
  if (!firm) throw notFound('Firm');
  return firm;
};
const findClient = (s: Store, id: string) => {
  const client = s.clients.find((row) => row.id === id);
  if (!client) throw notFound('Client');
  return client;
};
const findInvoice = (s: Store, id: string) => {
  const row = s.invoices.find((invoice) => invoice.id === id);
  if (!row) throw notFound('Invoice');
  return row;
};
const findPayment = (s: Store, id: string) => {
  const row = s.payments.find((payment) => payment.id === id);
  if (!row) throw notFound('Payment');
  return row;
};
const findCreditNote = (s: Store, id: string) => {
  const row = s.creditNotes.find((note) => note.id === id);
  if (!row) throw notFound('Credit note');
  return row;
};
const findEstimate = (s: Store, id: string) => {
  const row = s.estimates.find((estimate) => estimate.id === id);
  if (!row) throw notFound('Estimate');
  return row;
};
const findRecurring = (s: Store, id: string) => {
  const row = s.recurring.find((schedule) => schedule.id === id);
  if (!row) throw notFound('Recurring invoice');
  return row;
};
/** New documents only for an active firm (docx §20). */
function activeFirm(s: Store, firmId: string) {
  const firm = findFirm(s, firmId);
  if (firm.status !== 'ACTIVE')
    throw fail(422, 'FIRM_UNAVAILABLE', `${firm.name} is not active, so it cannot bill`);
  return firm;
}
function clientOfFirm(s: Store, firmId: string, clientId: string) {
  const client = findClient(s, clientId);
  if (client.firmId !== firmId)
    throw fail(400, 'VALIDATION_FAILED', 'The client does not belong to this firm');
  return client;
}
const taxPercentOf = (s: Store, taxRateId: string | null) => {
  if (!taxRateId) return 0;
  const rate = s.settings.taxes.rates.find((row) => row.id === taxRateId);
  if (!rate) throw fail(400, 'VALIDATION_FAILED', 'That tax rate no longer exists');
  return rate.ratePercent;
};

/** Which numbering rule a number comes from. */
export type NumberKind = 'invoice' | 'estimate' | 'creditNote';
function numberTaken(
  s: Store,
  kind: NumberKind,
  value: string,
  firmId: string | null,
  exceptId?: string,
): boolean {
  const rows: { id: string; number: string; firmId: string }[] =
    kind === 'invoice' ? s.invoices : kind === 'estimate' ? s.estimates : s.creditNotes;
  const wanted = value.trim().toLowerCase();
  return rows.some(
    (row) =>
      row.id !== exceptId &&
      row.number.toLowerCase() === wanted &&
      (!s.settings.numbering.perFirm || firmId === null || row.firmId === firmId),
  );
}
function suggestNumber(s: Store, kind: NumberKind, date: string, firmId: string | null): string {
  const rule = s.settings.numbering[kind];
  let counter = rule.next;
  let value = formatDocumentNumber(rule.format, counter, date);
  while (numberTaken(s, kind, value, firmId) && counter < rule.next + 10_000) {
    counter += 1;
    value = formatDocumentNumber(rule.format, counter, date);
  }
  return value;
}
/** After a save: the counter moves past the number used, when it is one of its own. */
function consumeNumber(s: Store, kind: NumberKind, value: string, date: string) {
  const rule = s.settings.numbering[kind];
  for (let counter = rule.next; counter < rule.next + 10_000; counter += 1) {
    if (formatDocumentNumber(rule.format, counter, date) === value) {
      rule.next = counter + 1;
      return;
    }
  }
}
function uniqueNumber(
  s: Store,
  kind: NumberKind,
  value: string,
  firmId: string,
  exceptId?: string,
) {
  if (numberTaken(s, kind, value, firmId, exceptId)) {
    const noun = kind === 'invoice' ? 'invoice' : kind === 'estimate' ? 'estimate' : 'credit note';
    throw fail(409, 'DUPLICATE_NUMBER', `Another ${noun} already uses ${value.trim()}`);
  }
}

// ---------------------------------------------------------------------------------------------
// Views: records with their derived money and statuses
// ---------------------------------------------------------------------------------------------

function invoiceMoney(s: Store, rec: InvoiceRec) {
  const totals = computeTotals(rec.lines, rec.discountCents);
  const completed = s.payments.filter(
    (payment) => payment.invoiceId === rec.id && payment.state === 'COMPLETED',
  );
  const paidCents = sum(completed.map((payment) => payment.amountCents));
  const refundedCents = sum(
    s.refunds
      .filter((refund) => completed.some((payment) => payment.id === refund.paymentId))
      .map((refund) => refund.amountCents),
  );
  const creditedCents = sum(
    s.applications.filter((row) => row.invoiceId === rec.id).map((row) => row.amountCents),
  );
  const balanceCents = rec.voidedAt
    ? 0
    : Math.max(0, totals.totalCents - paidCents - creditedCents);
  let status: InvoiceStatus;
  if (rec.voidedAt) status = 'VOIDED';
  else if (!rec.issuedAt) status = 'DRAFT';
  else if (refundedCents > 0)
    status = refundedCents >= paidCents ? 'REFUNDED' : 'PARTIALLY_REFUNDED';
  else if (balanceCents === 0) status = 'PAID';
  else if (rec.dueDate < todayIso()) status = 'OVERDUE';
  else if (paidCents + creditedCents > 0) status = 'PARTIALLY_PAID';
  else status = 'PENDING';
  return { totals, paidCents, refundedCents, creditedCents, balanceCents, status };
}

function invoiceView(s: Store, rec: InvoiceRec): BillingInvoice {
  const m = invoiceMoney(s, rec);
  const estimate = rec.estimateId ? s.estimates.find((row) => row.id === rec.estimateId) : null;
  return clone({
    id: rec.id,
    number: rec.number,
    firmId: rec.firmId,
    firmName: s.firms.find((firm) => firm.id === rec.firmId)?.name ?? '',
    clientId: rec.clientId,
    clientName: s.clients.find((client) => client.id === rec.clientId)?.name ?? '',
    type: rec.type,
    currency: rec.currency,
    paymentTerms: rec.paymentTerms,
    issueDate: rec.issueDate,
    dueDate: rec.dueDate,
    reference: rec.reference,
    notes: rec.notes,
    lines: rec.lines.map((line, index) => ({
      ...line,
      amountCents: m.totals.lines[index]?.amountCents ?? 0,
      taxCents: m.totals.lines[index]?.taxCents ?? 0,
    })),
    subtotalCents: m.totals.subtotalCents,
    discountCents: m.totals.discountCents,
    taxCents: m.totals.taxCents,
    totalCents: m.totals.totalCents,
    paidCents: m.paidCents,
    refundedCents: m.refundedCents,
    creditedCents: m.creditedCents,
    balanceCents: m.balanceCents,
    status: m.status,
    allowOnlinePayment: rec.allowOnlinePayment,
    recurringScheduleId: rec.recurringScheduleId,
    estimateId: rec.estimateId,
    estimateNumber: estimate?.number ?? null,
    attachments: rec.attachments,
    issuedAt: rec.issuedAt,
    sentAt: rec.sentAt,
    sendStatus: rec.sendStatus,
    voidedAt: rec.voidedAt,
    voidReason: rec.voidReason,
    createdAt: rec.createdAt,
    updatedAt: rec.updatedAt,
    createdBy: rec.createdBy,
    history: [...rec.history].sort(byAt),
  });
}

function paymentView(s: Store, rec: PaymentRec): BillingPayment {
  const invoice = s.invoices.find((row) => row.id === rec.invoiceId);
  const client = s.clients.find((row) => row.id === invoice?.clientId);
  const refunds = s.refunds.filter((refund) => refund.paymentId === rec.id);
  const refundedCents = sum(refunds.map((refund) => refund.amountCents));
  const status: PaymentStatus =
    rec.state !== 'COMPLETED'
      ? rec.state
      : refundedCents <= 0
        ? 'COMPLETED'
        : refundedCents >= rec.amountCents
          ? 'REFUNDED'
          : 'PARTIALLY_REFUNDED';
  return clone({
    id: rec.id,
    number: rec.number,
    invoiceId: rec.invoiceId,
    invoiceNumber: invoice?.number ?? '',
    firmId: invoice?.firmId ?? '',
    firmName: s.firms.find((firm) => firm.id === invoice?.firmId)?.name ?? '',
    clientId: client?.id ?? '',
    clientName: client?.name ?? '',
    currency: invoice?.currency ?? 'USD',
    amountCents: rec.amountCents,
    paidOn: rec.paidOn,
    method: rec.method,
    reference: rec.reference,
    processor: rec.processor,
    status,
    refundedCents,
    refundableCents: rec.state === 'COMPLETED' ? rec.amountCents - refundedCents : 0,
    refunds: [...refunds].sort((a, b) => a.at.localeCompare(b.at)),
    notes: rec.notes,
    failureReason: rec.failureReason,
    recordedBy: rec.recordedBy,
    recordedAt: rec.recordedAt,
    receiptSentAt: rec.receiptSentAt,
  });
}

function creditTotals(rec: CreditNoteRec): Totals {
  if (rec.method === 'ADJUSTMENT') {
    const amount = Math.max(0, rec.adjustmentCents);
    return {
      lines: [],
      subtotalCents: amount,
      discountCents: 0,
      taxCents: 0,
      totalCents: amount,
    };
  }
  return computeTotals(
    rec.lines.map((line) => ({
      quantity: line.quantity,
      rateCents: line.unitPriceCents,
      taxPercent: line.taxPercent,
    })),
  );
}

function creditMoney(s: Store, rec: CreditNoteRec) {
  const totals = creditTotals(rec);
  const applications = s.applications.filter((row) => row.creditNoteId === rec.id);
  const refunds = s.creditRefunds.filter((row) => row.creditNoteId === rec.id);
  const appliedCents = sum(applications.map((row) => row.amountCents));
  const refundedCents = sum(refunds.map((row) => row.amountCents));
  const remainingCents = Math.max(0, totals.totalCents - appliedCents - refundedCents);
  let status: CreditNoteStatus;
  if (rec.voidedAt) status = 'VOIDED';
  else if (!rec.issuedAt) status = 'DRAFT';
  else if (remainingCents === 0) status = refundedCents > appliedCents ? 'REFUNDED' : 'APPLIED';
  else if (appliedCents > 0) status = 'PARTIALLY_APPLIED';
  else status = 'AVAILABLE';
  return { totals, applications, refunds, appliedCents, refundedCents, remainingCents, status };
}

function creditView(s: Store, rec: CreditNoteRec): BillingCreditNote {
  const m = creditMoney(s, rec);
  const invoice = rec.invoiceId ? s.invoices.find((row) => row.id === rec.invoiceId) : null;
  return clone({
    id: rec.id,
    number: rec.number,
    firmId: rec.firmId,
    firmName: s.firms.find((firm) => firm.id === rec.firmId)?.name ?? '',
    clientId: rec.clientId,
    clientName: s.clients.find((client) => client.id === rec.clientId)?.name ?? '',
    invoiceId: rec.invoiceId,
    invoiceNumber: invoice?.number ?? null,
    currency: invoice?.currency ?? s.settings.general.currency,
    date: rec.date,
    reason: rec.reason,
    method: rec.method,
    lines: rec.lines.map((line, index) => ({
      ...line,
      amountCents: m.totals.lines[index]?.amountCents ?? 0,
      taxCents: m.totals.lines[index]?.taxCents ?? 0,
    })),
    adjustmentCents: rec.adjustmentCents,
    subtotalCents: m.totals.subtotalCents,
    taxCents: m.totals.taxCents,
    totalCents: m.totals.totalCents,
    appliedCents: m.appliedCents,
    refundedCents: m.refundedCents,
    remainingCents: m.remainingCents,
    keepAvailable: rec.keepAvailable,
    internalNote: rec.internalNote,
    customerNote: rec.customerNote,
    status: m.status,
    issuedAt: rec.issuedAt,
    sentAt: rec.sentAt,
    voidedAt: rec.voidedAt,
    voidReason: rec.voidReason,
    applications: m.applications
      .map((row) => ({
        id: row.id,
        invoiceId: row.invoiceId,
        invoiceNumber: s.invoices.find((invoice) => invoice.id === row.invoiceId)?.number ?? '',
        amountCents: row.amountCents,
        at: row.at,
        by: row.by,
      }))
      .sort((a, b) => a.at.localeCompare(b.at)),
    refunds: m.refunds
      .map(({ creditNoteId: _note, ...refund }) => refund)
      .sort((a, b) => a.at.localeCompare(b.at)),
    createdBy: rec.createdBy,
    createdAt: rec.createdAt,
    updatedAt: rec.updatedAt,
    history: [...rec.history].sort(byAt),
  });
}

function estimateMoney(rec: EstimateRec) {
  return computeTotals(
    rec.lines.map((line) => ({ ...line, taxPercent: rec.taxPercent })),
    rec.discountCents,
  );
}
function estimateStatus(rec: EstimateRec): EstimateStatus {
  if ((rec.state === 'SENT' || rec.state === 'PENDING') && rec.expirationDate < todayIso())
    return 'EXPIRED';
  return rec.state;
}
function estimateView(s: Store, rec: EstimateRec): BillingEstimate {
  const totals = estimateMoney(rec);
  const firm = s.firms.find((row) => row.id === rec.firmId);
  return clone({
    id: rec.id,
    number: rec.number,
    firmId: rec.firmId,
    firmName: firm?.name ?? '',
    clientId: rec.clientId,
    clientName: s.clients.find((client) => client.id === rec.clientId)?.name ?? '',
    contactName: rec.contactName,
    email: rec.email,
    phone: rec.phone,
    currency: firm?.currency ?? 'USD',
    issueDate: rec.issueDate,
    expirationDate: rec.expirationDate,
    reference: rec.reference,
    lines: rec.lines.map((line, index) => ({
      ...line,
      amountCents: totals.lines[index]?.amountCents ?? 0,
    })),
    subtotalCents: totals.subtotalCents,
    discountCents: totals.discountCents,
    taxRateId: rec.taxRateId,
    taxPercent: rec.taxPercent,
    taxCents: totals.taxCents,
    totalCents: totals.totalCents,
    notes: rec.notes,
    terms: rec.terms,
    status: estimateStatus(rec),
    sendNotification: rec.sendNotification,
    template: rec.template,
    assignedToId: rec.assignedToId,
    assignedToName: s.admins.find((admin) => admin.id === rec.assignedToId)?.name ?? null,
    convertedInvoiceId: rec.convertedInvoiceId,
    convertedInvoiceNumber:
      s.invoices.find((invoice) => invoice.id === rec.convertedInvoiceId)?.number ?? null,
    sentAt: rec.sentAt,
    createdBy: rec.createdBy,
    createdAt: rec.createdAt,
    updatedAt: rec.updatedAt,
    history: [...rec.history].sort(byAt),
  });
}

function recurringView(s: Store, rec: RecurringRec): BillingRecurring {
  const client = s.clients.find((row) => row.id === rec.clientId);
  const firm = s.firms.find((row) => row.id === rec.firmId);
  return clone({
    id: rec.id,
    firmId: rec.firmId,
    firmName: firm?.name ?? '',
    clientId: rec.clientId,
    clientName: client?.name ?? '',
    clientNumber: client?.number ?? 0,
    template: rec.template,
    description: rec.description,
    frequency: rec.frequency,
    customIntervalDays: rec.customIntervalDays,
    amountCents: rec.amountCents,
    currency: firm?.currency ?? 'USD',
    startDate: rec.startDate,
    nextInvoiceDate: rec.nextInvoiceDate,
    endDate: rec.endDate,
    autoSend: rec.autoSend,
    allowOnlinePayment: rec.allowOnlinePayment,
    status: rec.status,
    invoiceIds: rec.invoiceIds,
    createdAt: rec.createdAt,
    updatedAt: rec.updatedAt,
    history: [...rec.history].sort(byAt),
  });
}

function invoiceDetail(s: Store, rec: InvoiceRec): InvoiceDetail {
  const view = invoiceView(s, rec);
  const payments = s.payments
    .filter((payment) => payment.invoiceId === rec.id)
    .map((payment) => paymentView(s, payment))
    .sort((a, b) => a.paidOn.localeCompare(b.paidOn) || a.number.localeCompare(b.number));
  const credits: InvoiceCredit[] = s.applications
    .filter((row) => row.invoiceId === rec.id)
    .map((row) => ({
      id: row.id,
      creditNoteId: row.creditNoteId,
      creditNoteNumber: s.creditNotes.find((note) => note.id === row.creditNoteId)?.number ?? '',
      amountCents: row.amountCents,
      at: row.at,
      by: row.by,
    }))
    .sort((a, b) => a.at.localeCompare(b.at));
  const estimate = rec.estimateId ? s.estimates.find((row) => row.id === rec.estimateId) : null;
  const schedule = rec.recurringScheduleId
    ? s.recurring.find((row) => row.id === rec.recurringScheduleId)
    : null;
  const documents: BillingDocument[] = [
    {
      id: `INVOICE-${rec.id}`,
      kind: 'INVOICE',
      refId: rec.id,
      fileName: `${rec.number}.pdf`,
      description: rec.issuedAt ? 'Generated' : 'Draft copy',
      date: rec.issuedAt ?? rec.updatedAt,
    },
    ...(estimate
      ? [
          {
            id: `ESTIMATE-${estimate.id}`,
            kind: 'ESTIMATE' as const,
            refId: estimate.id,
            fileName: `${estimate.number}.pdf`,
            description: 'Converted to Invoice',
            date: null,
          },
        ]
      : []),
    ...rec.attachments.map((file) => ({
      id: `ATTACHMENT-${file.id}`,
      kind: 'ATTACHMENT' as const,
      refId: file.id,
      fileName: file.name,
      description: 'Uploaded',
      date: file.uploadedAt,
    })),
    ...credits
      .filter(
        (row, index) => credits.findIndex((c) => c.creditNoteId === row.creditNoteId) === index,
      )
      .map((row) => ({
        id: `CREDIT_NOTE-${row.creditNoteId}`,
        kind: 'CREDIT_NOTE' as const,
        refId: row.creditNoteId,
        fileName: `${row.creditNoteNumber}.pdf`,
        description: 'Credit applied',
        date: row.at,
      })),
    ...payments
      .filter((payment) => payment.status !== 'FAILED' && payment.status !== 'PENDING')
      .map((payment) => ({
        id: `RECEIPT-${payment.id}`,
        kind: 'RECEIPT' as const,
        refId: payment.id,
        fileName: `Receipt-${payment.number}.pdf`,
        description: 'Payment receipt',
        date: payment.recordedAt,
      })),
    ...payments.flatMap((payment) =>
      payment.refunds.map((refund) => ({
        id: `REFUND-${refund.id}`,
        kind: 'REFUND' as const,
        refId: refund.id,
        fileName: `Refund-${refund.confirmation}.pdf`,
        description: 'Refund confirmation',
        date: refund.at,
      })),
    ),
  ];
  return {
    ...view,
    firm: clone(findFirm(s, rec.firmId)),
    client: clone(findClient(s, rec.clientId)),
    payments,
    credits,
    documents,
    schedule: schedule ? { id: schedule.id, template: schedule.template } : null,
  };
}

// ---------------------------------------------------------------------------------------------
// Lists
// ---------------------------------------------------------------------------------------------

function pageOf<T>(rows: T[], page = 1, pageSize = 10): BillingPage<T> {
  const size = Math.min(100, Math.max(1, Math.floor(pageSize)));
  const pageCount = Math.max(1, Math.ceil(rows.length / size));
  const current = Math.min(Math.max(1, Math.floor(page)), pageCount);
  return {
    items: rows.slice((current - 1) * size, current * size),
    total: rows.length,
    page: current,
    pageSize: size,
    pageCount,
  };
}
function sorted<T>(
  rows: T[],
  value: (row: T) => string | number,
  descending: boolean,
  tieBreak: (row: T) => string,
): T[] {
  return [...rows].sort((a, b) => {
    const left = value(a);
    const right = value(b);
    const compared =
      typeof left === 'number' && typeof right === 'number'
        ? left - right
        : String(left).localeCompare(String(right));
    return (compared || tieBreak(a).localeCompare(tieBreak(b))) * (descending ? -1 : 1);
  });
}
const matches = (search: string | undefined, ...values: (string | null | undefined)[]) => {
  const term = search?.trim().toLowerCase();
  return !term || values.some((value) => value?.toLowerCase().includes(term));
};
const within = (date: string, from?: string, to?: string) =>
  (!from || date >= from) && (!to || date <= to);
const trend = (current: number, previous: number): number | null =>
  previous > 0 ? Math.round(((current - previous) / previous) * 100) : null;
/** The window a trend compares with: the same length just before `from`–`to`, or 30 days. */
function trendWindows(from?: string, to?: string) {
  const end = to ?? todayIso();
  const start = from ?? addDays(end, -29);
  const length = daysBetween(start, end) + 1;
  return {
    current: { from: start, to: end },
    previous: { from: addDays(start, -length), to: addDays(start, -1) },
  };
}

function filterInvoices(s: Store, query: InvoiceQuery, withDates = true): BillingInvoice[] {
  return s.invoices
    .map((rec) => invoiceView(s, rec))
    .filter(
      (row) =>
        (!query.firmId || row.firmId === query.firmId) &&
        (!query.clientId || row.clientId === query.clientId) &&
        (!query.status || row.status === query.status) &&
        (!query.type || row.type === query.type) &&
        (!withDates || within(row.issueDate, query.from, query.to)) &&
        within(row.dueDate, query.dueFrom, query.dueTo) &&
        (query.minCents === undefined || row.totalCents >= query.minCents) &&
        (query.maxCents === undefined || row.totalCents <= query.maxCents) &&
        matches(query.search, row.number, row.clientName, row.firmName, row.reference),
    );
}
function invoiceTotals(rows: BillingInvoice[]) {
  const issued = rows.filter((row) => row.status !== 'DRAFT' && row.status !== 'VOIDED');
  const paid = issued.filter((row) => row.paidCents > 0);
  return {
    invoicedCents: sum(issued.map((row) => row.totalCents)),
    invoicedCount: issued.length,
    paidCents: sum(paid.map((row) => row.paidCents - row.refundedCents)),
    paidCount: paid.length,
  };
}

function filterPayments(s: Store, query: PaymentQuery, withDates = true): BillingPayment[] {
  return s.payments
    .map((rec) => paymentView(s, rec))
    .filter(
      (row) =>
        (!query.firmId || row.firmId === query.firmId) &&
        (!query.clientId || row.clientId === query.clientId) &&
        (!query.invoiceId || row.invoiceId === query.invoiceId) &&
        (!query.status || row.status === query.status) &&
        (!query.method || row.method === query.method) &&
        (!withDates || within(row.paidOn, query.from, query.to)) &&
        matches(query.search, row.clientName, row.invoiceNumber, row.reference, row.firmName),
    );
}

function filterEstimates(s: Store, query: EstimateQuery): BillingEstimate[] {
  return s.estimates
    .map((rec) => estimateView(s, rec))
    .filter(
      (row) =>
        (!query.firmId || row.firmId === query.firmId) &&
        (!query.clientId || row.clientId === query.clientId) &&
        (!query.status || row.status === query.status) &&
        within(row.issueDate, query.from, query.to) &&
        matches(query.search, row.number, row.clientName, row.firmName, row.reference),
    );
}

function filterCreditNotes(s: Store, query: CreditNoteQuery): BillingCreditNote[] {
  return s.creditNotes
    .map((rec) => creditView(s, rec))
    .filter(
      (row) =>
        (!query.firmId || row.firmId === query.firmId) &&
        (!query.clientId || row.clientId === query.clientId) &&
        (!query.invoiceId || row.invoiceId === query.invoiceId) &&
        (!query.status || row.status === query.status) &&
        within(row.date, query.from, query.to) &&
        matches(query.search, row.number, row.clientName, row.invoiceNumber, row.firmName),
    );
}

function filterRecurring(s: Store, query: RecurringQuery, withStatus = true): BillingRecurring[] {
  return s.recurring
    .map((rec) => recurringView(s, rec))
    .filter(
      (row) =>
        (!query.firmId || row.firmId === query.firmId) &&
        (!query.clientId || row.clientId === query.clientId) &&
        (!withStatus || !query.status || row.status === query.status) &&
        within(row.nextInvoiceDate, query.from, query.to) &&
        matches(
          query.search,
          row.clientName,
          row.template,
          row.description,
          `#${row.clientNumber}`,
          row.firmName,
        ),
    );
}

// ---------------------------------------------------------------------------------------------
// Documents (stand-in PDFs)
// ---------------------------------------------------------------------------------------------

/** A one-page PDF with the given lines: the API's rendered document stands in as plain text. */
function pdfBlob(title: string, lines: string[]): Blob {
  const text = (value: string) => value.replace(/[^\x20-\x7e]/g, '-').replace(/([\\()])/g, '\\$1');
  const body = lines
    .slice(0, 52)
    .map((line) => `(${text(line)}) Tj T*`)
    .join('\n');
  const stream = `BT /F1 18 Tf 56 740 Td (${text(title)}) Tj /F1 10 Tf 14 TL 0 -28 Td\n${body}\nET`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
  ];
  let out = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((object, index) => {
    offsets.push(out.length);
    out += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  out += offsets.map((offset) => `${pad(offset, 10)} 00000 n \n`).join('');
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new Blob([out], { type: 'application/pdf' });
}

const addressLines = (address: BillingAddress) =>
  [address.line1, address.line2, `${address.city}, ${address.state} ${address.zip}`].filter(
    Boolean,
  );
const firmLines = (firm: BillingFirm) => [
  firm.name,
  ...addressLines(firm.address),
  firm.phone,
  firm.email,
];

function invoicePdf(s: Store, rec: InvoiceRec): BillingFile {
  const view = invoiceView(s, rec);
  const firm = findFirm(s, rec.firmId);
  const client = findClient(s, rec.clientId);
  const c = view.currency;
  return {
    fileName: `${rec.number}.pdf`,
    blob: pdfBlob(`Invoice ${rec.number}`, [
      ...firmLines(firm),
      '',
      `Invoice date: ${rec.issueDate}   Due date: ${rec.dueDate}`,
      `Reference: ${rec.reference || '-'}`,
      '',
      `Bill to: ${client.name}, ${client.contactName}`,
      ...addressLines(client.address),
      client.email,
      '',
      ...view.lines.map(
        (line) =>
          `${line.description}   ${line.quantity} x ${money(line.rateCents, c)} = ${money(line.amountCents, c)}`,
      ),
      '',
      `Subtotal: ${money(view.subtotalCents, c)}`,
      `Discount: ${money(view.discountCents, c)}`,
      `Tax: ${money(view.taxCents, c)}`,
      `Total: ${money(view.totalCents, c)}`,
      `Paid: ${money(view.paidCents - view.refundedCents, c)}   Credits: ${money(view.creditedCents, c)}`,
      `Balance due: ${money(view.balanceCents, c)}`,
      '',
      rec.notes,
      firm.paymentInstructions,
      firm.invoiceFooter,
    ]),
  };
}

function documentFile(s: Store, kind: BillingDocumentKind, refId: string): BillingFile {
  switch (kind) {
    case 'INVOICE':
      return invoicePdf(s, findInvoice(s, refId));
    case 'ESTIMATE': {
      const view = estimateView(s, findEstimate(s, refId));
      const firm = findFirm(s, view.firmId);
      return {
        fileName: `${view.number}.pdf`,
        blob: pdfBlob(`Estimate ${view.number}`, [
          ...firmLines(firm),
          '',
          `For: ${view.clientName}`,
          `Issued: ${view.issueDate}   Expires: ${view.expirationDate}`,
          '',
          ...view.lines.map(
            (line) =>
              `${line.description}   ${line.quantity} x ${money(line.rateCents)} = ${money(line.amountCents)}`,
          ),
          '',
          `Subtotal: ${money(view.subtotalCents)}   Discount: ${money(view.discountCents)}`,
          `Tax: ${money(view.taxCents)}   Total: ${money(view.totalCents)}`,
          '',
          ...view.terms.split('\n'),
        ]),
      };
    }
    case 'CREDIT_NOTE': {
      const view = creditView(s, findCreditNote(s, refId));
      const firm = findFirm(s, view.firmId);
      return {
        fileName: `${view.number}.pdf`,
        blob: pdfBlob(`Credit Note ${view.number}`, [
          ...firmLines(firm),
          '',
          `Customer: ${view.clientName}`,
          `Date: ${view.date}   Related invoice: ${view.invoiceNumber ?? '-'}`,
          '',
          `Credit amount: ${money(view.totalCents)}`,
          `Applied: ${money(view.appliedCents)}   Refunded: ${money(view.refundedCents)}`,
          `Remaining: ${money(view.remainingCents)}`,
          '',
          view.customerNote,
        ]),
      };
    }
    case 'RECEIPT': {
      const view = paymentView(s, findPayment(s, refId));
      const firm = findFirm(s, view.firmId);
      return {
        fileName: `Receipt-${view.number}.pdf`,
        blob: pdfBlob(`Receipt ${view.number}`, [
          ...firmLines(firm),
          '',
          `Received from: ${view.clientName}`,
          `Invoice: ${view.invoiceNumber}`,
          `Amount: ${money(view.amountCents, view.currency)}`,
          `Date: ${view.paidOn}   Method: ${view.method}   Reference: ${view.reference}`,
          '',
          'Thank you for your payment.',
        ]),
      };
    }
    case 'REFUND': {
      const refund = s.refunds.find((row) => row.id === refId);
      if (!refund) throw notFound('Refund');
      const view = paymentView(s, findPayment(s, refund.paymentId));
      const firm = findFirm(s, view.firmId);
      return {
        fileName: `Refund-${refund.confirmation}.pdf`,
        blob: pdfBlob(`Refund ${refund.confirmation}`, [
          ...firmLines(firm),
          '',
          `Refunded to: ${view.clientName}`,
          `Original payment: ${view.number} (${money(view.amountCents, view.currency)})`,
          `Refund amount: ${money(refund.amountCents, view.currency)}`,
          `Date: ${refund.at.slice(0, 10)}`,
        ]),
      };
    }
    case 'ATTACHMENT': {
      const attachment = s.invoices
        .flatMap((invoice) => invoice.attachments)
        .find((row) => row.id === refId);
      if (!attachment) throw notFound('Attachment');
      return {
        fileName: attachment.name,
        blob:
          s.files.get(attachment.id) ??
          pdfBlob(attachment.name, ['A sample attachment for the billing mock.']),
      };
    }
  }
}

// ---------------------------------------------------------------------------------------------
// Settings defaults and seed data
// ---------------------------------------------------------------------------------------------

function defaultSettings(at: string): BillingSettings {
  const template = (name: string, subject: string, body: string): DocumentTemplate => ({
    name,
    subject,
    body,
    firmOverride: true,
  });
  const all: AdminRole[] = ['OWNER', 'ADMIN', 'BILLING'];
  return {
    general: {
      currency: 'USD',
      language: 'en-US',
      invoiceTerms: 'NET_30',
      estimateValidityDays: 30,
      timeZone: 'America/New_York',
      dateFormat: 'MM/DD/YYYY',
      decimalPrecision: 2,
      rounding: 'STANDARD',
      enableCreditNotes: true,
      enableEstimates: true,
      enablePartialPayments: true,
      enableLateFees: true,
      requirePurchaseOrder: false,
      requireTax: false,
      termsAndConditions:
        'Payment is due within 30 days of the invoice date. Thank you for your business!',
      footerNote:
        'This is a system generated document. Please contact support if you have any questions.',
      platformNotes: '',
    },
    invoices: {
      defaultInvoiceType: 'STANDARD',
      defaultTaxRateId: null,
      discountBeforeTax: true,
      allowAttachments: true,
      maxAttachmentMb: 10,
      attachmentTypes: ['.pdf', '.jpg', '.jpeg', '.png', '.doc', '.docx'],
      onlinePaymentDefault: false,
      sendNowDefault: true,
      estimateTemplate: 'STANDARD',
      conversion: 'COPY_ALL',
      allowDuplicateConversion: false,
    },
    payments: {
      methods: ['CREDIT_CARD', 'ACH', 'BANK_TRANSFER', 'CHECK', 'CASH', 'MANUAL'],
      allowOverpayments: false,
      autoPay: true,
      sendReceipts: true,
      requireRefundReason: true,
      processor: 'STRIPE',
    },
    taxes: {
      mode: 'EXCLUSIVE',
      rates: [
        { id: TAX_SALES, name: 'Sales Tax', ratePercent: 7 },
        { id: TAX_SERVICE, name: 'Service Tax', ratePercent: 5 },
        { id: TAX_REDUCED, name: 'Reduced Rate', ratePercent: 2.5 },
      ],
      serviceFee: { enabled: false, type: 'PERCENT', amount: 3 },
      lateFee: { enabled: true, type: 'FLAT', amount: 2500, graceDays: 5 },
      firmsMayOverride: true,
    },
    reminders: {
      invoiceDue: { enabled: true, days: 3 },
      overdue: { enabled: true, days: 1, repeatEveryDays: 7, maxReminders: 3 },
      estimateExpiring: { enabled: true, days: 3 },
      failedPayment: { enabled: true, days: 0 },
      firmsMayOverride: true,
    },
    templates: {
      INVOICE: template(
        'Standard Invoice',
        'Invoice {invoice_number} from {firm_name}',
        'Hello {client_name},\n\nYour invoice {invoice_number} for {amount} is due on {due_date}.',
      ),
      ESTIMATE: template(
        'Standard Estimate',
        'Estimate {estimate_number} from {firm_name}',
        'Hello {client_name},\n\nPlease review estimate {estimate_number} for {amount}.',
      ),
      RECEIPT: template(
        'Payment Receipt',
        'Receipt for your payment to {firm_name}',
        'Hello {client_name},\n\nThank you. We received {amount} for invoice {invoice_number}.',
      ),
      CREDIT_NOTE: template(
        'Credit Note',
        'Credit note {credit_note_number} from {firm_name}',
        'Hello {client_name},\n\nA credit of {amount} is now on your account.',
      ),
      PAYMENT_REMINDER: template(
        'Payment Reminder',
        'Reminder: invoice {invoice_number} is due',
        'Hello {client_name},\n\nThis is a reminder that {amount} is due on {due_date}.',
      ),
      REFUND_CONFIRMATION: template(
        'Refund Confirmation',
        'Your refund from {firm_name}',
        'Hello {client_name},\n\nWe refunded {amount}. It may take 5-10 business days to arrive.',
      ),
    },
    numbering: {
      invoice: { format: 'INV-{####}', next: 1 },
      estimate: { format: 'EST-{####}', next: 1 },
      creditNote: { format: 'CN-{YYYY}-{####}', next: 1 },
      resetRule: 'NEVER',
      perFirm: false,
    },
    permissions: {
      CREATE_INVOICES: all,
      EDIT_INVOICES: all,
      SEND_INVOICES: all,
      VOID_INVOICES: ['OWNER', 'ADMIN'],
      RECORD_PAYMENTS: all,
      ISSUE_REFUNDS: ['OWNER', 'ADMIN'],
      CREATE_CREDIT_NOTES: all,
      APPLY_CREDITS: all,
      VOID_CREDIT_NOTES: ['OWNER', 'ADMIN'],
      MANAGE_RECURRING: all,
      EDIT_SETTINGS: ['OWNER'],
      VIEW_CROSS_FIRM: ['OWNER', 'ADMIN', 'BILLING', 'SUPPORT'],
    },
    updatedAt: at,
    updatedBy: ACTOR,
  };
}

const address = (line1: string, line2: string, city: string, state: string, zip: string) => ({
  line1,
  line2,
  city,
  state,
  zip,
});

function seedFirms(): BillingFirm[] {
  const firm = (
    id: string,
    slug: string,
    name: string,
    status: BillingFirmStatus,
    contact: Pick<BillingFirm, 'email' | 'phone' | 'address'>,
    extra: Partial<BillingFirm> = {},
  ): BillingFirm => ({
    id,
    slug,
    name,
    status,
    ...contact,
    currency: 'USD',
    paymentTerms: 'NET_30',
    defaultTaxRateId: null,
    invoiceFooter: 'Thank you for your business!',
    paymentInstructions: `Pay online with the link in your email, or by check payable to ${name}.`,
    estimateTerms: null,
    setupComplete: true,
    ...extra,
  });
  return [
    firm(
      FIRM_LVP,
      mockBusiness.slug,
      mockBusiness.name,
      'ACTIVE',
      {
        email: 'billing@lvp.example.test',
        phone: '(404) 555-0134',
        address: address('478 Sample Road', 'Suite 201', 'Lawrenceville', 'GA', '30046'),
      },
      {
        paymentTerms: 'NET_15',
        estimateTerms: `This estimate is valid until the expiration date listed above.\n\nBy accepting this estimate, you agree to the terms and conditions of ${mockBusiness.name}. All services will be provided as outlined.`,
      },
    ),
    firm(FIRM_NORTHSIDE, 'example-northside', 'Example Northside Accounting LLC', 'ACTIVE', {
      email: 'billing@example-northside.example.test',
      phone: '(312) 555-0187',
      address: address('200 Example Avenue', 'Floor 4', 'Chicago', 'IL', '60601'),
    }),
    firm(
      FIRM_RIVERSIDE,
      'sample-riverside-tax',
      'Sample Riverside Tax Co',
      'PENDING_SETUP',
      {
        email: 'billing@sample-riverside.example.test',
        phone: '(503) 555-0142',
        address: address('9 River Street', '', 'Portland', 'OR', '97201'),
      },
      { setupComplete: false },
    ),
    firm(FIRM_OLD, 'old-example', 'Old Example Firm', 'SUSPENDED', {
      email: 'billing@old-example.example.test',
      phone: '(614) 555-0110',
      address: address('15 Former Lane', '', 'Columbus', 'OH', '43004'),
    }),
  ];
}

function seedClients(): BillingClient[] {
  const client = (
    number: number,
    firmId: string,
    name: string,
    contactName: string,
    email: string,
    phone: string,
    home: BillingAddress,
    shipTo: BillingClient['shipTo'] = null,
  ): BillingClient => ({
    id: clientIdOf(number),
    firmId,
    number,
    name,
    contactName,
    email,
    phone,
    address: home,
    shipTo,
  });
  const taylor = address('1234 Sample Street NE', 'Suite 500', 'Atlanta', 'GA', '30309');
  return [
    client(
      1001,
      FIRM_LVP,
      'Johnson Family',
      'Alex Johnson',
      'alex.johnson@example.test',
      '(404) 555-0101',
      address('12 Maple Court', '', 'Decatur', 'GA', '30030'),
    ),
    client(
      1002,
      FIRM_LVP,
      'Taylor Corporate',
      'Jordan Taylor',
      'jordan@taylor-corporate.example.test',
      '(404) 555-0134',
      taylor,
      { label: 'Office Location', address: taylor },
    ),
    client(
      1003,
      FIRM_LVP,
      'Mitchell Holdings',
      'Casey Mitchell',
      'casey@mitchell-holdings.example.test',
      '(404) 555-0156',
      address('88 Commerce Way', '', 'Marietta', 'GA', '30060'),
    ),
    client(
      1004,
      FIRM_LVP,
      'Greenwood Bakery LLC',
      'Morgan Green',
      'morgan@greenwood-bakery.example.test',
      '(770) 555-0119',
      address('410 Oak Street', '', 'Roswell', 'GA', '30075'),
    ),
    client(
      1005,
      FIRM_LVP,
      'Parker Family',
      'Sam Parker',
      'sam.parker@example.test',
      '(770) 555-0177',
      address('7 Birch Lane', '', 'Duluth', 'GA', '30096'),
    ),
    client(
      1006,
      FIRM_LVP,
      'Stevenson Dental PLLC',
      'Riley Stevenson',
      'office@stevenson-dental.example.test',
      '(678) 555-0122',
      address('950 Health Parkway', 'Suite 3', 'Alpharetta', 'GA', '30005'),
    ),
    client(
      1007,
      FIRM_LVP,
      'Roberts & Co.',
      'Jamie Roberts',
      'jamie@roberts-co.example.test',
      '(678) 555-0148',
      address('31 Market Street', '', 'Atlanta', 'GA', '30303'),
    ),
    client(
      1008,
      FIRM_LVP,
      'Carter Nonprofit',
      'Drew Carter',
      'drew@carter-nonprofit.example.test',
      '(404) 555-0190',
      address('5 Hope Avenue', '', 'Atlanta', 'GA', '30310'),
    ),
    client(
      1009,
      FIRM_LVP,
      'Harris Corporate',
      'Quinn Harris',
      'quinn@harris-corporate.example.test',
      '(470) 555-0163',
      address('600 Center Plaza', 'Suite 12', 'Atlanta', 'GA', '30308'),
    ),
    client(
      1010,
      FIRM_LVP,
      'Wilson Household',
      'Avery Wilson',
      'avery.wilson@example.test',
      '(470) 555-0109',
      address('22 Elm Drive', '', 'Smyrna', 'GA', '30080'),
    ),
    client(
      1011,
      FIRM_LVP,
      'Acme Holdings LLC',
      'Pat Rivera',
      'pat@acme-holdings.example.test',
      '(404) 555-0171',
      address('100 Industrial Boulevard', '', 'Norcross', 'GA', '30071'),
    ),
    client(
      1012,
      FIRM_LVP,
      'Brown Consulting',
      'Lee Brown',
      'lee@brown-consulting.example.test',
      '(404) 555-0128',
      address('45 Consulting Row', '', 'Atlanta', 'GA', '30305'),
    ),
    client(
      1013,
      FIRM_NORTHSIDE,
      'Davis Enterprises',
      'Robin Davis',
      'robin@davis-enterprises.example.test',
      '(312) 555-0111',
      address('300 Lake Street', '', 'Chicago', 'IL', '60606'),
    ),
    client(
      1014,
      FIRM_NORTHSIDE,
      'Evans Media LLC',
      'Jesse Evans',
      'jesse@evans-media.example.test',
      '(312) 555-0135',
      address('77 Studio Avenue', '', 'Chicago', 'IL', '60607'),
    ),
    client(
      1015,
      FIRM_NORTHSIDE,
      'Miller Group',
      'Cameron Miller',
      'cameron@miller-group.example.test',
      '(312) 555-0152',
      address('18 River Drive', '', 'Chicago', 'IL', '60601'),
    ),
    client(
      1016,
      FIRM_NORTHSIDE,
      'Sunny Events Co.',
      'Dana Brooks',
      'dana@sunny-events.example.test',
      '(312) 555-0166',
      address('2 Festival Plaza', '', 'Evanston', 'IL', '60201'),
      {
        label: 'Event Location',
        address: address('900 Lakeshore Hall', '', 'Evanston', 'IL', '60208'),
      },
    ),
    client(
      1017,
      FIRM_OLD,
      'Cornerstone LLC',
      'Kai Stone',
      'kai@cornerstone.example.test',
      '(614) 555-0144',
      address('3 Cornerstone Way', '', 'Columbus', 'OH', '43215'),
    ),
    client(
      1018,
      FIRM_OLD,
      'Maple Creations',
      'Rowan Maple',
      'rowan@maple-creations.example.test',
      '(614) 555-0181',
      address('64 Maple Avenue', '', 'Dublin', 'OH', '43017'),
    ),
  ];
}

function seedItems(): BillingItem[] {
  const items: [string, string, number][] = [
    ['Individual Tax Return Preparation', 'Federal and state individual returns', 350],
    ['Business Tax Return Preparation', 'Federal and state business returns', 1200],
    ['Monthly Bookkeeping', 'Reconciliations and monthly reports', 450],
    ['Payroll Processing', 'One payroll run with filings', 250],
    ['Tax Planning Session', 'One hour planning meeting', 300],
    ['IRS Notice Response', 'Review and response to one notice', 200],
    ['Sales Tax Filing', 'One sales tax return', 150],
    ['Nonprofit Form 990 Preparation', 'Annual information return', 1500],
    ['Consultation (hourly)', 'Advisory time, billed hourly', 125],
  ];
  return items.map(([name, description, dollars], index) => ({
    id: uid('0b0c', index + 1),
    name,
    description,
    unitPriceCents: dollars * 100,
  }));
}

function seed(empty: boolean): Store {
  const today = todayIso();
  const day = (offset: number) => addDays(today, offset);
  const stamp = (offset: number, time = '15:24') => `${day(offset)}T${time}:00.000Z`;
  const s: Store = {
    firms: seedFirms(),
    clients: seedClients(),
    admins: [
      {
        id: '0199b6a2-0000-7000-8000-0000000000a1',
        name: ACTOR,
        email: 'morgan.admin@example.test',
        role: 'OWNER',
      },
      {
        id: uid('0b0d', 2),
        name: 'Jamie Sample',
        email: 'jamie.sample@example.test',
        role: 'BILLING',
      },
      {
        id: uid('0b0d', 3),
        name: 'Riley Example',
        email: 'riley.example@example.test',
        role: 'ADMIN',
      },
    ],
    items: seedItems(),
    invoices: [],
    payments: [],
    refunds: [],
    creditNotes: [],
    applications: [],
    creditRefunds: [],
    estimates: [],
    recurring: [],
    settings: defaultSettings(stamp(-200)),
    files: new Map(),
    seq: 5000,
  };
  if (empty) return s;

  const ev = (
    offset: number,
    action: string,
    detail: string,
    cents: number | null = null,
    actor = ACTOR,
  ) => event(s, action, detail, cents, stamp(offset, '14:05'), actor);
  const clientName = (n: number) => s.clients.find((c) => c.number === n)?.name ?? '';
  const cents = (dollars: number) => Math.round(dollars * 100);
  const percentOf = (taxRateId: string | null) =>
    s.settings.taxes.rates.find((rate) => rate.id === taxRateId)?.ratePercent ?? 0;

  // Invoices: [n, firm, client, issued (days from today), terms, lines, options].
  type Line = [string, number, number, string | null];
  type Options = {
    draft?: boolean;
    voided?: number;
    reference?: string;
    notes?: string;
    files?: [string, number][];
  };
  const invoiceSpecs: [number, string, number, number, PaymentTerms, Line[], Options?][] = [
    [1, FIRM_LVP, 1010, -150, 'NET_15', [['Individual Tax Return Preparation', 1, 850, null]]],
    [2, FIRM_OLD, 1017, -140, 'NET_30', [['Quarterly Bookkeeping', 1, 600, null]]],
    [3, FIRM_LVP, 1009, -135, 'NET_15', [['Business Tax Return Preparation', 1, 1900, null]]],
    [
      4,
      FIRM_LVP,
      1008,
      -120,
      'NET_15',
      [
        ['Nonprofit Form 990 Preparation', 1, 1500, null],
        ['Board Reporting Package', 1, 500, null],
      ],
    ],
    [5, FIRM_NORTHSIDE, 1013, -118, 'NET_30', [['Monthly Bookkeeping', 1, 450, null]]],
    [
      6,
      FIRM_LVP,
      1007,
      -100,
      'NET_15',
      [
        ['Payroll Setup', 1, 1250, null],
        ['Payroll Processing', 2, 250, null],
      ],
    ],
    [7, FIRM_LVP, 1006, -80, 'NET_15', [['Bookkeeping Cleanup', 1, 2950, null]]],
    [8, FIRM_LVP, 1005, -65, 'NET_15', [['Family Tax Return Preparation', 1, 1200, null]]],
    [
      9,
      FIRM_LVP,
      1004,
      -50,
      'NET_15',
      [
        ['Sales Tax Filing', 12, 150, null],
        ['Bookkeeping Catch-up', 1, 2700, null],
      ],
    ],
    [10, FIRM_OLD, 1018, -48, 'NET_30', [['Annual Accounts Preparation', 1, 350, null]]],
    [
      11,
      FIRM_LVP,
      1003,
      -35,
      'NET_15',
      [
        ['Tax Planning Session', 2, 300, null],
        ['Entity Structure Review', 1, 1200, null],
      ],
    ],
    [12, FIRM_NORTHSIDE, 1014, -33, 'NET_30', [['Payroll Processing - Q3', 1, 980, null]]],
    [
      13,
      FIRM_LVP,
      1002,
      -13,
      'NET_15',
      [
        ['Corporate Tax Return Preparation', 1, 2200, null],
        ['State Filing Fee', 1, 250, null],
      ],
      {
        reference: 'Engagement - Taylor Corporate',
        notes: 'Thank you for your business!\nWe look forward to working with you this tax season.',
        files: [['Engagement Letter.pdf', 182_000]],
      },
    ],
    [
      14,
      FIRM_LVP,
      1001,
      -17,
      'NET_15',
      [
        ['Individual Tax Return Preparation', 1, 2800, null],
        ['Prior-Year Amendment', 1, 400, null],
      ],
    ],
    [15, FIRM_LVP, 1011, -10, 'NET_30', [['Premium Plan - Monthly subscription', 1, 99, null]]],
    [16, FIRM_LVP, 1012, -8, 'NET_30', [['Business Filing Services', 1, 1500, null]]],
    [17, FIRM_NORTHSIDE, 1015, -25, 'NET_15', [['Bookkeeping Services', 1, 250, TAX_SERVICE]]],
    [
      18,
      FIRM_NORTHSIDE,
      1016,
      -6,
      'NET_30',
      [
        ['Event Sales Tax Review', 1, 1200, null],
        ['Consultation (hourly)', 2, 125, null],
      ],
    ],
    [
      19,
      FIRM_LVP,
      1009,
      -3,
      'NET_30',
      [['Quarterly Estimated Tax Payments', 4, 775, null]],
      { draft: true },
    ],
    [
      20,
      FIRM_LVP,
      1003,
      -1,
      'NET_30',
      [
        ['Bookkeeping Software Setup', 1, 400, null],
        ['Training Session', 2, 120, TAX_SALES],
      ],
      { draft: true },
    ],
    [21, FIRM_LVP, 1004, -40, 'NET_15', [['Sales Tax Filing', 2, 150, null]], { voided: -38 }],
    [
      22,
      FIRM_NORTHSIDE,
      1013,
      -60,
      'NET_30',
      [
        ['Registered Agent Service', 1, 125, null],
        ['Annual Report Filing', 1, 1075, null],
      ],
    ],
    [23, FIRM_LVP, 1001, -5, 'DUE_ON_RECEIPT', [['IRS Notice Response', 2, 200, null]]],
    [
      24,
      FIRM_LVP,
      1007,
      -2,
      'NET_15',
      [
        ['Payroll Processing', 2, 250, null],
        ['Year-End W-2 Preparation', 1, 320, null],
      ],
    ],
    [
      25,
      FIRM_NORTHSIDE,
      1014,
      -20,
      'NET_30',
      [['Custom Services - Monthly invoice', 1, 500, null]],
    ],
    [
      26,
      FIRM_LVP,
      1002,
      -30,
      'NET_15',
      [
        ['Tax Preparation - Business', 1, 3500, null],
        ['Bookkeeping Setup', 1, 750, null],
      ],
    ],
  ];
  const invoiceIdOf = (n: number) => uid('0b02', n);
  for (const [n, firmId, clientNumber, issued, terms, lines, options = {}] of invoiceSpecs) {
    const number = formatDocumentNumber(s.settings.numbering.invoice.format, n, day(issued));
    const by = n % 3 === 0 ? 'Jamie Sample' : ACTOR;
    const rec: InvoiceRec = {
      id: invoiceIdOf(n),
      number,
      firmId,
      clientId: clientIdOf(clientNumber),
      type: 'STANDARD',
      currency: 'USD',
      paymentTerms: terms,
      issueDate: day(issued),
      dueDate: day(issued + PAYMENT_TERM_DAYS[terms]),
      reference: options.reference ?? '',
      notes: options.notes ?? '',
      lines: lines.map(([description, quantity, rate, taxRateId], index) => ({
        id: uid('0b08', n * 10 + index),
        description,
        quantity,
        rateCents: cents(rate),
        taxRateId,
        taxPercent: percentOf(taxRateId),
      })),
      discountCents: 0,
      allowOnlinePayment: n % 2 === 0,
      recurringScheduleId: null,
      estimateId: null,
      attachments: (options.files ?? []).map(([name, size], index) => ({
        id: uid('0b09', n * 10 + index),
        name,
        contentType: 'application/pdf',
        sizeBytes: size,
        uploadedAt: stamp(issued - 2, '13:10'),
      })),
      issuedAt: options.draft ? null : stamp(issued, '15:24'),
      sentAt: options.draft ? null : stamp(issued, '15:24'),
      sendStatus: options.draft ? 'NOT_SENT' : 'SENT',
      voidedAt: options.voided === undefined ? null : stamp(options.voided, '10:00'),
      voidReason: options.voided === undefined ? null : 'Issued in error',
      createdAt: stamp(issued, '15:20'),
      updatedAt: stamp(options.voided ?? issued, '15:24'),
      createdBy: by,
      history: [],
    };
    rec.history.push(ev(issued, 'Created', `Invoice ${number} created`, null, by));
    if (!options.draft)
      rec.history.push(
        ev(
          issued,
          'Sent',
          `Sent to ${s.clients.find((c) => c.id === rec.clientId)?.email ?? ''}`,
          null,
          by,
        ),
      );
    if (options.voided !== undefined)
      rec.history.push(ev(options.voided, 'Voided', 'Voided: Issued in error'));
    s.invoices.push(rec);
  }
  s.settings.numbering.invoice.next = invoiceSpecs.length + 1;
  const invoiceN = (n: number) => findInvoice(s, invoiceIdOf(n));

  // Payments: [invoice, paid on, amount, method, state, failure].
  const refCode = (n: number) =>
    ((n * 2_654_435 + 104_729) % 2_176_782_336).toString(36).toUpperCase().padStart(8, '0');
  const prefix: Record<PaymentMethod, string> = {
    CREDIT_CARD: 'ch_',
    ACH: 'ach_',
    BANK_TRANSFER: 'trf_',
    CHECK: 'chk_',
    CASH: 'cash_',
    MANUAL: 'manual_',
  };
  const paymentSpecs: [number, number, number, PaymentMethod, PaymentRec['state']?, string?][] = [
    [1, -140, 850, 'CHECK'],
    [2, -120, 600, 'CREDIT_CARD'],
    [4, -110, 2000, 'ACH'],
    [3, -125, 1800, 'CREDIT_CARD'],
    [5, -100, 450, 'CREDIT_CARD'],
    [6, -90, 1750, 'CREDIT_CARD'],
    [7, -70, 2950, 'BANK_TRANSFER'],
    [8, -55, 1100, 'CREDIT_CARD'],
    [22, -45, 1200, 'ACH'],
    [9, -40, 4425, 'CREDIT_CARD'],
    [10, -30, 350, 'CREDIT_CARD'],
    [11, -22, 1800, 'CREDIT_CARD'],
    [25, -15, 500, 'CREDIT_CARD', 'FAILED', 'Card declined by the issuer'],
    [12, -15, 400, 'ACH'],
    [17, -12, 100, 'CASH'],
    [25, -12, 500, 'CREDIT_CARD'],
    [26, -20, 4250, 'CREDIT_CARD'],
    [16, -6, 500, 'CREDIT_CARD'],
    [24, -1, 820, 'ACH', 'PENDING'],
  ];
  const invoiceTotalDollars = (n: number) => computeTotals(invoiceN(n).lines).totalCents / 100;
  [...paymentSpecs]
    .sort((a, b) => a[1] - b[1])
    .forEach(([invoice, paidOn, amount, method, state = 'COMPLETED', failure], index) => {
      const n = index + 1;
      const rec: PaymentRec = {
        id: uid('0b03', n),
        number: `RCPT-${pad(n, 4)}`,
        invoiceId: invoiceIdOf(invoice),
        amountCents: cents(amount),
        paidOn: day(paidOn),
        method,
        reference: `${prefix[method]}${method === 'MANUAL' ? pad(n, 3) : refCode(n)}`,
        processor: method === 'CREDIT_CARD' || method === 'ACH' ? 'Stripe' : 'Manual',
        state,
        notes:
          state === 'COMPLETED' && amount >= invoiceTotalDollars(invoice)
            ? 'Full payment received.'
            : '',
        failureReason: failure ?? null,
        recordedBy: n % 4 === 0 ? 'Jamie Sample' : ACTOR,
        recordedAt: stamp(paidOn, '19:15'),
        receiptSentAt: state === 'COMPLETED' ? stamp(paidOn, '19:16') : null,
      };
      s.payments.push(rec);
      const action =
        state === 'FAILED'
          ? 'Payment failed'
          : state === 'PENDING'
            ? 'Payment pending'
            : 'Payment recorded';
      invoiceN(invoice).history.push(
        ev(
          paidOn,
          action,
          `${rec.number} by ${method.replace('_', ' ').toLowerCase()}`,
          rec.amountCents,
          rec.recordedBy,
        ),
      );
    });

  // Refunds: [invoice, at, amount, reason].
  const refundSpecs: [number, number, number, string][] = [
    [2, -100, 600, 'Service canceled by the client'],
    [10, -20, 150, 'Fee adjustment agreed with the client'],
  ];
  refundSpecs.forEach(([invoice, at, amount, reason], index) => {
    const payment = s.payments.find(
      (row) => row.invoiceId === invoiceIdOf(invoice) && row.state === 'COMPLETED',
    );
    if (!payment) return;
    const refund: BillingRefund = {
      id: uid('0b0a', index + 1),
      paymentId: payment.id,
      amountCents: cents(amount),
      type: cents(amount) >= payment.amountCents ? 'FULL' : 'PARTIAL',
      reason,
      notes: '',
      method: 'ORIGINAL',
      at: stamp(at, '16:40'),
      by: ACTOR,
      confirmation: `RF-${pad(index + 1, 4)}`,
    };
    s.refunds.push(refund);
    invoiceN(invoice).history.push(
      ev(at, 'Refund issued', `${refund.confirmation}: ${reason}`, refund.amountCents),
    );
  });

  // Credit notes: [n, client, invoice, date, reason, adjustment | line, applied, refunded, voided, draft].
  type CreditSpec = {
    n: number;
    client: number;
    invoice: number | null;
    date: number;
    reason: CreditReason;
    adjustment?: number;
    line?: [string, string, number, number];
    apply?: [number, number, number];
    refund?: number;
    voided?: number;
    draft?: boolean;
    note?: string;
  };
  const creditSpecs: CreditSpec[] = [
    {
      n: 1,
      client: 1005,
      invoice: 8,
      date: -60,
      reason: 'PRICE_ADJUSTMENT',
      adjustment: 100,
      apply: [8, 100, -60],
    },
    {
      n: 2,
      client: 1016,
      invoice: 18,
      date: -3,
      reason: 'SERVICE_ISSUE',
      line: ['Consultation (hourly)', 'Session rescheduled by the firm', 2, 125],
      apply: [18, 250, -3],
    },
    {
      n: 3,
      client: 1001,
      invoice: 14,
      date: -10,
      reason: 'BILLING_ERROR',
      adjustment: 500,
      note: 'Credit for the duplicated amendment fee.',
    },
    { n: 4, client: 1006, invoice: 7, date: -66, reason: 'GOODWILL', adjustment: 300, refund: 300 },
    {
      n: 5,
      client: 1004,
      invoice: 9,
      date: -45,
      reason: 'DUPLICATE_CHARGE',
      line: ['Sales Tax Filing', 'Duplicate filing charge', 1, 150],
      apply: [9, 75, -45],
    },
    { n: 6, client: 1003, invoice: 11, date: -20, reason: 'GOODWILL', adjustment: 200 },
    {
      n: 7,
      client: 1009,
      invoice: 3,
      date: -130,
      reason: 'PRICE_ADJUSTMENT',
      adjustment: 100,
      apply: [3, 100, -130],
    },
    {
      n: 8,
      client: 1007,
      invoice: 6,
      date: -88,
      reason: 'BILLING_ERROR',
      adjustment: 400,
      voided: -85,
    },
    {
      n: 9,
      client: 1012,
      invoice: 16,
      date: -4,
      reason: 'SERVICE_ISSUE',
      adjustment: 350,
      apply: [16, 350, -4],
    },
    {
      n: 10,
      client: 1013,
      invoice: 22,
      date: -40,
      reason: 'CANCELLATION',
      line: ['Annual Report Filing', 'Filing withdrawn', 1, 150],
    },
    {
      n: 11,
      client: 1014,
      invoice: 25,
      date: -11,
      reason: 'CANCELLATION',
      adjustment: 500,
      refund: 500,
    },
    { n: 12, client: 1002, invoice: 13, date: -1, reason: 'OTHER', adjustment: 250, draft: true },
  ];
  for (const spec of [...creditSpecs].sort((a, b) => a.n - b.n)) {
    const client = s.clients.find((c) => c.number === spec.client);
    if (!client) continue;
    const number = formatDocumentNumber(
      s.settings.numbering.creditNote.format,
      spec.n,
      day(spec.date),
    );
    const rec: CreditNoteRec = {
      id: uid('0b04', spec.n),
      number,
      firmId: client.firmId,
      clientId: client.id,
      invoiceId: spec.invoice === null ? null : invoiceIdOf(spec.invoice),
      date: day(spec.date),
      reason: spec.reason,
      method: spec.line ? 'LINE_ITEMS' : 'ADJUSTMENT',
      lines: spec.line
        ? [
            {
              id: uid('0b08', 900 + spec.n),
              item: spec.line[0],
              description: spec.line[1],
              quantity: spec.line[2],
              unitPriceCents: cents(spec.line[3]),
              taxRateId: null,
              taxPercent: 0,
            },
          ]
        : [],
      adjustmentCents: cents(spec.adjustment ?? 0),
      keepAvailable: true,
      internalNote: spec.voided === undefined ? '' : 'Created for the wrong client.',
      customerNote: spec.note ?? '',
      issuedAt: spec.draft ? null : stamp(spec.date, '11:30'),
      sentAt: spec.draft ? null : stamp(spec.date, '11:31'),
      voidedAt: spec.voided === undefined ? null : stamp(spec.voided, '09:45'),
      voidReason: spec.voided === undefined ? null : 'Created for the wrong client',
      createdBy: ACTOR,
      createdAt: stamp(spec.date, '11:20'),
      updatedAt: stamp(spec.voided ?? spec.date, '11:31'),
      history: [],
    };
    rec.history.push(
      ev(spec.date, 'Created', `Credit note ${number} for ${clientName(spec.client)}`),
    );
    if (!spec.draft) rec.history.push(ev(spec.date, 'Issued', `Issued to ${client.email}`));
    if (spec.apply) {
      const [invoice, amount, at] = spec.apply;
      const application: ApplicationRec = {
        id: uid('0b0e', spec.n),
        creditNoteId: rec.id,
        invoiceId: invoiceIdOf(invoice),
        amountCents: cents(amount),
        at: stamp(at, '12:00'),
        by: ACTOR,
      };
      s.applications.push(application);
      rec.history.push(
        ev(at, 'Applied', `Applied to ${invoiceN(invoice).number}`, application.amountCents),
      );
      invoiceN(invoice).history.push(
        ev(at, 'Credit applied', `${number} applied`, application.amountCents),
      );
    }
    if (spec.refund !== undefined) {
      const refund: CreditRefundRec = {
        id: uid('0b0f', spec.n),
        creditNoteId: rec.id,
        amountCents: cents(spec.refund),
        reason: 'Customer asked for the balance back',
        method: 'ORIGINAL',
        at: stamp(spec.date + 1, '10:00'),
        by: ACTOR,
      };
      s.creditRefunds.push(refund);
      rec.history.push(
        ev(spec.date + 1, 'Refunded', 'Remaining balance refunded', refund.amountCents),
      );
    }
    if (spec.voided !== undefined)
      rec.history.push(ev(spec.voided, 'Voided', 'Voided: Created for the wrong client'));
    s.creditNotes.push(rec);
  }
  s.settings.numbering.creditNote.next = creditSpecs.length + 1;

  // Estimates: [n, client, issued, valid days, state, lines, extras].
  type EstimateExtras = { discount?: number; tax?: string; notes?: string; converted?: number };
  const estimateSpecs: [
    number,
    number,
    number,
    number,
    EstimateRec['state'],
    [string, number, number][],
    EstimateExtras?,
  ][] = [
    [1, 1010, -160, 14, 'APPROVED', [['Individual Tax Return Preparation', 1, 850]]],
    [2, 1017, -150, 14, 'DECLINED', [['Quarterly Bookkeeping', 4, 600]]],
    [
      3,
      1008,
      -128,
      14,
      'APPROVED',
      [
        ['Nonprofit Form 990 Preparation', 1, 1500],
        ['Board Reporting Package', 1, 500],
      ],
    ],
    [
      4,
      1002,
      -35,
      14,
      'CONVERTED',
      [
        ['Tax Preparation - Business', 1, 3500],
        ['Bookkeeping Setup', 1, 750],
      ],
      { converted: 26 },
    ],
    [5, 1005, -70, 14, 'DECLINED', [['Family Tax Return Preparation', 1, 1400]]],
    [
      6,
      1007,
      -60,
      14,
      'PENDING',
      [
        ['Payroll Setup', 1, 1250],
        ['Payroll Processing', 4, 250],
      ],
    ],
    [
      7,
      1006,
      -45,
      30,
      'APPROVED',
      [
        ['Bookkeeping Cleanup', 1, 2950],
        ['Monthly Bookkeeping', 3, 450],
      ],
      { discount: 100 },
    ],
    [
      8,
      1013,
      -30,
      14,
      'SENT',
      [
        ['Registered Agent Service', 1, 125],
        ['Annual Report Filing', 1, 1075],
      ],
    ],
    [
      9,
      1004,
      -20,
      30,
      'APPROVED',
      [
        ['Sales Tax Filing', 12, 150],
        ['Point-of-Sale Setup Review', 1, 800],
      ],
      { tax: TAX_SALES },
    ],
    [
      10,
      1003,
      -12,
      14,
      'DECLINED',
      [
        ['Entity Structure Review', 1, 1200],
        ['Tax Planning Session', 2, 300],
      ],
    ],
    [
      11,
      1016,
      -8,
      14,
      'SENT',
      [
        ['Event Sales Tax Review', 1, 1200],
        ['Consultation (hourly)', 4, 125],
      ],
    ],
    [
      12,
      1001,
      -6,
      14,
      'PENDING',
      [
        ['Tax Planning Session', 3, 300],
        ['Individual Tax Return Preparation', 1, 2600],
      ],
      { notes: 'Tentative tax planning estimate for the family.' },
    ],
    [13, 1011, -2, 14, 'DRAFT', [['Monthly Bookkeeping', 12, 400]]],
    [
      14,
      1015,
      -1,
      14,
      'PENDING',
      [
        ['Bookkeeping Services', 6, 250],
        ['Payroll Processing', 6, 250],
      ],
    ],
  ];
  for (const [n, clientNumber, issued, validDays, state, lines, extras = {}] of estimateSpecs) {
    const client = s.clients.find((c) => c.number === clientNumber);
    if (!client) continue;
    const firm = findFirm(s, client.firmId);
    const number = formatDocumentNumber(s.settings.numbering.estimate.format, n, day(issued));
    const rec: EstimateRec = {
      id: uid('0b05', n),
      number,
      firmId: client.firmId,
      clientId: client.id,
      contactName: client.contactName,
      email: client.email,
      phone: client.phone,
      issueDate: day(issued),
      expirationDate: day(issued + validDays),
      reference: '',
      lines: lines.map(([description, quantity, rate], index) => ({
        id: uid('0b08', 500 + n * 10 + index),
        description,
        quantity,
        rateCents: cents(rate),
      })),
      discountCents: cents(extras.discount ?? 0),
      taxRateId: extras.tax ?? null,
      taxPercent: percentOf(extras.tax ?? null),
      notes: extras.notes ?? '',
      terms: firm.estimateTerms ?? s.settings.general.termsAndConditions,
      state,
      sendNotification: true,
      template: 'STANDARD',
      assignedToId: n % 2 === 0 ? (s.admins[0]?.id ?? null) : (s.admins[1]?.id ?? null),
      convertedInvoiceId: extras.converted ? invoiceIdOf(extras.converted) : null,
      sentAt: state === 'DRAFT' ? null : stamp(issued, '11:20'),
      createdBy: ACTOR,
      createdAt: stamp(issued, '11:15'),
      updatedAt: stamp(issued, '11:20'),
      history: [],
    };
    rec.history.push(ev(issued, 'Created', `Estimate ${number} for ${client.name}`));
    if (state !== 'DRAFT') rec.history.push(ev(issued, 'Sent', `Sent to ${client.email}`));
    if (state === 'APPROVED' || state === 'DECLINED' || state === 'CONVERTED')
      rec.history.push(
        ev(
          issued + 3,
          state === 'DECLINED' ? 'Declined' : 'Approved',
          `Marked ${state === 'DECLINED' ? 'declined' : 'approved'}`,
        ),
      );
    if (extras.converted) {
      const invoice = invoiceN(extras.converted);
      invoice.estimateId = rec.id;
      rec.history.push(ev(-30, 'Converted', `Converted to ${invoice.number}`));
      invoice.history.push(ev(-30, 'Converted from estimate', `From ${number}`));
    }
    s.estimates.push(rec);
  }
  s.settings.numbering.estimate.next = estimateSpecs.length + 1;

  // Recurring schedules: [n, client, template, description, frequency, amount, start, next, status].
  const recurringSpecs: [
    number,
    number,
    string,
    string,
    RecurringFrequency,
    number,
    number,
    number,
    RecurringStatus,
    number[]?,
  ][] = [
    [1, 1011, 'Premium Plan', 'Monthly subscription', 'MONTHLY', 99, -40, 20, 'ACTIVE', [15]],
    [2, 1012, 'Business Filing Services', 'Monthly retainer', 'MONTHLY', 150, -70, 2, 'ACTIVE'],
    [3, 1008, 'Compliance Package', 'Quarterly services', 'QUARTERLY', 300, -80, 14, 'ACTIVE'],
    [4, 1013, 'Registered Agent Service', 'Annual renewal', 'ANNUALLY', 125, -270, 95, 'ACTIVE'],
    [5, 1014, 'Custom Services', 'Monthly invoice', 'MONTHLY', 200, -50, 0, 'PAUSED'],
    [6, 1001, 'Formation Package', '6 month plan', 'SEMIANNUALLY', 500, -30, 150, 'ACTIVE'],
    [7, 1015, 'Bookkeeping Services', 'Monthly', 'MONTHLY', 250, -55, 4, 'ACTIVE'],
    [8, 1010, 'Tax Filing Support', 'Quarterly', 'QUARTERLY', 400, -200, 18, 'CANCELED'],
  ];
  for (const [
    n,
    clientNumber,
    template,
    description,
    frequency,
    amount,
    start,
    next,
    status,
    invoices = [],
  ] of recurringSpecs) {
    const client = s.clients.find((c) => c.number === clientNumber);
    if (!client) continue;
    const rec: RecurringRec = {
      id: uid('0b06', n),
      firmId: client.firmId,
      clientId: client.id,
      template,
      description,
      frequency,
      customIntervalDays: null,
      amountCents: cents(amount),
      startDate: day(start),
      nextInvoiceDate: day(next),
      endDate: null,
      autoSend: status !== 'PAUSED',
      allowOnlinePayment: n % 3 !== 0,
      status,
      invoiceIds: invoices.map(invoiceIdOf),
      occurrences: invoices.map((invoice) => invoiceN(invoice).issueDate),
      createdAt: stamp(start, '09:00'),
      updatedAt: stamp(start, '09:00'),
      history: [ev(start, 'Created', `${template} for ${client.name}`)],
    };
    if (status === 'PAUSED') rec.history.push(ev(-5, 'Paused', 'Paused at the client’s request'));
    if (status === 'CANCELED')
      rec.history.push(ev(-20, 'Canceled', 'Client moved to annual billing'));
    for (const invoice of invoices) {
      invoiceN(invoice).recurringScheduleId = rec.id;
      rec.history.push(
        ev(
          daysBetween(today, invoiceN(invoice).issueDate),
          'Invoice generated',
          invoiceN(invoice).number,
        ),
      );
    }
    s.recurring.push(rec);
  }
  return s;
}

// ---------------------------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------------------------

function requireSendable(firm: BillingFirm, client: BillingClient) {
  if (!firm.setupComplete)
    throw fail(
      422,
      'BILLING_SETUP_INCOMPLETE',
      `${firm.name} has not finished its payment and tax setup`,
    );
  if (!client.email) throw fail(422, 'CLIENT_EMAIL_MISSING', `${client.name} has no email`);
}

function saveLines(s: Store, lines: SaveInvoiceLine[], prefix: string): LineRec[] {
  return lines.map((line) => ({
    id: nextId(s, prefix),
    description: line.description.trim(),
    quantity: line.quantity,
    rateCents: line.rateCents,
    taxRateId: line.taxRateId,
    taxPercent: taxPercentOf(s, line.taxRateId),
  }));
}

function takeAttachments(s: Store, files: NewAttachment[]): BillingAttachment[] {
  const rules = s.settings.invoices;
  if (files.length && !rules.allowAttachments)
    throw fail(422, 'ATTACHMENTS_DISABLED', 'Attachments are turned off in Billing Settings');
  return files.map((file) => {
    const lower = file.name.toLowerCase();
    if (!rules.attachmentTypes.some((type) => lower.endsWith(type)))
      throw fail(400, 'VALIDATION_FAILED', `${file.name} is not a supported file type`);
    if (file.sizeBytes > rules.maxAttachmentMb * 1024 * 1024)
      throw fail(
        400,
        'VALIDATION_FAILED',
        `${file.name} is larger than ${rules.maxAttachmentMb}MB`,
      );
    const id = nextId(s, '0b09');
    if (file.file) s.files.set(id, file.file);
    return {
      id,
      name: file.name.slice(0, 200),
      contentType: file.contentType || 'application/octet-stream',
      sizeBytes: file.sizeBytes,
      uploadedAt: nowIso(),
    };
  });
}

function checkInvoice(s: Store, body: SaveInvoice) {
  const errors = invoiceErrors(body);
  if (hasErrors(errors)) throw fail(400, 'VALIDATION_FAILED', firstMessage(errors));
  if (!CURRENCIES.includes(body.currency) || !PAYMENT_TERMS.includes(body.paymentTerms))
    throw fail(400, 'VALIDATION_FAILED', 'Choose a currency and payment terms');
  if (!INVOICE_TYPES.includes(body.type))
    throw fail(400, 'VALIDATION_FAILED', 'Choose an invoice type');
  if (s.settings.general.requirePurchaseOrder && !body.reference.trim())
    throw fail(400, 'VALIDATION_FAILED', 'Billing Settings require a PO number in Reference');
  if (s.settings.general.requireTax && body.lines.some((line) => !line.taxRateId))
    throw fail(400, 'VALIDATION_FAILED', 'Billing Settings require a tax rate on every line');
}

function issue(s: Store, rec: InvoiceRec, client: BillingClient, at: string) {
  const resend = Boolean(rec.sentAt);
  rec.issuedAt ??= at;
  rec.sentAt = at;
  rec.sendStatus = 'SENT';
  rec.updatedAt = at;
  rec.history.push(event(s, resend ? 'Resent' : 'Sent', `Sent to ${client.email}`, null, at));
}

function createInvoiceRec(s: Store, body: SaveInvoice): InvoiceRec {
  const firm = activeFirm(s, body.firmId);
  const client = clientOfFirm(s, firm.id, body.clientId);
  checkInvoice(s, body);
  uniqueNumber(s, 'invoice', body.number, firm.id);
  const estimate = body.estimateId ? findEstimate(s, body.estimateId) : null;
  if (estimate) {
    if (estimate.clientId !== client.id)
      throw fail(400, 'VALIDATION_FAILED', 'The estimate belongs to another client');
    if (estimate.convertedInvoiceId && !s.settings.invoices.allowDuplicateConversion)
      throw fail(409, 'ALREADY_CONVERTED', 'This estimate was already converted to an invoice');
  }
  if (body.send) requireSendable(firm, client);
  const at = nowIso();
  const rec: InvoiceRec = {
    id: nextId(s, '0b02'),
    number: body.number.trim(),
    firmId: firm.id,
    clientId: client.id,
    type: body.type,
    currency: body.currency,
    paymentTerms: body.paymentTerms,
    issueDate: body.issueDate,
    dueDate: body.dueDate,
    reference: body.reference.trim(),
    notes: body.notes.trim(),
    lines: saveLines(s, body.lines, '0b08'),
    discountCents: body.discountCents,
    allowOnlinePayment: body.allowOnlinePayment,
    recurringScheduleId: null,
    estimateId: estimate?.id ?? null,
    attachments: takeAttachments(s, body.attachments),
    issuedAt: null,
    sentAt: null,
    sendStatus: 'NOT_SENT',
    voidedAt: null,
    voidReason: null,
    createdAt: at,
    updatedAt: at,
    createdBy: ACTOR,
    history: [],
  };
  const total = computeTotals(rec.lines, rec.discountCents).totalCents;
  rec.history.push(event(s, 'Created', `Invoice ${rec.number} created`, total, at));
  if (estimate) {
    estimate.state = 'CONVERTED';
    estimate.convertedInvoiceId = rec.id;
    estimate.updatedAt = at;
    estimate.history.push(event(s, 'Converted', `Converted to ${rec.number}`, null, at));
    rec.history.push(event(s, 'Converted from estimate', `From ${estimate.number}`, null, at));
  }
  if (body.send) issue(s, rec, client, at);
  s.invoices.push(rec);
  consumeNumber(s, 'invoice', rec.number, rec.issueDate);
  return rec;
}

/** Runs one occurrence of a schedule through the normal invoice rules (docx §9.2). */
function generateFromSchedule(s: Store, rec: RecurringRec): InvoiceRec {
  const firm = activeFirm(s, rec.firmId);
  const client = findClient(s, rec.clientId);
  const occurrence = rec.nextInvoiceDate;
  if (rec.occurrences.includes(occurrence))
    throw fail(409, 'DUPLICATE_OCCURRENCE', 'An invoice already exists for this occurrence');
  const send = rec.autoSend && firm.setupComplete;
  const invoice = createInvoiceRec(s, {
    firmId: firm.id,
    clientId: client.id,
    number: suggestNumber(s, 'invoice', occurrence, firm.id),
    issueDate: occurrence,
    dueDate: addDays(occurrence, PAYMENT_TERM_DAYS[firm.paymentTerms]),
    type: 'STANDARD',
    currency: firm.currency,
    paymentTerms: firm.paymentTerms,
    reference: `Recurring - ${rec.template}`,
    notes: '',
    lines: [
      {
        description: rec.description ? `${rec.template} - ${rec.description}` : rec.template,
        quantity: 1,
        rateCents: rec.amountCents,
        taxRateId: null,
      },
    ],
    discountCents: 0,
    allowOnlinePayment: rec.allowOnlinePayment,
    send,
    estimateId: null,
    attachments: [],
    keepAttachmentIds: [],
  });
  invoice.recurringScheduleId = rec.id;
  rec.invoiceIds.push(invoice.id);
  rec.occurrences.push(occurrence);
  rec.nextInvoiceDate = nextOccurrence(occurrence, rec.frequency, rec.customIntervalDays);
  rec.updatedAt = nowIso();
  rec.history.push(event(s, 'Invoice generated', invoice.number, null));
  return invoice;
}

function saveEstimateRec(s: Store, body: SaveEstimate, existing?: EstimateRec): EstimateRec {
  const errors = estimateErrors(body);
  if (hasErrors(errors)) throw fail(400, 'VALIDATION_FAILED', firstMessage(errors));
  const client = findClient(s, body.clientId);
  const firm = activeFirm(s, client.firmId);
  if (!s.settings.general.enableEstimates)
    throw fail(422, 'ESTIMATES_DISABLED', 'Estimates are turned off in Billing Settings');
  uniqueNumber(s, 'estimate', body.number, firm.id, existing?.id);
  if (body.send) requireSendable(firm, client);
  if (body.assignedToId && !s.admins.some((admin) => admin.id === body.assignedToId))
    throw fail(400, 'VALIDATION_FAILED', 'Choose someone from the Super Admin team');
  const at = nowIso();
  const fields = {
    number: body.number.trim(),
    firmId: firm.id,
    clientId: client.id,
    contactName: body.contactName.trim(),
    email: body.email.trim(),
    phone: body.phone.trim(),
    issueDate: body.issueDate,
    expirationDate: body.expirationDate,
    reference: body.reference.trim(),
    lines: body.lines.map((line) => ({
      id: nextId(s, '0b08'),
      description: line.description.trim(),
      quantity: line.quantity,
      rateCents: line.rateCents,
    })),
    discountCents: body.discountCents,
    taxRateId: body.taxRateId,
    taxPercent: taxPercentOf(s, body.taxRateId),
    notes: body.notes.trim(),
    terms: body.terms.trim() || (firm.estimateTerms ?? s.settings.general.termsAndConditions),
    sendNotification: body.sendNotification,
    template: body.template,
    assignedToId: body.assignedToId,
  };
  const status: EstimateSetStatus = body.send && body.status === 'DRAFT' ? 'SENT' : body.status;
  let rec: EstimateRec;
  if (existing) {
    if (existing.state === 'CONVERTED')
      throw fail(409, 'ALREADY_CONVERTED', 'A converted estimate cannot be edited');
    Object.assign(existing, fields, { state: status, updatedAt: at });
    existing.history.push(event(s, 'Edited', `Estimate ${existing.number} updated`, null, at));
    rec = existing;
  } else {
    rec = {
      id: nextId(s, '0b05'),
      ...fields,
      state: status,
      convertedInvoiceId: null,
      sentAt: null,
      createdBy: ACTOR,
      createdAt: at,
      updatedAt: at,
      history: [event(s, 'Created', `Estimate ${fields.number} for ${client.name}`, null, at)],
    };
    s.estimates.push(rec);
    consumeNumber(s, 'estimate', rec.number, rec.issueDate);
  }
  if (body.send) {
    rec.sentAt = at;
    rec.history.push(
      event(
        s,
        'Sent',
        body.sendNotification ? `Emailed to ${rec.email || client.email}` : 'Marked as sent',
        null,
        at,
      ),
    );
  }
  return rec;
}

function saveCreditNoteRec(s: Store, body: SaveCreditNote, existing?: CreditNoteRec) {
  const errors = creditNoteErrors(body);
  if (hasErrors(errors)) throw fail(400, 'VALIDATION_FAILED', firstMessage(errors));
  if (!s.settings.general.enableCreditNotes)
    throw fail(422, 'CREDIT_NOTES_DISABLED', 'Credit notes are turned off in Billing Settings');
  const client = findClient(s, body.clientId);
  const firm = activeFirm(s, client.firmId);
  const invoice = body.invoiceId ? findInvoice(s, body.invoiceId) : null;
  if (invoice && invoice.clientId !== client.id)
    throw fail(400, 'VALIDATION_FAILED', 'The related invoice belongs to another customer');
  if (body.issue) requireSendable(firm, client);
  const at = nowIso();
  const fields = {
    firmId: firm.id,
    clientId: client.id,
    invoiceId: invoice?.id ?? null,
    date: body.date,
    reason: body.reason,
    method: body.method,
    lines:
      body.method === 'LINE_ITEMS'
        ? body.lines.map((line) => ({
            id: nextId(s, '0b08'),
            item: line.item.trim(),
            description: line.description.trim(),
            quantity: line.quantity,
            unitPriceCents: line.unitPriceCents,
            taxRateId: line.taxRateId,
            taxPercent: taxPercentOf(s, line.taxRateId),
          }))
        : [],
    adjustmentCents: body.method === 'ADJUSTMENT' ? body.adjustmentCents : 0,
    keepAvailable: body.keepAvailable,
    internalNote: body.internalNote.trim(),
    customerNote: body.customerNote.trim(),
  };
  let rec: CreditNoteRec;
  if (existing) {
    if (existing.issuedAt)
      throw fail(409, 'ALREADY_ISSUED', 'An issued credit note cannot be edited');
    Object.assign(existing, fields, { updatedAt: at });
    existing.history.push(event(s, 'Edited', `Credit note ${existing.number} updated`, null, at));
    rec = existing;
  } else {
    const number = suggestNumber(s, 'creditNote', body.date, firm.id);
    rec = {
      id: nextId(s, '0b04'),
      number,
      ...fields,
      issuedAt: null,
      sentAt: null,
      voidedAt: null,
      voidReason: null,
      createdBy: ACTOR,
      createdAt: at,
      updatedAt: at,
      history: [event(s, 'Created', `Credit note ${number} for ${client.name}`, null, at)],
    };
    s.creditNotes.push(rec);
    consumeNumber(s, 'creditNote', number, body.date);
  }
  if (body.issue) issueCreditNoteRec(s, rec);
  return rec;
}

/** Issue: when the remaining credit is not kept, apply it to the related invoice and refund the rest. */
function issueCreditNoteRec(s: Store, rec: CreditNoteRec) {
  if (rec.issuedAt) throw fail(409, 'ALREADY_ISSUED', 'This credit note is already issued');
  const client = findClient(s, rec.clientId);
  const at = nowIso();
  rec.issuedAt = at;
  rec.sentAt = at;
  rec.updatedAt = at;
  const total = creditTotals(rec).totalCents;
  rec.history.push(event(s, 'Issued', `Issued to ${client.email}`, total, at));
  if (!rec.keepAvailable) {
    let remaining = total;
    const invoice = rec.invoiceId ? findInvoice(s, rec.invoiceId) : null;
    if (invoice && invoice.issuedAt && !invoice.voidedAt) {
      const amount = Math.min(remaining, invoiceMoney(s, invoice).balanceCents);
      if (amount > 0) {
        s.applications.push({
          id: nextId(s, '0b0e'),
          creditNoteId: rec.id,
          invoiceId: invoice.id,
          amountCents: amount,
          at,
          by: ACTOR,
        });
        rec.history.push(event(s, 'Applied', `Applied to ${invoice.number}`, amount, at));
        invoice.history.push(event(s, 'Credit applied', `${rec.number} applied`, amount, at));
        invoice.updatedAt = at;
        remaining -= amount;
      }
    }
    if (remaining > 0) {
      s.creditRefunds.push({
        id: nextId(s, '0b0f'),
        creditNoteId: rec.id,
        amountCents: remaining,
        reason: 'Remaining credit not kept on the account',
        method: 'ORIGINAL',
        at,
        by: ACTOR,
      });
      rec.history.push(event(s, 'Refunded', 'Remaining credit refunded', remaining, at));
    }
  }
}

function saveRecurringRec(s: Store, body: SaveRecurring, existing?: RecurringRec): RecurringRec {
  const errors = recurringErrors(body);
  if (hasErrors(errors)) throw fail(400, 'VALIDATION_FAILED', firstMessage(errors));
  const client = findClient(s, body.clientId);
  const firm = existing ? findFirm(s, client.firmId) : activeFirm(s, client.firmId);
  const at = nowIso();
  const fields = {
    firmId: firm.id,
    clientId: client.id,
    template: body.template.trim(),
    description: body.description.trim(),
    frequency: body.frequency,
    customIntervalDays: body.frequency === 'CUSTOM' ? body.customIntervalDays : null,
    amountCents: body.amountCents,
    startDate: body.startDate,
    nextInvoiceDate: body.nextInvoiceDate,
    endDate: body.endDate || null,
    autoSend: body.autoSend,
    allowOnlinePayment: body.allowOnlinePayment,
    status: body.status,
  };
  if (existing) {
    const before = existing.status;
    Object.assign(existing, fields, { updatedAt: at });
    existing.history.push(
      event(
        s,
        before === body.status ? 'Edited' : statusAction(body.status),
        `${existing.template} updated`,
        null,
        at,
      ),
    );
    return existing;
  }
  const rec: RecurringRec = {
    id: nextId(s, '0b06'),
    ...fields,
    invoiceIds: [],
    occurrences: [],
    createdAt: at,
    updatedAt: at,
    history: [event(s, 'Created', `${fields.template} for ${client.name}`, null, at)],
  };
  if (body.sourceInvoiceId) {
    const invoice = findInvoice(s, body.sourceInvoiceId);
    if (invoice.clientId !== client.id)
      throw fail(400, 'VALIDATION_FAILED', 'The invoice belongs to another client');
    invoice.recurringScheduleId = rec.id;
    invoice.history.push(event(s, 'Set up as recurring', fields.template, null, at));
    rec.invoiceIds.push(invoice.id);
    rec.occurrences.push(invoice.issueDate);
  }
  s.recurring.push(rec);
  return rec;
}
const statusAction = (status: RecurringStatus) =>
  status === 'ACTIVE' ? 'Resumed' : status === 'PAUSED' ? 'Paused' : 'Canceled';

// ---------------------------------------------------------------------------------------------
// The client
// ---------------------------------------------------------------------------------------------

/** Empty-mode check for the lists: true when the mock started without documents. */
const empty = () => mockedEmpty(MODULE);

/**
 * The Super Admin Billing client. Every call waits like a request and, outside mock mode,
 * fails like an unreachable API. Errors are ApiRequestError with these codes: NOT_FOUND (404),
 * VALIDATION_FAILED (400), DUPLICATE_NUMBER, ALREADY_CONVERTED, ALREADY_ISSUED,
 * DUPLICATE_OCCURRENCE, HAS_PAYMENTS, INVOICE_VOIDED, INVALID_STATE (409), FIRM_UNAVAILABLE,
 * BILLING_SETUP_INCOMPLETE, CLIENT_EMAIL_MISSING, TOTAL_BELOW_PAID, AMOUNT_TOO_HIGH,
 * ATTACHMENTS_DISABLED, ESTIMATES_DISABLED, CREDIT_NOTES_DISABLED (422).
 */
export const adminBilling = {
  /** True when the mock started without documents (NEXT_PUBLIC_API_MOCK_EMPTY=adminBilling). */
  isEmpty: () => empty(),

  // Reference data ---------------------------------------------------------------------------
  /** Every firm, for the "All Firms" filter; only ACTIVE ones can get new documents. */
  firms: async (): Promise<BillingFirm[]> => {
    await ready();
    return clone(db().firms).sort((a, b) => a.name.localeCompare(b.name));
  },
  firm: async (id: string): Promise<BillingFirm> => {
    await ready();
    return clone(findFirm(db(), id));
  },
  /** A firm's clients (or every client), by name. */
  clients: async (query: { firmId?: string; search?: string } = {}): Promise<BillingClient[]> => {
    await ready();
    return clone(
      db().clients.filter(
        (client) =>
          (!query.firmId || client.firmId === query.firmId) &&
          matches(query.search, client.name, client.contactName, client.email, `#${client.number}`),
      ),
    ).sort((a, b) => a.name.localeCompare(b.name));
  },
  client: async (id: string): Promise<BillingClient> => {
    await ready();
    return clone(findClient(db(), id));
  },
  /** The Super Admin team (Assign To, Created By). */
  admins: async (): Promise<BillingAdmin[]> => {
    await ready();
    return clone(db().admins);
  },
  /** Catalog services for the Item / Service pickers. */
  items: async (): Promise<BillingItem[]> => {
    await ready();
    return clone(db().items);
  },
  /** The next free number for a new document ("INV-0027"), from Billing Settings' numbering. */
  nextNumber: async (
    kind: NumberKind,
    options: { date?: string; firmId?: string } = {},
  ): Promise<string> => {
    await ready();
    return suggestNumber(db(), kind, options.date ?? todayIso(), options.firmId ?? null);
  },
  /** A stand-in PDF (or an uploaded attachment) to save. */
  download: async (doc: { kind: BillingDocumentKind; refId: string }): Promise<BillingFile> => {
    await ready();
    return documentFile(db(), doc.kind, doc.refId);
  },

  // Invoices ---------------------------------------------------------------------------------
  /** The invoice list: newest first by default (issue date, then number). */
  invoices: async (query: InvoiceQuery = {}): Promise<BillingPage<BillingInvoice>> => {
    await ready();
    const s = db();
    const rows = filterInvoices(s, query);
    const order: Record<InvoiceSort, (row: BillingInvoice) => string | number> = {
      number: (row) => row.number,
      client: (row) => row.clientName,
      firm: (row) => row.firmName,
      issueDate: (row) => row.issueDate,
      dueDate: (row) => row.dueDate,
      amount: (row) => row.totalCents,
      status: (row) => row.status,
    };
    const sort = query.sort ?? 'issueDate';
    return pageOf(
      sorted(rows, order[sort], query.descending ?? !query.sort, (row) => row.number),
      query.page,
      query.pageSize,
    );
  },
  /** The dashboard cards for the same filters as the list. */
  invoiceSummary: async (query: InvoiceQuery = {}): Promise<InvoiceSummary> => {
    await ready();
    const s = db();
    const rows = filterInvoices(s, query);
    const open = rows.filter(
      (row) =>
        row.status === 'PENDING' || row.status === 'PARTIALLY_PAID' || row.status === 'OVERDUE',
    );
    const overdue = rows.filter((row) => row.status === 'OVERDUE');
    const windows = trendWindows(query.from, query.to);
    const undated = filterInvoices(s, query, false);
    const current = invoiceTotals(
      undated.filter((row) => within(row.issueDate, windows.current.from, windows.current.to)),
    );
    const previous = invoiceTotals(
      undated.filter((row) => within(row.issueDate, windows.previous.from, windows.previous.to)),
    );
    const totals = invoiceTotals(rows);
    return {
      ...totals,
      invoicedTrend: trend(current.invoicedCents, previous.invoicedCents),
      paidTrend: trend(current.paidCents, previous.paidCents),
      outstandingCents: sum(open.map((row) => row.balanceCents)),
      outstandingCount: open.length,
      overdueCents: sum(overdue.map((row) => row.balanceCents)),
      overdueCount: overdue.length,
    };
  },
  /** Invoice Details: 404 NOT_FOUND when missing. */
  invoice: async (id: string): Promise<InvoiceDetail> => {
    await ready();
    const s = db();
    return invoiceDetail(s, findInvoice(s, id));
  },
  /** Saves a new invoice as a draft, or issues and sends it (`send`). */
  createInvoice: async (body: SaveInvoice): Promise<InvoiceDetail> => {
    await ready();
    const s = db();
    return invoiceDetail(s, createInvoiceRec(s, body));
  },
  /** Edit mode: same rules; keeps the id, number history and payments (docx §7). */
  updateInvoice: async (id: string, body: SaveInvoice): Promise<InvoiceDetail> => {
    await ready();
    const s = db();
    const rec = findInvoice(s, id);
    if (rec.voidedAt) throw fail(409, 'INVOICE_VOIDED', 'A voided invoice cannot be edited');
    const before = invoiceMoney(s, rec);
    const firm = rec.firmId === body.firmId ? findFirm(s, rec.firmId) : activeFirm(s, body.firmId);
    if (firm.id !== rec.firmId && before.paidCents + before.creditedCents > 0)
      throw fail(409, 'HAS_PAYMENTS', 'An invoice with payments or credits stays with its firm');
    const client = clientOfFirm(s, firm.id, body.clientId);
    if (client.id !== rec.clientId && before.paidCents + before.creditedCents > 0)
      throw fail(409, 'HAS_PAYMENTS', 'An invoice with payments or credits stays with its client');
    checkInvoice(s, body);
    uniqueNumber(s, 'invoice', body.number, firm.id, rec.id);
    const lines = saveLines(s, body.lines, '0b08');
    const total = computeTotals(lines, body.discountCents).totalCents;
    if (total < before.paidCents - before.refundedCents + before.creditedCents)
      throw fail(422, 'TOTAL_BELOW_PAID', 'The new total is less than what was already paid');
    if (body.send) requireSendable(firm, client);
    const kept = rec.attachments.filter((file) => body.keepAttachmentIds.includes(file.id));
    const added = takeAttachments(s, body.attachments);
    const at = nowIso();
    Object.assign(rec, {
      number: body.number.trim(),
      firmId: firm.id,
      clientId: client.id,
      type: body.type,
      currency: body.currency,
      paymentTerms: body.paymentTerms,
      issueDate: body.issueDate,
      dueDate: body.dueDate,
      reference: body.reference.trim(),
      notes: body.notes.trim(),
      lines,
      discountCents: body.discountCents,
      allowOnlinePayment: body.allowOnlinePayment,
      attachments: [...kept, ...added],
      updatedAt: at,
    });
    rec.history.push(
      event(
        s,
        'Edited',
        before.totals.totalCents === total
          ? `Invoice ${rec.number} updated`
          : `Total changed from ${money(before.totals.totalCents, rec.currency)} to ${money(total, rec.currency)}`,
        total,
        at,
      ),
    );
    if (body.send) issue(s, rec, client, at);
    return invoiceDetail(s, rec);
  },
  /** Send / Resend: issues a draft; a resend keeps the record and only logs it (docx §20). */
  sendInvoice: async (id: string): Promise<InvoiceDetail> => {
    await ready();
    const s = db();
    const rec = findInvoice(s, id);
    if (rec.voidedAt) throw fail(409, 'INVOICE_VOIDED', 'A voided invoice cannot be sent');
    const client = findClient(s, rec.clientId);
    const firm = findFirm(s, rec.firmId);
    if (!rec.issuedAt && firm.status !== 'ACTIVE')
      throw fail(422, 'FIRM_UNAVAILABLE', `${firm.name} is not active, so it cannot bill`);
    requireSendable(firm, client);
    issue(s, rec, client, nowIso());
    return invoiceDetail(s, rec);
  },
  /** A new draft copy with the next number and today's dates. */
  duplicateInvoice: async (id: string): Promise<InvoiceDetail> => {
    await ready();
    const s = db();
    const source = findInvoice(s, id);
    const firm = activeFirm(s, source.firmId);
    const issueDate = todayIso();
    const copy = createInvoiceRec(s, {
      firmId: firm.id,
      clientId: source.clientId,
      number: suggestNumber(s, 'invoice', issueDate, firm.id),
      issueDate,
      dueDate: addDays(issueDate, PAYMENT_TERM_DAYS[source.paymentTerms]),
      type: source.type,
      currency: source.currency,
      paymentTerms: source.paymentTerms,
      reference: source.reference,
      notes: source.notes,
      lines: source.lines.map(({ description, quantity, rateCents, taxRateId }) => ({
        description,
        quantity,
        rateCents,
        taxRateId,
      })),
      discountCents: source.discountCents,
      allowOnlinePayment: source.allowOnlinePayment,
      send: false,
      estimateId: null,
      attachments: [],
      keepAttachmentIds: [],
    });
    copy.history.push(event(s, 'Duplicated', `Copied from ${source.number}`));
    source.history.push(event(s, 'Duplicated', `Copied to ${copy.number}`));
    return invoiceDetail(s, copy);
  },
  /** Void keeps the number and history; refused while money is on it (refund it first). */
  voidInvoice: async (id: string, input: { reason: string }): Promise<InvoiceDetail> => {
    await ready();
    const s = db();
    const rec = findInvoice(s, id);
    if (rec.voidedAt) throw fail(409, 'INVOICE_VOIDED', 'This invoice is already voided');
    const reason = input.reason.trim();
    if (!reason) throw fail(400, 'VALIDATION_FAILED', 'Enter a reason for voiding');
    const m = invoiceMoney(s, rec);
    if (m.paidCents - m.refundedCents > 0 || m.creditedCents > 0)
      throw fail(
        409,
        'HAS_PAYMENTS',
        'Refund the payments and remove the credits before voiding this invoice',
      );
    const at = nowIso();
    rec.voidedAt = at;
    rec.voidReason = reason.slice(0, 500);
    rec.updatedAt = at;
    rec.history.push(event(s, 'Voided', `Voided: ${rec.voidReason}`, m.totals.totalCents, at));
    return invoiceDetail(s, rec);
  },

  // Payments ---------------------------------------------------------------------------------
  /** The payment list: newest first by default. */
  payments: async (query: PaymentQuery = {}): Promise<BillingPage<BillingPayment>> => {
    await ready();
    const rows = filterPayments(db(), query);
    const order: Record<PaymentSort, (row: BillingPayment) => string | number> = {
      paidOn: (row) => row.paidOn,
      client: (row) => row.clientName,
      firm: (row) => row.firmName,
      invoice: (row) => row.invoiceNumber,
      amount: (row) => row.amountCents,
      method: (row) => row.method,
      status: (row) => row.status,
    };
    const sort = query.sort ?? 'paidOn';
    return pageOf(
      sorted(rows, order[sort], query.descending ?? !query.sort, (row) => row.number),
      query.page,
      query.pageSize,
    );
  },
  /** Payments' cards for the same filters as the list. */
  paymentSummary: async (query: PaymentQuery = {}): Promise<PaymentSummary> => {
    await ready();
    const s = db();
    const rows = filterPayments(s, query);
    const received = (list: BillingPayment[]) =>
      list.filter((row) => row.status !== 'FAILED' && row.status !== 'PENDING');
    const done = received(rows);
    const windows = trendWindows(query.from, query.to);
    const undated = received(filterPayments(s, query, false));
    const inWindow = (from: string, to: string) =>
      sum(undated.filter((row) => within(row.paidOn, from, to)).map((row) => row.amountCents));
    const today = todayIso();
    const monthStart = `${today.slice(0, 7)}-01`;
    const lastMonthStart = addMonths(monthStart, -1);
    const month = done.filter((row) => row.paidOn >= monthStart && row.paidOn <= today);
    const lastMonth = sum(
      undated
        .filter((row) => row.paidOn >= lastMonthStart && row.paidOn < monthStart)
        .map((row) => row.amountCents),
    );
    const refunds = done.flatMap((row) => row.refunds);
    const totalCents = sum(done.map((row) => row.amountCents));
    return {
      totalCents,
      totalCount: done.length,
      totalTrend: trend(
        inWindow(windows.current.from, windows.current.to),
        inWindow(windows.previous.from, windows.previous.to),
      ),
      monthCents: sum(month.map((row) => row.amountCents)),
      monthCount: month.length,
      monthTrend: trend(sum(month.map((row) => row.amountCents)), lastMonth),
      refundsCents: sum(refunds.map((row) => row.amountCents)),
      refundsCount: refunds.length,
      averageCents: done.length ? Math.round(totalCents / done.length) : 0,
    };
  },
  payment: async (id: string): Promise<BillingPayment> => {
    await ready();
    const s = db();
    return paymentView(s, findPayment(s, id));
  },
  /**
   * Record Payment (docx §17.1): partial payments when Billing Settings allow them, never above
   * the balance unless overpayments are on. Updates the invoice and writes the receipt.
   */
  recordPayment: async (input: RecordPaymentInput): Promise<BillingPayment> => {
    await ready();
    const s = db();
    const invoice = findInvoice(s, input.invoiceId);
    if (invoice.voidedAt) throw fail(409, 'INVOICE_VOIDED', 'A voided invoice cannot be paid');
    if (!invoice.issuedAt)
      throw fail(409, 'INVALID_STATE', 'Send the invoice before recording a payment');
    const m = invoiceMoney(s, invoice);
    const settings = s.settings;
    if (!Number.isInteger(input.amountCents) || input.amountCents <= 0)
      throw fail(400, 'VALIDATION_FAILED', 'Enter a payment amount above 0');
    if (!isDate(input.paidOn) || input.paidOn > todayIso())
      throw fail(400, 'VALIDATION_FAILED', 'Enter a payment date that is not in the future');
    if (!settings.payments.methods.includes(input.method))
      throw fail(400, 'VALIDATION_FAILED', 'That payment method is turned off in Billing Settings');
    if (input.amountCents > m.balanceCents && !settings.payments.allowOverpayments)
      throw fail(
        422,
        'AMOUNT_TOO_HIGH',
        `The payment is more than the balance of ${money(m.balanceCents, invoice.currency)}`,
      );
    if (input.amountCents < m.balanceCents && !settings.general.enablePartialPayments)
      throw fail(422, 'VALIDATION_FAILED', 'Partial payments are turned off in Billing Settings');
    if (input.reference.length > 100 || input.notes.length > 1000)
      throw fail(400, 'VALIDATION_FAILED', 'The reference or notes are too long');
    const at = nowIso();
    const count = s.payments.length + 1;
    const rec: PaymentRec = {
      id: nextId(s, '0b03'),
      number: `RCPT-${pad(count, 4)}`,
      invoiceId: invoice.id,
      amountCents: input.amountCents,
      paidOn: input.paidOn,
      method: input.method,
      reference: input.reference.trim() || `manual_${pad(count, 3)}`,
      processor: 'Manual',
      state: 'COMPLETED',
      notes: input.notes.trim(),
      failureReason: null,
      recordedBy: ACTOR,
      recordedAt: at,
      receiptSentAt: input.sendReceipt ? at : null,
    };
    s.payments.push(rec);
    invoice.updatedAt = at;
    invoice.history.push(event(s, 'Payment recorded', `${rec.number}`, rec.amountCents, at));
    if (input.sendReceipt)
      invoice.history.push(event(s, 'Receipt sent', `Receipt ${rec.number} emailed`, null, at));
    return paymentView(s, rec);
  },
  /** Issue Refund (docx §17.2): never more than the refundable amount; needs the confirmation. */
  refundPayment: async (input: RefundInput): Promise<BillingPayment> => {
    await ready();
    const s = db();
    const rec = findPayment(s, input.paymentId);
    const view = paymentView(s, rec);
    if (view.refundableCents <= 0)
      throw fail(409, 'INVALID_STATE', 'This payment has nothing left to refund');
    if (!input.confirmed) throw fail(400, 'VALIDATION_FAILED', 'Confirm the refund first');
    const amount = input.type === 'FULL' ? view.refundableCents : input.amountCents;
    if (!Number.isInteger(amount) || amount <= 0)
      throw fail(400, 'VALIDATION_FAILED', 'Enter a refund amount above 0');
    if (amount > view.refundableCents)
      throw fail(
        422,
        'AMOUNT_TOO_HIGH',
        `At most ${money(view.refundableCents, view.currency)} can be refunded`,
      );
    if (s.settings.payments.requireRefundReason && !input.reason.trim())
      throw fail(400, 'VALIDATION_FAILED', 'Enter a reason for the refund');
    const at = nowIso();
    const refund: BillingRefund = {
      id: nextId(s, '0b0a'),
      paymentId: rec.id,
      amountCents: amount,
      type: amount >= view.refundableCents && view.refundedCents === 0 ? 'FULL' : 'PARTIAL',
      reason: input.reason.trim(),
      notes: input.notes.trim(),
      method: input.method,
      at,
      by: ACTOR,
      confirmation: `RF-${pad(s.refunds.length + 1, 4)}`,
    };
    s.refunds.push(refund);
    const invoice = findInvoice(s, rec.invoiceId);
    invoice.updatedAt = at;
    invoice.history.push(
      event(
        s,
        'Refund issued',
        `${refund.confirmation}: ${refund.reason || 'No reason'}`,
        amount,
        at,
      ),
    );
    return paymentView(s, rec);
  },
  /** Send Receipt again. */
  sendReceipt: async (id: string): Promise<BillingPayment> => {
    await ready();
    const s = db();
    const rec = findPayment(s, id);
    if (rec.state !== 'COMPLETED')
      throw fail(409, 'INVALID_STATE', 'Only a completed payment has a receipt');
    rec.receiptSentAt = nowIso();
    findInvoice(s, rec.invoiceId).history.push(
      event(s, 'Receipt sent', `Receipt ${rec.number} emailed`),
    );
    return paymentView(s, rec);
  },

  // Credit notes -----------------------------------------------------------------------------
  creditNotes: async (query: CreditNoteQuery = {}): Promise<BillingPage<BillingCreditNote>> => {
    await ready();
    const rows = filterCreditNotes(db(), query);
    const order: Record<CreditNoteSort, (row: BillingCreditNote) => string | number> = {
      number: (row) => row.number,
      client: (row) => row.clientName,
      invoice: (row) => row.invoiceNumber ?? '',
      date: (row) => row.date,
      amount: (row) => row.totalCents,
      applied: (row) => row.appliedCents,
      remaining: (row) => row.remainingCents,
      status: (row) => row.status,
    };
    const sort = query.sort ?? 'date';
    return pageOf(
      sorted(rows, order[sort], query.descending ?? !query.sort, (row) => row.number),
      query.page,
      query.pageSize,
    );
  },
  creditNoteSummary: async (query: CreditNoteQuery = {}): Promise<CreditNoteSummary> => {
    await ready();
    const rows = filterCreditNotes(db(), query);
    const issued = rows.filter((row) => row.status !== 'DRAFT' && row.status !== 'VOIDED');
    return {
      count: rows.length,
      issuedCents: sum(issued.map((row) => row.totalCents)),
      appliedCents: sum(issued.map((row) => row.appliedCents)),
      availableCents: sum(
        issued
          .filter((row) => row.status === 'AVAILABLE' || row.status === 'PARTIALLY_APPLIED')
          .map((row) => row.remainingCents),
      ),
      refundedCents: sum(issued.map((row) => row.refundedCents)),
    };
  },
  creditNote: async (id: string): Promise<BillingCreditNote> => {
    await ready();
    const s = db();
    return creditView(s, findCreditNote(s, id));
  },
  /** Credits a client can still use (Apply Credit Note): same client, Available or Partially Applied. */
  availableCredits: async (clientId: string): Promise<BillingCreditNote[]> => {
    await ready();
    const s = db();
    return s.creditNotes
      .filter((rec) => rec.clientId === clientId)
      .map((rec) => creditView(s, rec))
      .filter((row) => row.status === 'AVAILABLE' || row.status === 'PARTIALLY_APPLIED')
      .sort((a, b) => a.date.localeCompare(b.date));
  },
  /** Saves a draft, or issues it (`issue`); the number is generated. */
  createCreditNote: async (body: SaveCreditNote): Promise<BillingCreditNote> => {
    await ready();
    const s = db();
    return creditView(s, saveCreditNoteRec(s, body));
  },
  /** Drafts only. */
  updateCreditNote: async (id: string, body: SaveCreditNote): Promise<BillingCreditNote> => {
    await ready();
    const s = db();
    return creditView(s, saveCreditNoteRec(s, body, findCreditNote(s, id)));
  },
  issueCreditNote: async (id: string): Promise<BillingCreditNote> => {
    await ready();
    const s = db();
    const rec = findCreditNote(s, id);
    if (rec.voidedAt) throw fail(409, 'INVALID_STATE', 'A voided credit note cannot be issued');
    requireSendable(findFirm(s, rec.firmId), findClient(s, rec.clientId));
    issueCreditNoteRec(s, rec);
    return creditView(s, rec);
  },
  /** Apply Credit Note (docx §17.3): same client, at most the credit left and the invoice balance. */
  applyCredit: async (input: ApplyCreditInput): Promise<BillingCreditNote> => {
    await ready();
    const s = db();
    const note = findCreditNote(s, input.creditNoteId);
    const invoice = findInvoice(s, input.invoiceId);
    if (!input.confirmed) throw fail(400, 'VALIDATION_FAILED', 'Confirm the credit first');
    if (note.clientId !== invoice.clientId || note.firmId !== invoice.firmId)
      throw fail(400, 'VALIDATION_FAILED', 'The credit belongs to another customer');
    const credit = creditMoney(s, note);
    if (credit.status !== 'AVAILABLE' && credit.status !== 'PARTIALLY_APPLIED')
      throw fail(409, 'INVALID_STATE', 'This credit note has no credit to apply');
    if (invoice.voidedAt || !invoice.issuedAt)
      throw fail(409, 'INVALID_STATE', 'Credits apply to sent, open invoices only');
    const balance = invoiceMoney(s, invoice).balanceCents;
    if (!Number.isInteger(input.amountCents) || input.amountCents <= 0)
      throw fail(400, 'VALIDATION_FAILED', 'Enter an amount above 0');
    if (input.amountCents > credit.remainingCents)
      throw fail(422, 'AMOUNT_TOO_HIGH', 'The amount is more than the credit available');
    if (input.amountCents > balance)
      throw fail(422, 'AMOUNT_TOO_HIGH', 'The amount is more than the invoice balance');
    const at = nowIso();
    s.applications.push({
      id: nextId(s, '0b0e'),
      creditNoteId: note.id,
      invoiceId: invoice.id,
      amountCents: input.amountCents,
      at,
      by: ACTOR,
    });
    note.updatedAt = at;
    invoice.updatedAt = at;
    note.history.push(event(s, 'Applied', `Applied to ${invoice.number}`, input.amountCents, at));
    invoice.history.push(
      event(s, 'Credit applied', `${note.number} applied`, input.amountCents, at),
    );
    return creditView(s, note);
  },
  /** Refund Remaining Balance of a credit note. */
  refundCreditNote: async (
    id: string,
    input: { amountCents: number; reason: string; method: RefundMethod },
  ): Promise<BillingCreditNote> => {
    await ready();
    const s = db();
    const rec = findCreditNote(s, id);
    const credit = creditMoney(s, rec);
    if (credit.status !== 'AVAILABLE' && credit.status !== 'PARTIALLY_APPLIED')
      throw fail(409, 'INVALID_STATE', 'This credit note has nothing left to refund');
    if (!Number.isInteger(input.amountCents) || input.amountCents <= 0)
      throw fail(400, 'VALIDATION_FAILED', 'Enter an amount above 0');
    if (input.amountCents > credit.remainingCents)
      throw fail(422, 'AMOUNT_TOO_HIGH', 'The amount is more than the credit left');
    if (s.settings.payments.requireRefundReason && !input.reason.trim())
      throw fail(400, 'VALIDATION_FAILED', 'Enter a reason for the refund');
    const at = nowIso();
    s.creditRefunds.push({
      id: nextId(s, '0b0f'),
      creditNoteId: rec.id,
      amountCents: input.amountCents,
      reason: input.reason.trim(),
      method: input.method,
      at,
      by: ACTOR,
    });
    rec.updatedAt = at;
    rec.history.push(event(s, 'Refunded', input.reason.trim(), input.amountCents, at));
    return creditView(s, rec);
  },
  sendCreditNote: async (id: string): Promise<BillingCreditNote> => {
    await ready();
    const s = db();
    const rec = findCreditNote(s, id);
    if (!rec.issuedAt || rec.voidedAt)
      throw fail(409, 'INVALID_STATE', 'Only an issued credit note can be sent');
    const client = findClient(s, rec.clientId);
    requireSendable(findFirm(s, rec.firmId), client);
    rec.sentAt = nowIso();
    rec.history.push(event(s, 'Sent', `Sent to ${client.email}`));
    return creditView(s, rec);
  },
  /** Void keeps the number and history; refused once any of it was applied or refunded. */
  voidCreditNote: async (id: string, input: { reason: string }): Promise<BillingCreditNote> => {
    await ready();
    const s = db();
    const rec = findCreditNote(s, id);
    if (rec.voidedAt) throw fail(409, 'INVALID_STATE', 'This credit note is already voided');
    if (!input.reason.trim()) throw fail(400, 'VALIDATION_FAILED', 'Enter a reason for voiding');
    const credit = creditMoney(s, rec);
    if (credit.appliedCents + credit.refundedCents > 0)
      throw fail(409, 'HAS_PAYMENTS', 'Part of this credit was already applied or refunded');
    const at = nowIso();
    rec.voidedAt = at;
    rec.voidReason = input.reason.trim().slice(0, 500);
    rec.updatedAt = at;
    rec.history.push(event(s, 'Voided', `Voided: ${rec.voidReason}`, credit.totals.totalCents, at));
    return creditView(s, rec);
  },

  // Estimates --------------------------------------------------------------------------------
  estimates: async (query: EstimateQuery = {}): Promise<BillingPage<BillingEstimate>> => {
    await ready();
    const rows = filterEstimates(db(), query);
    const order: Record<EstimateSort, (row: BillingEstimate) => string | number> = {
      number: (row) => row.number,
      client: (row) => row.clientName,
      firm: (row) => row.firmName,
      issueDate: (row) => row.issueDate,
      expirationDate: (row) => row.expirationDate,
      amount: (row) => row.totalCents,
      status: (row) => row.status,
    };
    const sort = query.sort ?? 'issueDate';
    return pageOf(
      sorted(rows, order[sort], query.descending ?? !query.sort, (row) => row.number),
      query.page,
      query.pageSize,
    );
  },
  estimateSummary: async (query: EstimateQuery = {}): Promise<EstimateSummary> => {
    await ready();
    const rows = filterEstimates(db(), query);
    const pick = (statuses: EstimateStatus[]) => {
      const list = rows.filter((row) => statuses.includes(row.status));
      return { cents: sum(list.map((row) => row.totalCents)), count: list.length };
    };
    const approved = pick(['APPROVED', 'CONVERTED']);
    const pending = pick(['SENT', 'PENDING']);
    const declined = pick(['DECLINED']);
    return {
      totalCents: sum(rows.map((row) => row.totalCents)),
      totalCount: rows.length,
      approvedCents: approved.cents,
      approvedCount: approved.count,
      pendingCents: pending.cents,
      pendingCount: pending.count,
      declinedCents: declined.cents,
      declinedCount: declined.count,
    };
  },
  estimate: async (id: string): Promise<BillingEstimate> => {
    await ready();
    const s = db();
    return estimateView(s, findEstimate(s, id));
  },
  /** The firm's estimate terms, or the platform default from Billing Settings (docx §11.3). */
  estimateTerms: async (firmId: string): Promise<string> => {
    await ready();
    const s = db();
    return findFirm(s, firmId).estimateTerms ?? s.settings.general.termsAndConditions;
  },
  createEstimate: async (body: SaveEstimate): Promise<BillingEstimate> => {
    await ready();
    const s = db();
    return estimateView(s, saveEstimateRec(s, body));
  },
  updateEstimate: async (id: string, body: SaveEstimate): Promise<BillingEstimate> => {
    await ready();
    const s = db();
    return estimateView(s, saveEstimateRec(s, body, findEstimate(s, id)));
  },
  sendEstimate: async (id: string): Promise<BillingEstimate> => {
    await ready();
    const s = db();
    const rec = findEstimate(s, id);
    if (rec.state === 'CONVERTED' || rec.state === 'DECLINED')
      throw fail(409, 'INVALID_STATE', 'This estimate can no longer be sent');
    const client = findClient(s, rec.clientId);
    requireSendable(activeFirm(s, rec.firmId), client);
    const at = nowIso();
    if (rec.state === 'DRAFT') rec.state = 'SENT';
    rec.sentAt = at;
    rec.updatedAt = at;
    rec.history.push(event(s, 'Sent', `Emailed to ${rec.email || client.email}`, null, at));
    return estimateView(s, rec);
  },
  /** Approve, decline or reopen; Expired and Converted are derived, never set. */
  setEstimateStatus: async (id: string, status: EstimateSetStatus): Promise<BillingEstimate> => {
    await ready();
    const s = db();
    const rec = findEstimate(s, id);
    if (rec.state === 'CONVERTED')
      throw fail(409, 'ALREADY_CONVERTED', 'A converted estimate keeps its status');
    const at = nowIso();
    rec.state = status;
    rec.updatedAt = at;
    rec.history.push(event(s, 'Status changed', `Marked ${status.toLowerCase()}`, null, at));
    return estimateView(s, rec);
  },
  duplicateEstimate: async (id: string): Promise<BillingEstimate> => {
    await ready();
    const s = db();
    const source = findEstimate(s, id);
    const issueDate = todayIso();
    const copy = saveEstimateRec(s, {
      clientId: source.clientId,
      contactName: source.contactName,
      email: source.email,
      phone: source.phone,
      number: suggestNumber(s, 'estimate', issueDate, source.firmId),
      issueDate,
      expirationDate: addDays(issueDate, s.settings.general.estimateValidityDays),
      reference: source.reference,
      lines: source.lines.map(({ description, quantity, rateCents }) => ({
        description,
        quantity,
        rateCents,
      })),
      discountCents: source.discountCents,
      taxRateId: source.taxRateId,
      notes: source.notes,
      terms: source.terms,
      status: 'DRAFT',
      sendNotification: source.sendNotification,
      template: source.template,
      assignedToId: source.assignedToId,
      send: false,
    });
    copy.history.push(event(s, 'Duplicated', `Copied from ${source.number}`));
    return estimateView(s, copy);
  },
  /** Removes an estimate that never became an invoice. */
  deleteEstimate: async (id: string): Promise<void> => {
    await ready();
    const s = db();
    const rec = findEstimate(s, id);
    if (rec.convertedInvoiceId)
      throw fail(409, 'ALREADY_CONVERTED', 'A converted estimate stays linked to its invoice');
    s.estimates = s.estimates.filter((row) => row.id !== id);
  },
  /**
   * Convert to Invoice: the Create Invoice form prefilled from the estimate. Saving it with
   * `estimateId` links both and marks the estimate Converted (docx §10.2).
   */
  estimateToInvoice: async (id: string): Promise<SaveInvoice> => {
    await ready();
    const s = db();
    const rec = findEstimate(s, id);
    const status = estimateStatus(rec);
    if (rec.convertedInvoiceId && !s.settings.invoices.allowDuplicateConversion)
      throw fail(409, 'ALREADY_CONVERTED', 'This estimate was already converted to an invoice');
    if (status === 'DRAFT' || status === 'DECLINED' || status === 'EXPIRED')
      throw fail(409, 'INVALID_STATE', 'Only a sent or approved estimate can be converted');
    const firm = activeFirm(s, rec.firmId);
    const issueDate = todayIso();
    const copyAll = s.settings.invoices.conversion === 'COPY_ALL';
    return {
      firmId: firm.id,
      clientId: rec.clientId,
      number: suggestNumber(s, 'invoice', issueDate, firm.id),
      issueDate,
      dueDate: addDays(issueDate, PAYMENT_TERM_DAYS[firm.paymentTerms]),
      type: 'STANDARD',
      currency: firm.currency,
      paymentTerms: firm.paymentTerms,
      reference: copyAll ? rec.reference || `Estimate ${rec.number}` : `Estimate ${rec.number}`,
      notes: copyAll ? rec.notes : '',
      lines: rec.lines.map((line) => ({
        description: line.description,
        quantity: line.quantity,
        rateCents: line.rateCents,
        taxRateId: rec.taxRateId,
      })),
      discountCents: rec.discountCents,
      allowOnlinePayment: s.settings.invoices.onlinePaymentDefault,
      send: false,
      estimateId: rec.id,
      attachments: [],
      keepAttachmentIds: [],
    };
  },

  // Recurring --------------------------------------------------------------------------------
  recurringSchedules: async (
    query: RecurringQuery = {},
  ): Promise<BillingPage<BillingRecurring>> => {
    await ready();
    const rows = filterRecurring(db(), query);
    const order: Record<RecurringSort, (row: BillingRecurring) => string | number> = {
      client: (row) => row.clientName,
      template: (row) => row.template,
      frequency: (row) => RECURRING_FREQUENCIES.indexOf(row.frequency),
      amount: (row) => row.amountCents,
      nextInvoiceDate: (row) => row.nextInvoiceDate,
      status: (row) => row.status,
    };
    return pageOf(
      sorted(rows, order[query.sort ?? 'client'], query.descending ?? false, (row) => row.id),
      query.page,
      query.pageSize,
    );
  },
  /** The All / Active / Paused / Canceled tab counts, for the other filters. */
  recurringCounts: async (query: RecurringQuery = {}): Promise<RecurringCounts> => {
    await ready();
    const rows = filterRecurring(db(), query, false);
    const count = (status: RecurringStatus) => rows.filter((row) => row.status === status).length;
    return {
      all: rows.length,
      active: count('ACTIVE'),
      paused: count('PAUSED'),
      canceled: count('CANCELED'),
    };
  },
  recurringSchedule: async (id: string): Promise<BillingRecurring> => {
    await ready();
    const s = db();
    return recurringView(s, findRecurring(s, id));
  },
  createRecurring: async (body: SaveRecurring): Promise<BillingRecurring> => {
    await ready();
    const s = db();
    return recurringView(s, saveRecurringRec(s, body));
  },
  updateRecurring: async (id: string, body: SaveRecurring): Promise<BillingRecurring> => {
    await ready();
    const s = db();
    return recurringView(s, saveRecurringRec(s, body, findRecurring(s, id)));
  },
  /** Pause, resume or cancel. */
  setRecurringStatus: async (id: string, status: RecurringStatus): Promise<BillingRecurring> => {
    await ready();
    const s = db();
    const rec = findRecurring(s, id);
    if (rec.status === 'CANCELED' && status !== 'CANCELED')
      throw fail(409, 'INVALID_STATE', 'A canceled schedule cannot be restarted');
    rec.status = status;
    rec.updatedAt = nowIso();
    rec.history.push(event(s, statusAction(status), rec.template));
    return recurringView(s, rec);
  },
  /** Generates the invoice for the next occurrence now (once per occurrence). */
  runRecurring: async (id: string): Promise<InvoiceDetail> => {
    await ready();
    const s = db();
    const rec = findRecurring(s, id);
    if (rec.status !== 'ACTIVE')
      throw fail(409, 'INVALID_STATE', 'Only an active schedule generates invoices');
    if (rec.endDate && rec.nextInvoiceDate > rec.endDate)
      throw fail(409, 'INVALID_STATE', 'This schedule has ended');
    return invoiceDetail(s, generateFromSchedule(s, rec));
  },

  // Settings ---------------------------------------------------------------------------------
  settings: async (): Promise<BillingSettings> => {
    await ready();
    return clone(db().settings);
  },
  /** Saves the whole settings object; the Owner always keeps Edit Billing Settings. */
  updateSettings: async (next: BillingSettings): Promise<BillingSettings> => {
    await ready();
    const s = db();
    const errors = settingsErrors(next);
    if (hasErrors(errors)) throw fail(400, 'VALIDATION_FAILED', firstMessage(errors));
    const settings = clone(next);
    if (!settings.permissions.EDIT_SETTINGS.includes('OWNER'))
      settings.permissions.EDIT_SETTINGS.unshift('OWNER');
    settings.updatedAt = nowIso();
    settings.updatedBy = ACTOR;
    s.settings = settings;
    return clone(settings);
  },
};

/** The client's type, for components that take it as a prop. */
export type AdminBillingClient = typeof adminBilling;
