import { type ApiRequest, parseInput, toQuery } from '../client.js';
import {
  AddSubscriptionNoteRequest,
  ChangeBillingDateRequest,
  ChangeSubscriptionPlanRequest,
  CloseSubscriptionRequest,
  ConvertSubscriptionRequest,
  CreateSubscriptionRequest,
  ExtendSubscriptionTrialRequest,
  ReactivateSubscriptionRequest,
  ReverseCancellationRequest,
  SetSubscriptionPriceRequest,
  type SubscriptionAvailableFirm,
  SubscriptionAvailableFirmList,
  SubscriptionExportQuery,
  SubscriptionId,
  SubscriptionMeta,
  SubscriptionNote,
  SubscriptionPage,
  SubscriptionRecord,
  SubscriptionResult,
  SubscriptionsQuery,
  SubscriptionSummary,
  SubscriptionSummaryQuery,
  SuspendSubscriptionRequest,
  TurnOffAutoRenewRequest,
  UpdateSubscriptionLocationsRequest,
  UpdateSubscriptionSeatsRequest,
} from './schemas.js';

const BASE = '/admin/subscriptions';
const one = (id: string) => `${BASE}/${parseInput(SubscriptionId, id)}`;
const post = (body: unknown) => ({ method: 'POST', body });

/**
 * The Export Subscription Data download (CSV). It is a download: open
 * `${baseUrl}${adminSubscriptionsExportPath(query)}` as a link, not through the client. With
 * `ids` (at most 100, comma separated on the wire), exactly those; otherwise the table's filters.
 * The API writes an EXPORTED event on each subscription exported.
 */
export function adminSubscriptionsExportPath(query: SubscriptionExportQuery = {}): string {
  const q = parseInput(SubscriptionExportQuery, query);
  return `${BASE}/export${toQuery({ ...q, ids: q.ids?.join(',') })}`;
}

/**
 * `api.adminSubscriptions` (apps/web/src/lib/api.ts): Super Admin Subscriptions (the KPI row,
 * the table, the detail panel and its dialogs). 401 without the Super Admin site's session, 403
 * for anyone who is not on the Super Admin team. Bad input rejects with ApiRequestError(400,
 * 'VALIDATION_FAILED') before anything is sent. Screens show this module's errors with
 * `errorMessage(error, SUBSCRIPTION_ERRORS)`. Every change answers `SubscriptionResult`: the row
 * after it and the invoice or credit note it issued, if any.
 *
 * Not here (docs/work/R60-subscriptions.md): account credits (Billing's credit notes), resending
 * an invoice and recording a payment (Billing), support access (`api.adminSupportAccess`), and
 * what no table holds yet: promotion codes and timed discounts, add-ons other than extra
 * locations, a card on file, payment links and retries, scheduled changes, and usage limits.
 */
