import { z } from 'zod';
import { type ApiRequest, parseInput, toQuery } from '../client.js';
import {
  ApplyBillingCreditRequest,
  BillingAdmin,
  BillingCreditNote,
  BillingCreditNoteId,
  BillingCreditNotePage,
  BillingCreditNotesQuery,
  BillingCreditNoteSummary,
  BillingDocumentKind,
  BillingEstimate,
  BillingEstimateId,
  BillingEstimatePage,
  BillingEstimatesQuery,
  BillingEstimateSummary,
  BillingFirm,
  BillingFirmId,
  BillingInvoiceDetail,
  BillingInvoiceId,
  BillingInvoicePage,
  BillingInvoicesQuery,
  BillingInvoiceSummary,
  BillingItem,
  BillingNextNumber,
  BillingOk,
  BillingPayment,
  BillingPaymentId,
  BillingPaymentPage,
  BillingPaymentsQuery,
  BillingPaymentSummary,
  BillingRecurring,
  BillingRecurringCounts,
  BillingRecurringId,
  BillingRecurringPage,
  BillingRecurringQuery,
  BillingSettings,
  RecordBillingPaymentRequest,
  RefundBillingCreditRequest,
  RefundBillingPaymentRequest,
  SaveBillingCreditNoteRequest,
  SaveBillingEstimateRequest,
  SaveBillingInvoiceRequest,
  SaveBillingProfileRequest,
  SaveBillingRecurringRequest,
  SendBillingRequest,
  SetBillingEstimateStatusRequest,
  SetBillingRecurringStatusRequest,
  UpdateBillingSettingsRequest,
  VoidBillingRequest,
} from './schemas.js';

const BASE = '/admin/billing';
const one = (kind: string, schema: z.ZodType, id: string) =>
  `${BASE}/${kind}/${parseInput(schema, id) as string}`;
const invoice = (id: string) => one('invoices', BillingInvoiceId, id);
const estimate = (id: string) => one('estimates', BillingEstimateId, id);
const payment = (id: string) => one('payments', BillingPaymentId, id);
const credit = (id: string) => one('credit-notes', BillingCreditNoteId, id);
const recurring = (id: string) => one('recurring', BillingRecurringId, id);
const post = (body: unknown = {}) => ({ method: 'POST', body });
const put = (body: unknown) => ({ method: 'PUT', body });
const patch = (body: unknown) => ({ method: 'PATCH', body });

/** A list query as a query string: several values of one filter go comma separated. */
function listQuery<S extends z.ZodType>(schema: S, query: z.input<S>): string {
  const q = parseInput(schema, query) as Record<string, unknown>;
  const flat: Record<string, string | number | boolean | undefined> = {};
  for (const [key, value] of Object.entries(q)) {
    flat[key] = Array.isArray(value)
      ? value.join(',')
      : (value as string | number | boolean | undefined);
  }
  return toQuery(flat);
}

/**
 * `api.adminBilling` (apps/web/src/lib/api.ts): Super Admin Billing, where Firmivra bills firms.
 * 401 without the Super Admin site's session, 403 for anyone who is not a Super Admin. Totals,
 * balances, numbers and money statuses come from the server; forms send lines and amounts only.
 * Bad input rejects with ApiRequestError(400, 'VALIDATION_FAILED') before anything is sent.
 * Screens show this module's errors with `errorMessage(error, BILLING_ERRORS)`.
 */
