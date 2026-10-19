import {
  ApiRequestError,
  type BillingCreditNote as ApiCredit,
  type BillingEstimate as ApiEstimate,
  type BillingEvent as ApiEvent,
  type BillingFirm as ApiFirm,
  type BillingInvoice as ApiInvoice,
  type BillingInvoiceDetail as ApiInvoiceDetail,
  type BillingLine as ApiLine,
  type BillingPayment as ApiPayment,
  type BillingRecurring as ApiRecurring,
  type BillingSettings as ApiSettings,
} from '@firmivra/types';
import { api } from '../../../../../lib/api';
import { mocked } from '../../../../../lib/mock';
import {
  adminBilling as mockBilling,
  BILLING_CAPABILITIES,
  type BillingAdmin,
  type BillingClient,
  type BillingCreditNote,
  type BillingDocument,
  type BillingDocumentKind,
  type BillingEstimate,
  type BillingEvent,
  type BillingFile,
  type BillingFirm,
  type BillingInvoice,
  type BillingItem,
  type BillingPage,
  type BillingPayment,
  type BillingRecurring,
  type BillingSettings,
  type CreditNoteQuery,
  type CreditNoteSummary,
  type EstimateQuery,
  type EstimateSetStatus,
  type EstimateSummary,
  type InvoiceDetail,
  type InvoiceLine,
  type InvoiceQuery,
  type InvoiceSummary,
  type NumberKind,
  PAYMENT_TERM_DAYS,
  type PaymentMethod,
  type PaymentQuery,
  type PaymentSummary,
  type PaymentTerms,
  type RecordPaymentInput,
  type RecurringCounts,
  type RecurringFrequency,
  type RecurringQuery,
  type RecurringStatus,
  type RefundInput,
  type RefundMethod,
  type SaveCreditNote,
  type SaveEstimate,
  type SaveInvoice,
  type SaveRecurring,
  TEMPLATE_KINDS,
  type ApplyCreditInput,
} from '../../../../../mocks/admin-billing';
import {
  adminBillingSettings as mockSettings,
  billingSettingsErrors,
} from '../../../../../mocks/admin-billing-settings';

// The Billing screens' data (R60): `api.adminBilling` (contract packages/types/src/admin-billing),
// under the method names and shapes the screens were built with. Mock mode
// (NEXT_PUBLIC_API_MOCK=adminBilling) keeps mocks/admin-billing.ts. What differs from the mock
// (docs/work/R60-billing.md) is handled here:
// - Firmivra bills firms: each firm has one "client", its billing contact (id = the firm's id).
// - USD only; invoice type is not stored (Standard); terms are worked out from the due date.
// - Tax is per line in percent: the settings' one default rate is the "Default tax" rate.
// - The payment methods and recurring frequencies are the database's (mapped to the mock's names).
// - Documents are rendered in the browser from the API's record (the API has no PDFs yet).
// - Emails (receipts, credit notes) and invoice attachments are not available yet: 422.

const notYet = (message: string) => new ApiRequestError(422, 'NOT_SUPPORTED_YET', message);
const DEFAULT_TAX = 'default';

// ---------- Names ----------

const METHOD_IN: Record<PaymentMethod, 'CARD' | 'ACH' | 'WIRE' | 'CHECK' | 'CASH' | 'OTHER'> = {
  CREDIT_CARD: 'CARD',
  ACH: 'ACH',
  BANK_TRANSFER: 'WIRE',
  CHECK: 'CHECK',
  CASH: 'CASH',
  MANUAL: 'OTHER',
};
const methodOut = (m: ApiPayment['method']): PaymentMethod =>
  m === 'CARD'
    ? 'CREDIT_CARD'
    : m === 'WIRE'
      ? 'BANK_TRANSFER'
      : m === 'OTHER' || m === 'CREDIT_BALANCE'
        ? 'MANUAL'
        : m;
const FREQ_IN: Record<RecurringFrequency, ApiRecurring['frequency']> = {
  WEEKLY: 'WEEKLY',
  MONTHLY: 'MONTHLY',
  QUARTERLY: 'QUARTERLY',
  SEMIANNUALLY: 'SEMIANNUAL',
  ANNUALLY: 'ANNUAL',
  CUSTOM: 'CUSTOM',
};
const freqOut = (f: ApiRecurring['frequency']): RecurringFrequency =>
  f === 'SEMIANNUAL' ? 'SEMIANNUALLY' : f === 'ANNUAL' ? 'ANNUALLY' : f;
const nearestTerms = (days: number): PaymentTerms =>
  (Object.entries(PAYMENT_TERM_DAYS) as [PaymentTerms, number][]).reduce((best, cur) =>
    Math.abs(cur[1] - days) < Math.abs(best[1] - days) ? cur : best,
  )[0];
const EMPTY_ADDRESS = { line1: '', line2: '', city: '', state: '', zip: '' };

// ---------- Reference data ----------

let defaultTaxPercent = 0;
let footer = '';
let termDays = 30;

function firmOut(f: ApiFirm): BillingFirm {
  return {
    id: f.id,
    slug: f.slug,
    name: f.name,
    status: f.status === 'ACTIVE' || f.status === 'PENDING_SETUP' ? f.status : 'SUSPENDED',
    email: f.contactEmail,
    phone: f.contactPhone,
    address: EMPTY_ADDRESS,
    currency: 'USD',
    paymentTerms: nearestTerms(f.paymentTermDays ?? termDays),
    defaultTaxRateId: f.taxExempt ? null : DEFAULT_TAX,
    invoiceFooter: footer,
    paymentInstructions: '',
    estimateTerms: null,
    setupComplete: f.canBill,
  };
}
/** The firm's one "client": its billing contact (the id is the firm's). */
function clientOut(f: ApiFirm): BillingClient {
  return {
    id: f.id,
    firmId: f.id,
    number: 0,
    name: f.name,
    contactName: f.contactName,
    email: f.contactEmail,
    phone: f.contactPhone,
    address: EMPTY_ADDRESS,
    shipTo: null,
  };
}
async function loadFirms(): Promise<ApiFirm[]> {
  return (await api.adminBilling.firms()).filter((f) => f.status !== 'CLOSED');
}

