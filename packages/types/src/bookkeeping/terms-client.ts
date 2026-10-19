import { z } from 'zod';
import { type ApiRequest, parseInput, toQuery } from '../client.js';
import {
  ActivateBookkeepingTermsRequest,
  BookkeepingPaymentSchedule,
  BookkeepingPaymentScheduleQuery,
  BookkeepingTerms,
  BookkeepingTermsHistory,
  BookkeepingTermsHistoryQuery,
  BookkeepingTermsId,
  BookkeepingTermsNoticeRequest,
  BookkeepingTermsEvent,
  BookkeepingTermsPage,
  CreateBookkeepingTermsRequest,
  SendBookkeepingTermsRequest,
  SetBookkeepingTermsAgreementRequest,
  TerminateBookkeepingTermsRequest,
  UpdateBookkeepingTermsRequest,
} from './terms.js';

const BASE = '/business/bookkeeping';
const client = (id: string) => `${BASE}/clients/${parseInput(z.uuid(), id)}/terms`;
const terms = (id: string) => `${BASE}/terms/${parseInput(BookkeepingTermsId, id)}`;
const post = (body: unknown = {}) => ({ method: 'POST', body });

/**
 * `api.bookkeepingTerms` (apps/web/src/lib/api.ts): the Terms page of a bookkeeping client (R55).
 * `id` is the bookkeeping client's id (BookkeepingClientRow.id); `termsId` one version's.
 * Bad input rejects with ApiRequestError(400, 'VALIDATION_FAILED') before anything is sent.
 */
export function createBookkeepingTermsClient(request: ApiRequest) {
  return {
    /** The version in force, the open draft and every version. */
    page: async (id: string): Promise<BookkeepingTermsPage> =>
      request(BookkeepingTermsPage, client(id)),
    /** New Terms: a DRAFT from the version in force (or the package). 409 TERMS_DRAFT_EXISTS. */
    create: async (
      id: string,
      body: CreateBookkeepingTermsRequest = {},
    ): Promise<BookkeepingTerms> =>
      request(BookkeepingTerms, client(id), post(parseInput(CreateBookkeepingTermsRequest, body))),
    get: async (termsId: string): Promise<BookkeepingTerms> =>
      request(BookkeepingTerms, terms(termsId)),
    /** Save: a draft's fields; notes on any version in force. 409 TERMS_STATE. */
    update: async (
      termsId: string,
      body: UpdateBookkeepingTermsRequest,
    ): Promise<BookkeepingTerms> =>
      request(BookkeepingTerms, terms(termsId), {
        method: 'PATCH',
        body: parseInput(UpdateBookkeepingTermsRequest, body),
      }),
    /** Send Terms to Client: DRAFT to SENT. */
    send: async (
      termsId: string,
      body: SendBookkeepingTermsRequest = {},
    ): Promise<BookkeepingTerms> =>
      request(
        BookkeepingTerms,
        `${terms(termsId)}/send`,
        post(parseInput(SendBookkeepingTermsRequest, body)),
      ),
    /** A sent version back to DRAFT, to edit it. */
    backToDraft: async (termsId: string): Promise<BookkeepingTerms> =>
      request(BookkeepingTerms, `${terms(termsId)}/back-to-draft`, post()),
    /** Into force; the version before is superseded. 409 AGREEMENT_NOT_SIGNED. */
    activate: async (
      termsId: string,
      body: ActivateBookkeepingTermsRequest = {},
    ): Promise<BookkeepingTerms> =>
      request(
        BookkeepingTerms,
        `${terms(termsId)}/activate`,
        post(parseInput(ActivateBookkeepingTermsRequest, body)),
      ),
    /** Termination / Non-Renewal of the version in force. */
    terminate: async (
      termsId: string,
      body: TerminateBookkeepingTermsRequest,
    ): Promise<BookkeepingTerms> =>
      request(
        BookkeepingTerms,
        `${terms(termsId)}/terminate`,
        post(parseInput(TerminateBookkeepingTermsRequest, body)),
      ),
    /** Renewal & Notices: a price-change or termination notice, a renewal or a note. */
    recordNotice: async (
      termsId: string,
      body: BookkeepingTermsNoticeRequest,
    ): Promise<BookkeepingTermsEvent> =>
      request(
        BookkeepingTermsEvent,
        `${terms(termsId)}/notices`,
        post(parseInput(BookkeepingTermsNoticeRequest, body)),
      ),
    /** Engagement Documents: link the agreement, the signed copy and the e-signature request. */
    setAgreement: async (
      termsId: string,
      body: SetBookkeepingTermsAgreementRequest,
    ): Promise<BookkeepingTerms> =>
      request(BookkeepingTerms, `${terms(termsId)}/agreement`, {
        method: 'PUT',
        body: parseInput(SetBookkeepingTermsAgreementRequest, body),
      }),
    /** History: every version's events, newest first. */
    history: async (
      id: string,
      query: BookkeepingTermsHistoryQuery = {},
    ): Promise<BookkeepingTermsHistory> =>
      request(
        BookkeepingTermsHistory,
        `${client(id)}/history${toQuery(parseInput(BookkeepingTermsHistoryQuery, query))}`,
      ),
    /** Payment Schedule: the engagement's invoices (Invoices & Payments). */
    paymentSchedule: async (
      id: string,
      query: BookkeepingPaymentScheduleQuery = {},
    ): Promise<BookkeepingPaymentSchedule> =>
      request(
        BookkeepingPaymentSchedule,
        `${client(id)}/payment-schedule${toQuery(parseInput(BookkeepingPaymentScheduleQuery, query))}`,
      ),
  };
}
export type BookkeepingTermsClient = ReturnType<typeof createBookkeepingTermsClient>;
