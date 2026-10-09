import { type ApiRequest, parseInput, toQuery } from '../client.js';
import { clientPath, portalMe } from '../clients/client.js';
import {
  CancelEngagementRequest,
  CreateEngagementRequest,
  Engagement,
  EngagementHistory,
  EngagementId,
  EngagementList,
  ListEngagementsQuery,
  MyService,
  MyServiceList,
  RequestCancellationRequest,
  UpdateEngagementRequest,
} from './schemas.js';

const one = (id: string) => `/business/engagements/${parseInput(EngagementId, id)}`;

/**
 * `api.engagements` (apps/web/src/lib/api.ts): a client's services and their lifecycle. Owner and
 * Admin: every client's; Staff: only their own clients' (others are 404 NOT_FOUND, as is another
 * firm's). Bad input rejects with ApiRequestError(400, 'VALIDATION_FAILED') before anything is sent.
 */
export function createEngagementsClient(request: ApiRequest) {
  return {
    /** A client's engagements, newest first. */
    listForClient: async (
      clientId: string,
      query: ListEngagementsQuery = {},
    ): Promise<Engagement[]> => {
      const q = toQuery(parseInput(ListEngagementsQuery, query));
      return (await request(EngagementList, `${clientPath(clientId)}/engagements${q}`)).items;
    },
    get: async (id: string): Promise<Engagement> => request(Engagement, one(id)),
    /** 409 INVALID_STAGE, or CLIENT_ARCHIVED for an archived client; 404 for another firm's client or service. */
    create: async (clientId: string, body: CreateEngagementRequest): Promise<Engagement> =>
      request(Engagement, `${clientPath(clientId)}/engagements`, {
        method: 'POST',
        body: parseInput(CreateEngagementRequest, body),
      }),
    /**
     * 409 INVALID_STAGE; 409 CLIENT_ARCHIVED for an archived client's engagement (its work is
     * only wound down: complete and cancel stay allowed, an edit or a reactivation is not).
     */
    update: async (id: string, body: UpdateEngagementRequest): Promise<Engagement> =>
      request(Engagement, one(id), {
        method: 'PATCH',
        body: parseInput(UpdateEngagementRequest, body),
      }),
    /** 409 INVALID_STATUS. Allowed for an archived client too (winding work down). */
    complete: async (id: string): Promise<Engagement> =>
      request(Engagement, `${one(id)}/complete`, { method: 'POST', body: {} }),
    /** 409 INVALID_STATUS. Allowed for an archived client too (winding work down). */
    cancel: async (id: string, body: CancelEngagementRequest): Promise<Engagement> =>
      request(Engagement, `${one(id)}/cancel`, {
        method: 'POST',
        body: parseInput(CancelEngagementRequest, body),
      }),
    /**
     * Within 90 days of cancelling: 409 REACTIVATION_WINDOW_PASSED after that, and 409
     * CLIENT_ARCHIVED for an archived client. Clears the client's cancellation request.
     */
    reactivate: async (id: string): Promise<Engagement> =>
      request(Engagement, `${one(id)}/reactivate`, { method: 'POST', body: {} }),
    /** Status and stage changes, newest first. */
    history: async (id: string): Promise<EngagementHistory['items']> =>
      (await request(EngagementHistory, `${one(id)}/history`)).items,
  };
}

export type EngagementsClient = ReturnType<typeof createEngagementsClient>;

/** `api.myServices(firmSlug)`: the signed-in client's services at one firm (portal My Services). */
export function createMyServicesClient(request: ApiRequest, firmSlug: string) {
  const base = () => `${portalMe(firmSlug)}/services`;
  return {
    /** Newest first. The screen groups them: Active, Recurring, Completed, Cancelled. */
    list: async (): Promise<MyService[]> => (await request(MyServiceList, base())).items,
    /**
     * The PRIMARY login only (403 FORBIDDEN for SPOUSE and AUTHORIZED logins). ACTIVE recurring
     * services, on or before `cancelBy`: 409 INVALID_STATUS, NOT_RECURRING or TOO_LATE_TO_CANCEL
     * otherwise. The firm gets a task for it. Asking again returns the service unchanged. An
     * archived client may still ask (the firm is winding its work down anyway).
     */
    requestCancellation: async (
      id: string,
      body: RequestCancellationRequest = {},
    ): Promise<MyService> =>
      request(MyService, `${base()}/${parseInput(EngagementId, id)}/cancel-request`, {
        method: 'POST',
        body: parseInput(RequestCancellationRequest, body),
      }),
  };
}

export type MyServicesClient = ReturnType<typeof createMyServicesClient>;