const eventOut = (e: ApiEvent): BillingEvent => ({ ...e });
const taxIdOf = (percent: number) =>
  percent > 0 && percent === defaultTaxPercent ? DEFAULT_TAX : null;
const lineOut = (l: ApiLine): InvoiceLine => ({
  id: l.id,
  description: l.description,
  quantity: l.quantity,
  rateCents: l.rateCents,
  taxRateId: taxIdOf(l.taxPercent),
  taxPercent: l.taxPercent,
  amountCents: l.amountCents,
  taxCents: l.taxCents,
});
const percentOf = (taxRateId: string | null) => (taxRateId ? defaultTaxPercent : 0);

// ---------- Documents ----------

function invoiceOut(i: ApiInvoice): BillingInvoice {
  return {
    id: i.id,
    number: i.number,
    firmId: i.firmId,
    firmName: i.firmName,
    clientId: i.firmId,
    clientName: i.billToName,
    type: 'STANDARD',
    currency: 'USD',
    paymentTerms: i.paymentTerms ?? 'NET_30',
    issueDate: i.issueDate,
    dueDate: i.dueDate,
    reference: i.reference,
    notes: i.notes,
    lines: i.lines.map(lineOut),
    subtotalCents: i.subtotalCents,
    discountCents: i.discountCents,
    taxCents: i.taxCents,
    totalCents: i.totalCents,
    paidCents: i.paidCents,
    refundedCents: i.refundedCents,
    creditedCents: i.creditedCents,
    balanceCents: i.balanceCents,
    status: i.status,
    allowOnlinePayment: i.allowOnlinePayment,
    recurringScheduleId: i.recurringId,
    estimateId: i.estimateId,
    estimateNumber: i.estimateNumber,
    attachments: [],
    issuedAt: i.sentAt,
    sentAt: i.sendStatus === 'SENT' ? i.sentAt : null,
    sendStatus: i.sendStatus,
    voidedAt: i.voidedAt,
    voidReason: i.voidReason,
    createdAt: i.createdAt,
    updatedAt: i.updatedAt,
    createdBy: i.createdBy,
    history: [],
  };
}

function paymentOut(p: ApiPayment): BillingPayment {
  return {
    id: p.id,
    /** B3 numbers no receipts: the receipt is the invoice's. */
    number: p.invoiceNumber,
    invoiceId: p.invoiceId,
    invoiceNumber: p.invoiceNumber,
    firmId: p.firmId,
    firmName: p.firmName,
    clientId: p.firmId,
    clientName: p.billToName,
    currency: 'USD',
    amountCents: p.amountCents,
    paidOn: p.paidOn,
    method: methodOut(p.method),
    reference: p.reference,
    processor: 'Recorded by hand',
    status: p.status,
    refundedCents: p.refundedCents,
    refundableCents: p.refundableCents,
    refunds: p.refunds.map((r) => ({
      id: r.id,
      paymentId: r.paymentId,
      amountCents: r.amountCents,
      type: r.type,
      reason: r.reason,
      notes: r.notes,
      method: r.method,
      at: r.at,
      by: r.by,
      confirmation: p.invoiceNumber,
    })),
    notes: p.notes,
    failureReason: p.failureReason,
    recordedBy: p.recordedBy,
    recordedAt: p.recordedAt,
    receiptSentAt: p.receiptSentAt,
  };
}

function detailOut(d: ApiInvoiceDetail): InvoiceDetail {
  const documents: BillingDocument[] = [
    {
      id: `${d.id}-invoice`,
      kind: 'INVOICE',
      refId: d.id,
      fileName: `${d.number}.pdf`,
      description: 'Generated',
      date: d.sentAt ?? d.createdAt,
    },
    ...d.payments.map((p) => ({
      id: `${p.id}-receipt`,
      kind: 'RECEIPT' as const,
      refId: p.id,
      fileName: `Receipt-${d.number}.pdf`,
      description: 'Payment receipt',
      date: p.recordedAt,
    })),
  ];
  return {
    ...invoiceOut(d),
    history: d.history.map(eventOut),
    firm: firmOut(d.firm),
    client: clientOut(d.firm),
    payments: d.payments.map(paymentOut),
    credits: d.credits,
    documents,
    schedule: d.schedule ? { id: d.schedule.id, template: d.schedule.description } : null,
  };
}