export function createAdminSubscriptionsClient(request: ApiRequest) {
  return {
    /** The plans and today, for the dialogs. */
    meta: async (): Promise<SubscriptionMeta> => request(SubscriptionMeta, `${BASE}/meta`),
    /** The seven cards, now and 30 days ago; the churn rate for the period and the one before. */
    summary: async (query: SubscriptionSummaryQuery = {}): Promise<SubscriptionSummary> =>
      request(
        SubscriptionSummary,
        `${BASE}/summary${toQuery(parseInput(SubscriptionSummaryQuery, query))}`,
      ),
    /** The table: filtered, sorted and paged on the server. */
    subscriptions: async (query: SubscriptionsQuery = {}): Promise<SubscriptionPage> =>
      request(SubscriptionPage, `${BASE}${toQuery(parseInput(SubscriptionsQuery, query))}`),
    /** Approved firms with no subscription yet (Add Subscription, Start Trial for Firm). */
    availableFirms: async (): Promise<SubscriptionAvailableFirm[]> =>
      (await request(SubscriptionAvailableFirmList, `${BASE}/available-firms`)).items,
    /** The detail panel: the row with its dates, billing, events and notes. */
    subscription: async (id: string): Promise<SubscriptionRecord> =>
      request(SubscriptionRecord, one(id)),

    // Start and plan
    create: async (body: CreateSubscriptionRequest): Promise<SubscriptionResult> =>
      request(SubscriptionResult, BASE, post(parseInput(CreateSubscriptionRequest, body))),
    changePlan: async (
      id: string,
      body: ChangeSubscriptionPlanRequest,
    ): Promise<SubscriptionResult> =>
      request(
        SubscriptionResult,
        `${one(id)}/plan`,
        post(parseInput(ChangeSubscriptionPlanRequest, body)),
      ),
    updateSeats: async (
      id: string,
      body: UpdateSubscriptionSeatsRequest,
    ): Promise<SubscriptionResult> =>
      request(
        SubscriptionResult,
        `${one(id)}/seats`,
        post(parseInput(UpdateSubscriptionSeatsRequest, body)),
      ),
    /** The Additional Location add-on, the one add-on stored. */
    updateLocations: async (
      id: string,
      body: UpdateSubscriptionLocationsRequest,
    ): Promise<SubscriptionResult> =>
      request(
        SubscriptionResult,
        `${one(id)}/locations`,
        post(parseInput(UpdateSubscriptionLocationsRequest, body)),
      ),

    // Trial
    extendTrial: async (
      id: string,
      body: ExtendSubscriptionTrialRequest,
    ): Promise<SubscriptionResult> =>
      request(
        SubscriptionResult,
        `${one(id)}/extend-trial`,
        post(parseInput(ExtendSubscriptionTrialRequest, body)),
      ),
    convertToPaid: async (
      id: string,
      body: ConvertSubscriptionRequest,
    ): Promise<SubscriptionResult> =>
      request(
        SubscriptionResult,
        `${one(id)}/convert`,
        post(parseInput(ConvertSubscriptionRequest, body)),
      ),

    // Renewal and lifecycle
    /** Auto-Renew off and Cancel at Period End: the same client request. */
    turnOffAutoRenew: async (
      id: string,
      body: TurnOffAutoRenewRequest,
    ): Promise<SubscriptionResult> =>
      request(
        SubscriptionResult,
        `${one(id)}/auto-renew/off`,
        post(parseInput(TurnOffAutoRenewRequest, body)),
      ),
    reverseCancellation: async (
      id: string,
      body: ReverseCancellationRequest,
    ): Promise<SubscriptionResult> =>
      request(
        SubscriptionResult,
        `${one(id)}/auto-renew/on`,
        post(parseInput(ReverseCancellationRequest, body)),
      ),
    suspend: async (id: string, body: SuspendSubscriptionRequest): Promise<SubscriptionResult> =>
      request(
        SubscriptionResult,
        `${one(id)}/suspend`,
        post(parseInput(SuspendSubscriptionRequest, body)),
      ),
    reactivate: async (
      id: string,
      body: ReactivateSubscriptionRequest,
    ): Promise<SubscriptionResult> =>
      request(
        SubscriptionResult,
        `${one(id)}/reactivate`,
        post(parseInput(ReactivateSubscriptionRequest, body)),
      ),
    /** Close Account: high risk, today only. */
    close: async (id: string, body: CloseSubscriptionRequest): Promise<SubscriptionResult> =>
      request(
        SubscriptionResult,
        `${one(id)}/close`,
        post(parseInput(CloseSubscriptionRequest, body)),
      ),

    // Billing terms
    /** A negotiated base price, or back to the plan's with `baseCents: null`. */
    setPrice: async (id: string, body: SetSubscriptionPriceRequest): Promise<SubscriptionResult> =>
      request(
        SubscriptionResult,
        `${one(id)}/price`,
        post(parseInput(SetSubscriptionPriceRequest, body)),
      ),
    changeBillingDate: async (
      id: string,
      body: ChangeBillingDateRequest,
    ): Promise<SubscriptionResult> =>
      request(
        SubscriptionResult,
        `${one(id)}/billing-date`,
        post(parseInput(ChangeBillingDateRequest, body)),
      ),

    // Notes
    /** Internal only; a note never changes once added. */
    addNote: async (id: string, body: AddSubscriptionNoteRequest): Promise<SubscriptionNote> =>
      request(
        SubscriptionNote,
        `${one(id)}/notes`,
        post(parseInput(AddSubscriptionNoteRequest, body)),
      ),
  };
}

export type AdminSubscriptionsClient = ReturnType<typeof createAdminSubscriptionsClient>;