export function createAdminBillingClient(request: ApiRequest) {
  return {
    // Reference data
    /** Every firm with its billing contact, overrides and plan. */
    firms: async (): Promise<BillingFirm[]> => request(z.array(BillingFirm), `${BASE}/firms`),
    firm: async (id: string): Promise<BillingFirm> =>
      request(BillingFirm, one('firms', BillingFirmId, id)),
    /** Save a firm's billing profile (contact, terms, tax, auto-pay). */
    saveProfile: async (id: string, body: SaveBillingProfileRequest): Promise<BillingFirm> =>
      request(
        BillingFirm,
        `${one('firms', BillingFirmId, id)}/billing-profile`,
        put(parseInput(SaveBillingProfileRequest, body)),
      ),
    /** The Super Admin team (Created By, Assign To). */
    admins: async (): Promise<BillingAdmin[]> => request(z.array(BillingAdmin), `${BASE}/admins`),
    /** The plans, for the Item / Service pickers. */
    items: async (): Promise<BillingItem[]> => request(z.array(BillingItem), `${BASE}/items`),
    /** The number the next document of a kind will get (the database gives it on save). */
    nextNumber: async (kind: BillingDocumentKind): Promise<BillingNextNumber> =>
      request(
        BillingNextNumber,
        `${BASE}/next-number${toQuery({ kind: parseInput(BillingDocumentKind, kind) })}`,
      ),

    // Invoices
    invoices: async (query: BillingInvoicesQuery = {}): Promise<BillingInvoicePage> =>
      request(BillingInvoicePage, `${BASE}/invoices${listQuery(BillingInvoicesQuery, query)}`),
    /** The dashboard cards, over the same filter as the table. */
    invoiceSummary: async (query: BillingInvoicesQuery = {}): Promise<BillingInvoiceSummary> =>
      request(
        BillingInvoiceSummary,
        `${BASE}/invoices/summary${listQuery(BillingInvoicesQuery, query)}`,
      ),
    invoice: async (id: string): Promise<BillingInvoiceDetail> =>
      request(BillingInvoiceDetail, invoice(id)),
    createInvoice: async (body: SaveBillingInvoiceRequest): Promise<BillingInvoiceDetail> =>
      request(
        BillingInvoiceDetail,
        `${BASE}/invoices`,
        post(parseInput(SaveBillingInvoiceRequest, body)),
      ),
    /** Drafts only (409 NOT_A_DRAFT). */
    updateInvoice: async (
      id: string,
      body: SaveBillingInvoiceRequest,
    ): Promise<BillingInvoiceDetail> =>
      request(
        BillingInvoiceDetail,
        invoice(id),
        patch(parseInput(SaveBillingInvoiceRequest, body)),
      ),
    /** Issue a draft, or send an issued one again. */
    sendInvoice: async (id: string, body: SendBillingRequest = {}): Promise<BillingInvoiceDetail> =>
      request(
        BillingInvoiceDetail,
        `${invoice(id)}/send`,
        post(parseInput(SendBillingRequest, body)),
      ),
    /** A new draft with the same firm and lines. */
    duplicateInvoice: async (id: string): Promise<BillingInvoiceDetail> =>
      request(BillingInvoiceDetail, `${invoice(id)}/duplicate`, post()),
    /** Only with no money on it (409 HAS_MONEY). */
    voidInvoice: async (id: string, body: VoidBillingRequest): Promise<BillingInvoiceDetail> =>
      request(
        BillingInvoiceDetail,
        `${invoice(id)}/void`,
        post(parseInput(VoidBillingRequest, body)),
      ),
    recordPayment: async (id: string, body: RecordBillingPaymentRequest): Promise<BillingPayment> =>
      request(
        BillingPayment,
        `${invoice(id)}/payments`,
        post(parseInput(RecordBillingPaymentRequest, body)),
      ),

    // Payments
    payments: async (query: BillingPaymentsQuery = {}): Promise<BillingPaymentPage> =>
      request(BillingPaymentPage, `${BASE}/payments${listQuery(BillingPaymentsQuery, query)}`),
    paymentSummary: async (query: BillingPaymentsQuery = {}): Promise<BillingPaymentSummary> =>
      request(
        BillingPaymentSummary,
        `${BASE}/payments/summary${listQuery(BillingPaymentsQuery, query)}`,
      ),
    payment: async (id: string): Promise<BillingPayment> => request(BillingPayment, payment(id)),
    refundPayment: async (id: string, body: RefundBillingPaymentRequest): Promise<BillingPayment> =>
      request(
        BillingPayment,
        `${payment(id)}/refunds`,
        post(parseInput(RefundBillingPaymentRequest, body)),
      ),
    sendReceipt: async (id: string): Promise<BillingPayment> =>
      request(BillingPayment, `${payment(id)}/receipt/send`, post()),

    // Credit notes
    creditNotes: async (query: BillingCreditNotesQuery = {}): Promise<BillingCreditNotePage> =>
      request(
        BillingCreditNotePage,
        `${BASE}/credit-notes${listQuery(BillingCreditNotesQuery, query)}`,
      ),
    creditNoteSummary: async (
      query: BillingCreditNotesQuery = {},
    ): Promise<BillingCreditNoteSummary> =>
      request(
        BillingCreditNoteSummary,
        `${BASE}/credit-notes/summary${listQuery(BillingCreditNotesQuery, query)}`,
      ),
    creditNote: async (id: string): Promise<BillingCreditNote> =>
      request(BillingCreditNote, credit(id)),
    /** A firm's notes with credit left (Available, Partially Applied). */
    availableCredits: async (firmId: string): Promise<BillingCreditNote[]> =>
      request(
        z.array(BillingCreditNote),
        `${BASE}/credit-notes/available${toQuery({ firmId: parseInput(BillingFirmId, firmId) })}`,
      ),
    createCreditNote: async (body: SaveBillingCreditNoteRequest): Promise<BillingCreditNote> =>
      request(
        BillingCreditNote,
        `${BASE}/credit-notes`,
        post(parseInput(SaveBillingCreditNoteRequest, body)),
      ),
    /** Drafts only (409 NOT_A_DRAFT). */
    updateCreditNote: async (
      id: string,
      body: SaveBillingCreditNoteRequest,
    ): Promise<BillingCreditNote> =>
      request(BillingCreditNote, credit(id), patch(parseInput(SaveBillingCreditNoteRequest, body))),
    issueCreditNote: async (id: string): Promise<BillingCreditNote> =>
      request(BillingCreditNote, `${credit(id)}/issue`, post()),
    /** Apply credit to one of the firm's invoices. */
    applyCredit: async (id: string, body: ApplyBillingCreditRequest): Promise<BillingCreditNote> =>
      request(
        BillingCreditNote,
        `${credit(id)}/apply`,
        post(parseInput(ApplyBillingCreditRequest, body)),
      ),
    refundCreditNote: async (
      id: string,
      body: RefundBillingCreditRequest,
    ): Promise<BillingCreditNote> =>
      request(
        BillingCreditNote,
        `${credit(id)}/refund`,
        post(parseInput(RefundBillingCreditRequest, body)),
      ),
    sendCreditNote: async (id: string): Promise<BillingCreditNote> =>
      request(BillingCreditNote, `${credit(id)}/send`, post()),
    voidCreditNote: async (id: string, body: VoidBillingRequest): Promise<BillingCreditNote> =>
      request(BillingCreditNote, `${credit(id)}/void`, post(parseInput(VoidBillingRequest, body))),

    // Estimates
    estimates: async (query: BillingEstimatesQuery = {}): Promise<BillingEstimatePage> =>
      request(BillingEstimatePage, `${BASE}/estimates${listQuery(BillingEstimatesQuery, query)}`),
    estimateSummary: async (query: BillingEstimatesQuery = {}): Promise<BillingEstimateSummary> =>
      request(
        BillingEstimateSummary,
        `${BASE}/estimates/summary${listQuery(BillingEstimatesQuery, query)}`,
      ),
    estimate: async (id: string): Promise<BillingEstimate> =>
      request(BillingEstimate, estimate(id)),
    createEstimate: async (body: SaveBillingEstimateRequest): Promise<BillingEstimate> =>
      request(
        BillingEstimate,
        `${BASE}/estimates`,
        post(parseInput(SaveBillingEstimateRequest, body)),
      ),
    /** Drafts only (409 NOT_A_DRAFT). */
    updateEstimate: async (
      id: string,
      body: SaveBillingEstimateRequest,
    ): Promise<BillingEstimate> =>
      request(BillingEstimate, estimate(id), patch(parseInput(SaveBillingEstimateRequest, body))),
    sendEstimate: async (id: string, body: SendBillingRequest = {}): Promise<BillingEstimate> =>
      request(BillingEstimate, `${estimate(id)}/send`, post(parseInput(SendBillingRequest, body))),
    setEstimateStatus: async (
      id: string,
      body: SetBillingEstimateStatusRequest,
    ): Promise<BillingEstimate> =>
      request(
        BillingEstimate,
        `${estimate(id)}/status`,
        post(parseInput(SetBillingEstimateStatusRequest, body)),
      ),
    duplicateEstimate: async (id: string): Promise<BillingEstimate> =>
      request(BillingEstimate, `${estimate(id)}/duplicate`, post()),
    /** Drafts only. */
    deleteEstimate: async (id: string): Promise<BillingOk> =>
      request(BillingOk, estimate(id), { method: 'DELETE' }),
    /** Convert: the invoice made from it (a draft), and the estimate becomes Converted. */
    convertEstimate: async (id: string): Promise<BillingInvoiceDetail> =>
      request(BillingInvoiceDetail, `${estimate(id)}/convert`, post()),

    // Recurring
    recurringSchedules: async (query: BillingRecurringQuery = {}): Promise<BillingRecurringPage> =>
      request(BillingRecurringPage, `${BASE}/recurring${listQuery(BillingRecurringQuery, query)}`),
    recurringCounts: async (query: BillingRecurringQuery = {}): Promise<BillingRecurringCounts> =>
      request(
        BillingRecurringCounts,
        `${BASE}/recurring/counts${listQuery(BillingRecurringQuery, query)}`,
      ),
    recurringSchedule: async (id: string): Promise<BillingRecurring> =>
      request(BillingRecurring, recurring(id)),
    createRecurring: async (body: SaveBillingRecurringRequest): Promise<BillingRecurring> =>
      request(
        BillingRecurring,
        `${BASE}/recurring`,
        post(parseInput(SaveBillingRecurringRequest, body)),
      ),
    updateRecurring: async (
      id: string,
      body: SaveBillingRecurringRequest,
    ): Promise<BillingRecurring> =>
      request(
        BillingRecurring,
        recurring(id),
        patch(parseInput(SaveBillingRecurringRequest, body)),
      ),
    /** Pause, resume (ACTIVE) or cancel (final). */
    setRecurringStatus: async (
      id: string,
      body: SetBillingRecurringStatusRequest,
    ): Promise<BillingRecurring> =>
      request(
        BillingRecurring,
        `${recurring(id)}/status`,
        post(parseInput(SetBillingRecurringStatusRequest, body)),
      ),
    /** Make the next invoice now. */
    runRecurring: async (id: string): Promise<BillingInvoiceDetail> =>
      request(BillingInvoiceDetail, `${recurring(id)}/run`, post()),

    // Settings
    settings: async (): Promise<BillingSettings> => request(BillingSettings, `${BASE}/settings`),
    updateSettings: async (body: UpdateBillingSettingsRequest): Promise<BillingSettings> =>
      request(
        BillingSettings,
        `${BASE}/settings`,
        put(parseInput(UpdateBillingSettingsRequest, body)),
      ),
  };
}

export type AdminBillingClient = ReturnType<typeof createAdminBillingClient>;