function estimateOut(e: Omit<ApiEstimate, 'history'> & { history?: ApiEvent[] }): BillingEstimate {
  const taxPercent = e.lines.find((l) => l.taxPercent > 0)?.taxPercent ?? 0;
  return {
    id: e.id,
    number: e.number,
    firmId: e.firmId,
    firmName: e.firmName,
    clientId: e.firmId,
    clientName: e.contactName,
    contactName: e.contactName,
    email: e.email,
    phone: e.phone,
    currency: 'USD',
    issueDate: e.issueDate,
    expirationDate: e.expirationDate,
    reference: e.reference,
    lines: e.lines.map((l) => ({
      id: l.id,
      description: l.description,
      quantity: l.quantity,
      rateCents: l.rateCents,
      amountCents: l.amountCents,
    })),
    subtotalCents: e.subtotalCents,
    discountCents: e.discountCents,
    taxRateId: taxIdOf(taxPercent),
    taxPercent,
    taxCents: e.taxCents,
    totalCents: e.totalCents,
    notes: e.notes,
    terms: '',
    status: e.status,
    sendNotification: true,
    template: 'STANDARD',
    assignedToId: e.assignedToId,
    assignedToName: e.assignedToName,
    convertedInvoiceId: e.convertedInvoiceId,
    convertedInvoiceNumber: e.convertedInvoiceNumber,
    sentAt: e.sentAt,
    createdBy: e.createdBy,
    createdAt: e.createdAt,
    updatedAt: e.updatedAt,
    history: (e.history ?? []).map(eventOut),
  };
}

function creditOut(c: Omit<ApiCredit, 'history'> & { history?: ApiEvent[] }): BillingCreditNote {
  return {
    id: c.id,
    number: c.number,
    firmId: c.firmId,
    firmName: c.firmName,
    clientId: c.firmId,
    clientName: c.firmName,
    invoiceId: c.invoiceId,
    invoiceNumber: c.invoiceNumber,
    currency: 'USD',
    date: c.date,
    reason: c.reason,
    method: c.method,
    lines: c.lines.map((l) => ({
      id: l.id,
      item: l.description,
      description: l.description,
      quantity: l.quantity,
      unitPriceCents: l.rateCents,
      taxRateId: taxIdOf(l.taxPercent),
      taxPercent: l.taxPercent,
      amountCents: l.amountCents,
      taxCents: l.taxCents,
    })),
    adjustmentCents: c.method === 'ADJUSTMENT' ? c.totalCents : 0,
    subtotalCents: c.subtotalCents,
    taxCents: c.taxCents,
    totalCents: c.totalCents,
    appliedCents: c.appliedCents,
    refundedCents: c.refundedCents,
    remainingCents: c.remainingCents,
    keepAvailable: true,
    internalNote: c.internalNote,
    customerNote: c.customerNote,
    status: c.status,
    issuedAt: c.issuedAt,
    sentAt: null,
    voidedAt: c.voidedAt,
    voidReason: c.voidReason,
    applications: c.applications,
    refunds: [],
    createdBy: c.createdBy,
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
    history: (c.history ?? []).map(eventOut),
  };
}

function recurringOut(
  r: Omit<ApiRecurring, 'history' | 'invoices'> & {
    history?: ApiEvent[];
    invoices?: ApiRecurring['invoices'];
  },
  contactName = r.firmName,
): BillingRecurring {
  return {
    id: r.id,
    firmId: r.firmId,
    firmName: r.firmName,
    clientId: r.firmId,
    clientName: contactName,
    clientNumber: 0,
    template: r.template,
    description: r.description,
    frequency: freqOut(r.frequency),
    customIntervalDays: r.customIntervalDays,
    amountCents: r.amountCents,
    currency: 'USD',
    startDate: r.startDate,
    nextInvoiceDate: r.nextInvoiceDate ?? '',
    endDate: r.endDate,
    autoSend: r.autoSend,
    allowOnlinePayment: true,
    status: r.status,
    invoiceIds: (r.invoices ?? []).map((i) => i.id),
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
    history: (r.history ?? []).map(eventOut),
  };
}

// ---------- Queries ----------

const pageQuery = <
  Q extends {
    firmId?: string;
    clientId?: string;
    search?: string;
    from?: string;
    to?: string;
    descending?: boolean;
    page?: number;
    pageSize?: number;
  },
>(
  q: Q,
) => ({
  firmId: q.firmId ?? q.clientId,
  search: q.search || undefined,
  from: q.from,
  to: q.to,
  descending: q.descending,
  page: q.page,
  pageSize: q.pageSize,
});
const sortIn = <S extends string>(
  sort: string | undefined,
  allowed: readonly S[],
): S | undefined =>
  sort === 'client'
    ? allowed.includes('firm' as S)
      ? ('firm' as S)
      : undefined
    : allowed.includes(sort as S)
      ? (sort as S)
      : undefined;

const invoiceQuery = (q: InvoiceQuery) => ({
  ...pageQuery(q),
  status: q.status ? [q.status] : undefined,
  dueFrom: q.dueFrom,
  dueTo: q.dueTo,
  minCents: q.minCents,
  maxCents: q.maxCents,
  sort: sortIn(q.sort, ['number', 'firm', 'issueDate', 'dueDate', 'amount', 'status'] as const),
});
const paymentQuery = (q: PaymentQuery) => ({
  ...pageQuery(q),
  status: q.status ? [q.status] : undefined,
  method: q.method ? [METHOD_IN[q.method]] : undefined,
  invoiceId: q.invoiceId,
  sort: sortIn(q.sort, ['paidOn', 'firm', 'invoice', 'amount', 'method', 'status'] as const),
});
const estimateQuery = (q: EstimateQuery) => ({
  ...pageQuery(q),
  status: q.status ? [q.status] : undefined,
  sort: sortIn(q.sort, [
    'number',
    'firm',
    'issueDate',
    'expirationDate',
    'amount',
    'status',
  ] as const),
});
const creditQuery = (q: CreditNoteQuery) => ({
  ...pageQuery(q),
  status: q.status ? [q.status] : undefined,
  invoiceId: q.invoiceId,
  sort: sortIn(q.sort, [
    'number',
    'firm',
    'invoice',
    'date',
    'amount',
    'applied',
    'remaining',
    'status',
  ] as const),
});
const recurringQuery = (q: RecurringQuery) => ({
  ...pageQuery(q),
  status: q.status ? [q.status] : undefined,
  sort: sortIn(q.sort, [
    'firm',
    'template',
    'frequency',
    'amount',
    'nextInvoiceDate',
    'status',
  ] as const),
});
const mapPage = <A, B>(
  p: { items: A[]; total: number; page: number; pageSize: number; pageCount: number },
  f: (a: A) => B,
): BillingPage<B> => ({
  ...p,
  items: p.items.map(f),
});

