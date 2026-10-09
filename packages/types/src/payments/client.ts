import { type ApiRequest, parseInput, toQuery } from '../client.js';
import { portalMe } from '../clients/client.js';
import {
  CancelInvoiceRequest,
  CheckoutLink,
  CreateInvoiceRequest,
  Invoice,
  InvoiceId,
  InvoiceList,
  ListInvoicesQuery,
  ListMyInvoicesQuery,
  MyInvoiceDetail,
  MyInvoiceList,
  OfflinePaymentId,
  PayInvoiceRequest,
  RecordOfflinePaymentRequest,
  PaymentId,
  RefundPaymentRequest,
  UpdateInvoiceRequest,
  VoidOfflinePaymentRequest,
} from './schemas.js';

const BASE = '/business/invoices';
const one = (id: string) => `${BASE}/${parseInput(InvoiceId, id)}`;

/**
 * `api.invoices` (apps/web/src/lib/api.ts): the firm's invoices (the Invoices page and client
 * record > Invoices). Owner and Admin: every client's, every change, and refunds. Staff: only
 * read the invoices of clients assigned to them (others are 404 NOT_FOUND, as is another firm's),
 * and every change is 403 FORBIDDEN. Amounts and totals are computed by the database; preview
 * them with `invoiceTotals()`. Bad input rejects with ApiRequestError(400, 'VALIDATION_FAILED')
 * before anything is sent. Screens show this module's errors with
 * `errorMessage(error, INVOICE_ERRORS)`.
 */
export function createInvoicesClient(request: ApiRequest) {
  return {
    /**
     * One page, newest first; pass `nextCursor` back as `cursor`. `clientId`: one client's.
     * `paymentsEnabled` says whether clients can pay online yet.
     */
    list: async (query: ListInvoicesQuery = {}): Promise<InvoiceList> =>
      request(InvoiceList, `${BASE}${toQuery(parseInput(ListInvoicesQuery, query))}`),
    /** Lines, totals and payments. */
    get: async (id: string): Promise<Invoice> => request(Invoice, one(id)),
    /** A new DRAFT, numbered by the API. 409 CLIENT_ARCHIVED. */
    create: async (body: CreateInvoiceRequest): Promise<Invoice> =>
      request(Invoice, BASE, { method: 'POST', body: parseInput(CreateInvoiceRequest, body) }),
    /** Replaces the whole draft, lines included. 409 NOT_DRAFT or CLIENT_ARCHIVED. */
    update: async (id: string, body: UpdateInvoiceRequest): Promise<Invoice> =>
      request(Invoice, one(id), { method: 'PUT', body: parseInput(UpdateInvoiceRequest, body) }),
    /**
     * Sends a draft to the client: OPEN now, or SCHEDULED (Upcoming) when its scheduled day is
     * later. 409 NOT_DRAFT, CLIENT_ARCHIVED, ZERO_TOTAL or DUE_DATE_PASSED.
     */
    send: async (id: string): Promise<Invoice> =>
      request(Invoice, `${one(id)}/send`, { method: 'POST', body: {} }),
    /** Draft, scheduled or open. 409 INVOICE_CLOSED, PAYMENT_IN_PROGRESS or HAS_PAYMENTS. */
    cancel: async (id: string, body: CancelInvoiceRequest): Promise<Invoice> =>
      request(Invoice, `${one(id)}/cancel`, {
        method: 'POST',
        body: parseInput(CancelInvoiceRequest, body),
      }),
    /**
     * Refunds part or all of one of its SUCCEEDED payments through Stripe. Answers the invoice
     * with the refund PENDING (it counts once Stripe confirms it). 409 NOT_REFUNDABLE or
     * REFUND_TOO_LARGE; 503 PAYMENT_PROVIDER_UNAVAILABLE (retry with the same idempotencyKey). A
     * retry of a refund already made answers the invoice as it is (no second refund).
     */
    refund: async (id: string, paymentId: string, body: RefundPaymentRequest): Promise<Invoice> =>
      request(Invoice, `${one(id)}/payments/${parseInput(PaymentId, paymentId)}/refunds`, {
        method: 'POST',
        body: parseInput(RefundPaymentRequest, body),
      }),
    /**
     * Records a check or cash payment on an OPEN invoice (at most its balance due); it turns PAID
     * once covered. 409 NOT_OPEN, AMOUNT_TOO_LARGE or PAYMENT_IN_PROGRESS. A retry with the same
     * idempotencyKey answers the invoice as it is (nothing recorded twice).
     */
    recordPayment: async (id: string, body: RecordOfflinePaymentRequest): Promise<Invoice> =>
      request(Invoice, `${one(id)}/offline-payments`, {
        method: 'POST',
        body: parseInput(RecordOfflinePaymentRequest, body),
      }),
    /** Voids a recorded check or cash payment; a PAID invoice it no longer covers reopens. 409 ALREADY_VOIDED. */
    voidPayment: async (
      id: string,
      offlinePaymentId: string,
      body: VoidOfflinePaymentRequest,
    ): Promise<Invoice> =>
      request(
        Invoice,
        `${one(id)}/offline-payments/${parseInput(OfflinePaymentId, offlinePaymentId)}/void`,
        { method: 'POST', body: parseInput(VoidOfflinePaymentRequest, body) },
      ),
  };
}

export type InvoicesClient = ReturnType<typeof createInvoicesClient>;

/**
 * `api.myInvoices(firmSlug)`: the signed-in client's invoices at one firm (Receipts & Invoices).
 * Never drafts, never another client's (404). Pay Now:
 *   const { url } = await api.myInvoices(slug).pay(invoice.id);
 *   window.location.assign(url); // Stripe's checkout; a `mock:` link (mock mode) opens nothing
 * Stripe sends the client back with `?checkout=...` (see `CheckoutReturn`).
 */
export function createMyInvoicesClient(request: ApiRequest, firmSlug: string) {
  const base = () => `${portalMe(firmSlug)}/invoices`;
  const mine = (id: string) => `${base()}/${parseInput(InvoiceId, id)}`;
  return {
    /** One page of one view; pass `nextCursor` back as `cursor`. */
    list: async (query: ListMyInvoicesQuery = {}): Promise<MyInvoiceList> =>
      request(MyInvoiceList, `${base()}${toQuery(parseInput(ListMyInvoicesQuery, query))}`),
    /** "View": lines, totals and the payment history. */
    get: async (id: string): Promise<MyInvoiceDetail> => request(MyInvoiceDetail, mine(id)),
    /**
     * A Stripe checkout for what is due on this invoice; it marks nothing paid. 409 NOT_PAYABLE,
     * PAYMENT_IN_PROGRESS or PAYMENTS_NOT_SET_UP; 503 PAYMENT_PROVIDER_UNAVAILABLE.
     */
    pay: async (id: string): Promise<CheckoutLink> =>
      request(CheckoutLink, `${mine(id)}/checkout`, {
        method: 'POST',
        body: parseInput(PayInvoiceRequest, {}),
      }),
  };
}

export type MyInvoicesClient = ReturnType<typeof createMyInvoicesClient>;