// ---------- Saves ----------

function invoiceIn(body: SaveInvoice) {
  if (body.attachments.length > 0)
    throw notYet('Invoice attachments cannot be saved yet. Remove the files to save.');
  return {
    firmId: body.firmId || body.clientId,
    issueDate: body.issueDate,
    dueDate: body.dueDate,
    reference: body.reference,
    notes: body.notes,
    lines: body.lines.map((l) => ({
      description: l.description,
      quantity: l.quantity,
      rateCents: l.rateCents,
      taxPercent: percentOf(l.taxRateId),
    })),
    discountCents: body.discountCents,
    allowOnlinePayment: body.allowOnlinePayment,
    send: body.send,
    emailFirm: body.emailClient ?? true,
    estimateId: body.estimateId,
  };
}
function estimateIn(body: SaveEstimate) {
  const taxPercent = percentOf(body.taxRateId);
  return {
    firmId: body.clientId,
    contactName: body.contactName,
    email: body.email,
    phone: body.phone,
    issueDate: body.issueDate,
    expirationDate: body.expirationDate,
    reference: body.reference,
    lines: body.lines.map((l) => ({
      description: l.description,
      quantity: l.quantity,
      rateCents: l.rateCents,
      taxPercent,
    })),
    discountCents: body.discountCents,
    // The estimate's terms are kept with its notes (B3 has one notes field).
    notes: [body.notes, body.terms]
      .map((s) => s.trim())
      .filter(Boolean)
      .join('\n\n'),
    assignedToId: body.assignedToId,
    send: body.send || body.status === 'SENT',
    emailFirm: body.sendNotification,
  };
}
function creditIn(body: SaveCreditNote) {
  return {
    firmId: body.clientId,
    invoiceId: body.invoiceId,
    date: body.date,
    reason: body.reason,
    method: body.method,
    lines: body.lines.map((l) => ({
      description: l.description.trim() || l.item,
      quantity: l.quantity,
      rateCents: l.unitPriceCents,
      taxPercent: percentOf(l.taxRateId),
    })),
    adjustmentCents: body.adjustmentCents,
    internalNote: body.internalNote,
    customerNote: body.customerNote,
    issue: body.issue,
  };
}
const recurringIn = (body: SaveRecurring) => ({
  firmId: body.clientId,
  template: body.template,
  description: body.description,
  frequency: FREQ_IN[body.frequency],
  customIntervalDays: body.frequency === 'CUSTOM' ? body.customIntervalDays : null,
  amountCents: body.amountCents,
  startDate: body.startDate,
  nextInvoiceDate: body.nextInvoiceDate,
  endDate: body.endDate,
  autoSend: body.autoSend,
});

// ---------- Settings ----------

let lastSettings: BillingSettings | undefined;
let shipped: BillingSettings | undefined;

function settingsOut(s: ApiSettings): BillingSettings {
  defaultTaxPercent = s.taxes.defaultTaxPercent;
  footer = s.general.footerNote;
  termDays = PAYMENT_TERM_DAYS[s.general.invoiceTerms];
  const p = s.preferences;
  const out: BillingSettings = {
    general: {
      currency: 'USD',
      language: p.language,
      invoiceTerms: s.general.invoiceTerms,
      estimateValidityDays: s.general.estimateValidityDays,
      timeZone: p.timeZone,
      dateFormat: p.dateFormat,
      decimalPrecision: 2,
      rounding: 'STANDARD',
      enableCreditNotes: p.enableCreditNotes,
      enableEstimates: p.enableEstimates,
      enablePartialPayments: s.general.enablePartialPayments,
      enableLateFees: s.taxes.lateFee.enabled,
      requirePurchaseOrder: p.requirePurchaseOrder,
      requireTax: false,
      termsAndConditions: p.termsAndConditions,
      footerNote: s.general.footerNote,
      platformNotes: '',
    },
    invoices: {
      defaultInvoiceType: 'STANDARD',
      defaultTaxRateId: s.taxes.defaultTaxPercent > 0 ? DEFAULT_TAX : null,
      discountBeforeTax: p.discountBeforeTax,
      allowAttachments: false,
      maxAttachmentMb: 10,
      attachmentTypes: ['.pdf'],
      onlinePaymentDefault: p.onlinePaymentDefault,
      sendNowDefault: true,
      estimateTemplate: 'STANDARD',
      conversion: 'COPY_ALL',
      allowDuplicateConversion: false,
    },
    payments: {
      methods: ['CREDIT_CARD', 'ACH', 'BANK_TRANSFER', 'CHECK', 'CASH', 'MANUAL'],
      allowOverpayments: false,
      autoPay: false,
      sendReceipts: p.sendReceipts,
      requireRefundReason: p.requireRefundReason,
      processor: 'MANUAL_ONLY',
    },
    taxes: {
      mode: p.taxMode,
      rates: [{ id: DEFAULT_TAX, name: 'Default tax', ratePercent: s.taxes.defaultTaxPercent }],
      serviceFee: { enabled: false, type: 'PERCENT', amount: 0 },
      lateFee: {
        enabled: s.taxes.lateFee.enabled,
        type: 'PERCENT',
        amount: s.taxes.lateFee.percent,
        graceDays: s.taxes.lateFee.graceDays,
      },
      firmsMayOverride: p.firmsMayOverride,
    },
    reminders: { ...s.reminders, firmsMayOverride: p.firmsMayOverride },
    templates: Object.fromEntries(
      TEMPLATE_KINDS.map((k) => [k, { ...s.templates[k], firmOverride: false }]),
    ) as BillingSettings['templates'],
    numbering: {
      invoice: { format: `${s.numbering.invoice.prefix}{####}`, next: s.numbering.invoice.next },
      estimate: { format: `${s.numbering.estimate.prefix}{####}`, next: s.numbering.estimate.next },
      creditNote: {
        format: `${s.numbering.creditNote.prefix}{####}`,
        next: s.numbering.creditNote.next,
      },
      resetRule: 'NEVER',
      perFirm: false,
    },
    permissions: Object.fromEntries(
      BILLING_CAPABILITIES.map((c) => [c, ['OWNER']]),
    ) as BillingSettings['permissions'],
    updatedAt: s.updatedAt ?? '',
    updatedBy: s.updatedBy ?? 'Firmivra',
  };
  lastSettings = out;
  shipped ??= structuredClone(out);
  return out;
}

/** The parts of the page the database does not keep must stay as they read. */
function unchangedOnly(next: BillingSettings) {
  const was = lastSettings;
  if (!was) return;
  const fixed: [string, unknown, unknown][] = [
    ['Currency', next.general.currency, was.general.currency],
    ['Decimal precision', next.general.decimalPrecision, was.general.decimalPrecision],
    ['Rounding', next.general.rounding, was.general.rounding],
    ['Require tax', next.general.requireTax, was.general.requireTax],
    ['Platform notes', next.general.platformNotes, was.general.platformNotes],
    [
      'Invoice defaults',
      {
        ...next.invoices,
        defaultTaxRateId: null,
        discountBeforeTax: null,
        onlinePaymentDefault: null,
      },
      {
        ...was.invoices,
        defaultTaxRateId: null,
        discountBeforeTax: null,
        onlinePaymentDefault: null,
      },
    ],
    [
      'Payment methods and processing',
      { ...next.payments, sendReceipts: null, requireRefundReason: null },
      { ...was.payments, sendReceipts: null, requireRefundReason: null },
    ],
    ['Tax rates', next.taxes.rates.map((r) => r.id), was.taxes.rates.map((r) => r.id)],
    ['Service fee', next.taxes.serviceFee, was.taxes.serviceFee],
    ['Late fee type', next.taxes.lateFee.type, was.taxes.lateFee.type],
    ['Numbering', next.numbering, was.numbering],
    ['Permissions', next.permissions, was.permissions],
  ];
  const changed = fixed.find(([, a, b]) => JSON.stringify(a) !== JSON.stringify(b));
  if (changed) throw notYet(`${changed[0]} cannot be changed yet`);
}

function settingsIn(next: BillingSettings) {
  unchangedOnly(next);
  const g = next.general;
  return {
    general: {
      currency: 'USD' as const,
      invoiceTerms: g.invoiceTerms,
      estimateValidityDays: g.estimateValidityDays,
      enablePartialPayments: g.enablePartialPayments,
      footerNote: g.footerNote,
    },
    taxes: {
      defaultTaxPercent: next.taxes.rates.find((r) => r.id === DEFAULT_TAX)?.ratePercent ?? 0,
      lateFee: {
        enabled: g.enableLateFees && next.taxes.lateFee.enabled,
        percent: next.taxes.lateFee.amount,
        graceDays: next.taxes.lateFee.graceDays,
      },
    },
    reminders: {
      invoiceDue: next.reminders.invoiceDue,
      overdue: next.reminders.overdue,
      estimateExpiring: next.reminders.estimateExpiring,
      failedPayment: next.reminders.failedPayment,
    },
    templates: Object.fromEntries(
      TEMPLATE_KINDS.map((k) => {
        const t = next.templates[k];
        return [k, { name: t.name, subject: t.subject, body: t.body }];
      }),
    ) as ApiSettings['templates'],
    preferences: {
      language: g.language,
      timeZone: g.timeZone,
      dateFormat: g.dateFormat,
      enableCreditNotes: g.enableCreditNotes,
      enableEstimates: g.enableEstimates,
      requirePurchaseOrder: g.requirePurchaseOrder,
      termsAndConditions: g.termsAndConditions,
      discountBeforeTax: next.invoices.discountBeforeTax,
      onlinePaymentDefault: next.invoices.onlinePaymentDefault,
      sendReceipts: next.payments.sendReceipts,
      requireRefundReason: next.payments.requireRefundReason,
      taxMode: next.taxes.mode,
      firmsMayOverride: next.taxes.firmsMayOverride && next.reminders.firmsMayOverride,
    },
  };
}

// ---------- PDFs (rendered in the browser from the API's record) ----------

const money = (cents: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cents / 100);
const pad = (n: number, width: number) => String(n).padStart(width, '0');

/** A one-page PDF with the given lines. */
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
const FIRMIVRA_LINES = ['Firmivra'];

async function documentFile(kind: BillingDocumentKind, refId: string): Promise<BillingFile> {
  switch (kind) {
    case 'INVOICE': {
      const i = await api.adminBilling.invoice(refId);
      return {
        fileName: `${i.number}.pdf`,
        blob: pdfBlob(`Invoice ${i.number}`, [
          ...FIRMIVRA_LINES,
          '',
          `Invoice date: ${i.issueDate}   Due date: ${i.dueDate}`,
          `Reference: ${i.reference || '-'}`,
          '',
          `Bill to: ${i.firmName}, ${i.billToName}`,
          i.billToEmail,
          '',
          ...i.lines.map(
            (l) =>
              `${l.description}   ${l.quantity} x ${money(l.rateCents)} = ${money(l.amountCents)}`,
          ),
          '',
          `Subtotal: ${money(i.subtotalCents)}`,
          `Discount: ${money(i.discountCents)}`,
          `Tax: ${money(i.taxCents)}`,
          `Total: ${money(i.totalCents)}`,
          `Paid: ${money(i.paidCents - i.refundedCents)}   Credits: ${money(i.creditedCents)}`,
          `Balance due: ${money(i.balanceCents)}`,
          '',
          i.notes,
          footer,
        ]),
      };
    }
    case 'ESTIMATE': {
      const e = await api.adminBilling.estimate(refId);
      return {
        fileName: `${e.number}.pdf`,
        blob: pdfBlob(`Estimate ${e.number}`, [
          ...FIRMIVRA_LINES,
          '',
          `For: ${e.firmName}, ${e.contactName}`,
          `Issued: ${e.issueDate}   Expires: ${e.expirationDate}`,
          '',
          ...e.lines.map(
            (l) =>
              `${l.description}   ${l.quantity} x ${money(l.rateCents)} = ${money(l.amountCents)}`,
          ),
          '',
          `Subtotal: ${money(e.subtotalCents)}   Discount: ${money(e.discountCents)}`,
          `Tax: ${money(e.taxCents)}   Total: ${money(e.totalCents)}`,
          '',
          ...e.notes.split('\n'),
        ]),
      };
    }
    case 'CREDIT_NOTE': {
      const c = await api.adminBilling.creditNote(refId);
      return {
        fileName: `${c.number}.pdf`,
        blob: pdfBlob(`Credit Note ${c.number}`, [
          ...FIRMIVRA_LINES,
          '',
          `Customer: ${c.firmName}`,
          `Date: ${c.date}   Related invoice: ${c.invoiceNumber ?? '-'}`,
          '',
          `Credit amount: ${money(c.totalCents)}`,
          `Applied: ${money(c.appliedCents)}   Refunded: ${money(c.refundedCents)}`,
          `Remaining: ${money(c.remainingCents)}`,
          '',
          c.customerNote,
        ]),
      };
    }
    case 'RECEIPT': {
      const p = await api.adminBilling.payment(refId);
      return {
        fileName: `Receipt-${p.invoiceNumber}.pdf`,
        blob: pdfBlob(`Receipt for ${p.invoiceNumber}`, [
          ...FIRMIVRA_LINES,
          '',
          `Received from: ${p.firmName}, ${p.billToName}`,
          `Invoice: ${p.invoiceNumber}`,
          `Amount: ${money(p.amountCents)}`,
          `Date: ${p.paidOn}   Method: ${methodOut(p.method)}   Reference: ${p.reference || '-'}`,
          '',
          'Thank you for your payment.',
        ]),
      };
    }
    default:
      throw notYet('This document cannot be downloaded yet');
  }
}

// ---------- The client the screens call ----------

const real = {
  firms: async (): Promise<BillingFirm[]> => (await loadFirms()).map(firmOut),
  firm: async (id: string): Promise<BillingFirm> => firmOut(await api.adminBilling.firm(id)),
  clients: async (query: { firmId?: string; search?: string } = {}): Promise<BillingClient[]> => {
    const words = (query.search ?? '').toLowerCase().split(/\s+/).filter(Boolean);
    return (await loadFirms())
      .filter((f) => !query.firmId || f.id === query.firmId)
      .map(clientOut)
      .filter((c) =>
        words.every((w) => `${c.name} ${c.contactName} ${c.email}`.toLowerCase().includes(w)),
      );
  },
  client: async (id: string): Promise<BillingClient> => clientOut(await api.adminBilling.firm(id)),
  admins: async (): Promise<BillingAdmin[]> =>
    (await api.adminBilling.admins()).map((a) => ({ ...a, role: 'OWNER' as const })),
  items: async (): Promise<BillingItem[]> => api.adminBilling.items(),
  nextNumber: async (kind: NumberKind): Promise<string> =>
    (await api.adminBilling.nextNumber(kind)).number,
  download: (doc: { kind: BillingDocumentKind; refId: string }): Promise<BillingFile> =>
    documentFile(doc.kind, doc.refId),

  invoices: async (query: InvoiceQuery = {}): Promise<BillingPage<BillingInvoice>> =>
    mapPage(await api.adminBilling.invoices(invoiceQuery(query)), invoiceOut),
  invoiceSummary: async (query: InvoiceQuery = {}): Promise<InvoiceSummary> =>
    api.adminBilling.invoiceSummary(invoiceQuery(query)),
  invoice: async (id: string): Promise<InvoiceDetail> =>
    detailOut(await api.adminBilling.invoice(id)),
  createInvoice: async (body: SaveInvoice): Promise<InvoiceDetail> =>
    detailOut(await api.adminBilling.createInvoice(invoiceIn(body))),
  updateInvoice: async (id: string, body: SaveInvoice): Promise<InvoiceDetail> =>
    detailOut(await api.adminBilling.updateInvoice(id, invoiceIn(body))),
  sendInvoice: async (id: string): Promise<InvoiceDetail> =>
    detailOut(await api.adminBilling.sendInvoice(id, { email: true })),
  duplicateInvoice: async (id: string): Promise<InvoiceDetail> =>
    detailOut(await api.adminBilling.duplicateInvoice(id)),
  voidInvoice: async (id: string, input: { reason: string }): Promise<InvoiceDetail> =>
    detailOut(await api.adminBilling.voidInvoice(id, input)),

  payments: async (query: PaymentQuery = {}): Promise<BillingPage<BillingPayment>> =>
    mapPage(await api.adminBilling.payments(paymentQuery(query)), paymentOut),
  paymentSummary: async (query: PaymentQuery = {}): Promise<PaymentSummary> =>
    api.adminBilling.paymentSummary(paymentQuery(query)),
  payment: async (id: string): Promise<BillingPayment> =>
    paymentOut(await api.adminBilling.payment(id)),
  recordPayment: async (input: RecordPaymentInput): Promise<BillingPayment> =>
    paymentOut(
      await api.adminBilling.recordPayment(input.invoiceId, {
        requestId: crypto.randomUUID(),
        amountCents: input.amountCents,
        paidOn: input.paidOn,
        method: METHOD_IN[input.method],
        reference: input.reference,
        notes: input.notes,
        sendReceipt: input.sendReceipt,
      }),
    ),
  refundPayment: async (input: RefundInput): Promise<BillingPayment> =>
    paymentOut(
      await api.adminBilling.refundPayment(input.paymentId, {
        type: input.type,
        amountCents: input.amountCents,
        reason: input.reason,
        notes: input.notes,
        method: input.method,
        confirmed: input.confirmed as true,
      }),
    ),
  sendReceipt: async (_id: string): Promise<BillingPayment> => {
    throw notYet(
      'Billing emails are not set up yet, so receipts cannot be sent. Download the receipt instead.',
    );
  },

  creditNotes: async (query: CreditNoteQuery = {}): Promise<BillingPage<BillingCreditNote>> =>
    mapPage(await api.adminBilling.creditNotes(creditQuery(query)), creditOut),
  creditNoteSummary: async (query: CreditNoteQuery = {}): Promise<CreditNoteSummary> =>
    api.adminBilling.creditNoteSummary(creditQuery(query)),
  creditNote: async (id: string): Promise<BillingCreditNote> =>
    creditOut(await api.adminBilling.creditNote(id)),
  availableCredits: async (clientId: string): Promise<BillingCreditNote[]> =>
    (await api.adminBilling.availableCredits(clientId)).map(creditOut),
  createCreditNote: async (body: SaveCreditNote): Promise<BillingCreditNote> =>
    creditOut(await api.adminBilling.createCreditNote(creditIn(body))),
  updateCreditNote: async (id: string, body: SaveCreditNote): Promise<BillingCreditNote> =>
    creditOut(await api.adminBilling.updateCreditNote(id, creditIn(body))),
  issueCreditNote: async (id: string): Promise<BillingCreditNote> =>
    creditOut(await api.adminBilling.issueCreditNote(id)),
  applyCredit: async (input: ApplyCreditInput): Promise<BillingCreditNote> =>
    creditOut(
      await api.adminBilling.applyCredit(input.creditNoteId, {
        invoiceId: input.invoiceId,
        amountCents: input.amountCents,
        confirmed: input.confirmed as true,
      }),
    ),
  refundCreditNote: async (
    id: string,
    input: { amountCents: number; reason: string; method: RefundMethod },
  ): Promise<BillingCreditNote> => creditOut(await api.adminBilling.refundCreditNote(id, input)),
  sendCreditNote: async (_id: string): Promise<BillingCreditNote> => {
    throw notYet(
      'Billing emails are not set up yet, so credit notes cannot be sent. Download it instead.',
    );
  },
  voidCreditNote: async (id: string, input: { reason: string }): Promise<BillingCreditNote> =>
    creditOut(await api.adminBilling.voidCreditNote(id, input)),

  estimates: async (query: EstimateQuery = {}): Promise<BillingPage<BillingEstimate>> =>
    mapPage(await api.adminBilling.estimates(estimateQuery(query)), estimateOut),
  estimateSummary: async (query: EstimateQuery = {}): Promise<EstimateSummary> =>
    api.adminBilling.estimateSummary(estimateQuery(query)),
  estimate: async (id: string): Promise<BillingEstimate> =>
    estimateOut(await api.adminBilling.estimate(id)),
  /** The firm's estimate terms: none are stored (they go in the estimate's notes). */
  estimateTerms: async (_firmId: string): Promise<string> => '',
  createEstimate: async (body: SaveEstimate): Promise<BillingEstimate> => {
    let e = await api.adminBilling.createEstimate(estimateIn(body));
    if (body.status !== 'DRAFT' && body.status !== 'SENT')
      e = await api.adminBilling.setEstimateStatus(e.id, { status: body.status });
    return estimateOut(e);
  },
  updateEstimate: async (id: string, body: SaveEstimate): Promise<BillingEstimate> => {
    let e = await api.adminBilling.updateEstimate(id, estimateIn(body));
    if (body.status !== 'DRAFT' && body.status !== 'SENT')
      e = await api.adminBilling.setEstimateStatus(e.id, { status: body.status });
    return estimateOut(e);
  },
  sendEstimate: async (id: string): Promise<BillingEstimate> =>
    estimateOut(await api.adminBilling.sendEstimate(id, { email: true })),
  setEstimateStatus: async (id: string, status: EstimateSetStatus): Promise<BillingEstimate> =>
    estimateOut(await api.adminBilling.setEstimateStatus(id, { status })),
  duplicateEstimate: async (id: string): Promise<BillingEstimate> =>
    estimateOut(await api.adminBilling.duplicateEstimate(id)),
  deleteEstimate: async (id: string): Promise<void> => {
    await api.adminBilling.deleteEstimate(id);
  },
  /** The invoice form, filled from the estimate (saving it converts the estimate). */
  estimateToInvoice: async (id: string): Promise<SaveInvoice> => {
    const e = await api.adminBilling.estimate(id);
    const issue = new Date().toISOString().slice(0, 10);
    const due = new Date(Date.now() + termDays * 86_400_000).toISOString().slice(0, 10);
    return {
      firmId: e.firmId,
      clientId: e.firmId,
      number: '',
      issueDate: issue,
      dueDate: due,
      type: 'STANDARD',
      currency: 'USD',
      paymentTerms: nearestTerms(termDays),
      reference: e.reference || e.number,
      notes: e.notes,
      lines: e.lines.map((l) => ({
        description: l.description,
        quantity: l.quantity,
        rateCents: l.rateCents,
        taxRateId: taxIdOf(l.taxPercent),
      })),
      discountCents: e.discountCents,
      allowOnlinePayment: true,
      send: false,
      estimateId: e.id,
      attachments: [],
      keepAttachmentIds: [],
    };
  },

  recurringSchedules: async (
    query: RecurringQuery = {},
  ): Promise<BillingPage<BillingRecurring>> => {
    const [page, firms] = await Promise.all([
      api.adminBilling.recurringSchedules(recurringQuery(query)),
      loadFirms(),
    ]);
    const contact = new Map(firms.map((f) => [f.id, f.contactName]));
    return mapPage(page, (r) => recurringOut(r, contact.get(r.firmId)));
  },
  recurringCounts: async (query: RecurringQuery = {}): Promise<RecurringCounts> =>
    api.adminBilling.recurringCounts(recurringQuery(query)),
  recurringSchedule: async (id: string): Promise<BillingRecurring> =>
    recurringOut(await api.adminBilling.recurringSchedule(id)),
  createRecurring: async (body: SaveRecurring): Promise<BillingRecurring> => {
    let r = await api.adminBilling.createRecurring(recurringIn(body));
    if (body.status !== 'ACTIVE')
      r = await api.adminBilling.setRecurringStatus(r.id, { status: body.status });
    return recurringOut(r);
  },
  updateRecurring: async (id: string, body: SaveRecurring): Promise<BillingRecurring> =>
    recurringOut(await api.adminBilling.updateRecurring(id, recurringIn(body))),
  setRecurringStatus: async (id: string, status: RecurringStatus): Promise<BillingRecurring> =>
    recurringOut(await api.adminBilling.setRecurringStatus(id, { status })),
  runRecurring: async (id: string): Promise<InvoiceDetail> =>
    detailOut(await api.adminBilling.runRecurring(id)),

  settings: async (): Promise<BillingSettings> => settingsOut(await api.adminBilling.settings()),
  updateSettings: async (next: BillingSettings): Promise<BillingSettings> =>
    settingsOut(await api.adminBilling.updateSettings(settingsIn(next))),
};

/** The settings' default tax and terms map lines and due dates: read them once first. */
let loading: Promise<unknown> | undefined;
const ready = async () => {
  if (!lastSettings) await (loading ??= api.adminBilling.settings().then(settingsOut));
};
const NEEDS_SETTINGS = [
  'firms',
  'firm',
  'invoices',
  'invoice',
  'createInvoice',
  'updateInvoice',
  'creditNotes',
  'creditNote',
  'availableCredits',
  'createCreditNote',
  'updateCreditNote',
  'estimates',
  'estimate',
  'createEstimate',
  'updateEstimate',
  'estimateToInvoice',
] as const satisfies readonly (keyof typeof real)[];
for (const name of NEEDS_SETTINGS) {
  const call = real[name] as (...args: unknown[]) => Promise<unknown>;
  (real as Record<string, unknown>)[name] = async (...args: unknown[]) => {
    await ready();
    return call(...args);
  };
}

/** Firmivra, the issuer of every billing document on the API (Rasel, Oct 17: Firmivra bills firms). */
const FIRMIVRA: BillingFirm = {
  id: '00000000-0000-4000-8000-000000000000',
  slug: 'firmivra',
  name: 'Firmivra',
  status: 'ACTIVE',
  email: '',
  phone: '',
  address: EMPTY_ADDRESS,
  currency: 'USD',
  paymentTerms: 'NET_30',
  defaultTaxRateId: null,
  invoiceFooter: '',
  paymentInstructions: '',
  estimateTerms: null,
  setupComplete: true,
};
/** Whose letterhead a document carries: Firmivra on the API; the firm in mock mode (its own model). */
export function issuerOf(firm: BillingFirm | null): BillingFirm | null {
  if (mocked('adminBilling')) return firm;
  return { ...FIRMIVRA, invoiceFooter: footer };
}

/** What the Billing screens call: the API, or the mock in mock mode. */
export const adminBilling: typeof real = mocked('adminBilling')
  ? (mockBilling as unknown as typeof real)
  : real;

/** Billing Settings' "Reset to defaults" and Save, as the mock module offered them. */
export const adminBillingSettings = mocked('adminBilling')
  ? mockSettings
  : {
      defaults: async (): Promise<BillingSettings> => {
        const current = await real.settings();
        return structuredClone(shipped ?? current);
      },
      save: async (next: BillingSettings): Promise<BillingSettings> => {
        const errors = billingSettingsErrors(next);
        const first = Object.values(errors.fields).find(Boolean);
        if (first) throw new ApiRequestError(400, 'VALIDATION_FAILED', first);
        return real.updateSettings(next);
      },
    };
