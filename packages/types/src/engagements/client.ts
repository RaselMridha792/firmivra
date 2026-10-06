import { type ApiRequest, parseInput } from '../client.js';
import { ClientId } from '../clients/schemas.js';
import { toQuery } from '../clients/client.js';
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

const BASE = '/business/engagements';
const one = (id: string) => `${BASE}/${encodeURIComponent(parseInput(EngagementId, id))}`;

/**
 * `api.engagements` (apps/web/src/lib/api.ts): a client's services and their lifecycle. Owner,
 * Admin and Staff. Another firm's engagement is 404 NOT_FOUND. Bad input rejects with
 * ApiRequestError(400, 'VALIDATION_FAILED') before anything is sent.
 */
export function createEngagementsClient(request: ApiRequest) {
  return {
    /** A client's engagements, newest first. */
    listForClient: async (
      clientId: string,
      query: ListEngagementsQuery = {},
    ): Promise<Engagement[]> => {
      const id = encodeURIComponent(parseInput(ClientId, clientId));
      const q = toQuery(parseInput(ListEngagementsQuery, query));
      return (await request(EngagementList, `/business/clients/${id}/engagements${q}`)).items;
    },
    get: async (id: string): Promise<Engagement> => request(Engagement, one(id)),
    /** 409 INVALID_STAGE; 404 for another firm's client or service. */
    create: async (body: CreateEngagementRequest): Promise<Engagement> =>
      request(Engagement, BASE, {
        method: 'POST',
        body: parseInput(CreateEngagementRequest, body),
      }),
    /** 409 INVALID_STAGE. */
    update: async (id: string, body: UpdateEngagementRequest): Promise<Engagement> =>
      request(Engagement, one(id), {
        method: 'PATCH',
        body: parseInput(UpdateEngagementRequest, body),
      }),
    /** 409 INVALID_STATUS. */
    complete: async (id: string): Promise<Engagement> =>
      request(Engagement, `${one(id)}/complete`, { method: 'POST', body: {} }),
    /** 409 INVALID_STATUS. */
    cancel: async (id: string, body: CancelEngagementRequest): Promise<Engagement> =>
      request(Engagement, `${one(id)}/cancel`, {
        method: 'POST',
        body: parseInput(CancelEngagementRequest, body),
      }),
    /** Within 90 days of cancelling: 409 REACTIVATION_WINDOW_PASSED after that. */
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
  const base = `/portal/${encodeURIComponent(firmSlug.toLowerCase())}/me/services`;
  return {
    /** Newest first. The screen groups them: Active, Recurring, Completed, Cancelled. */
    list: async (): Promise<MyService[]> => (await request(MyServiceList, base)).items,
    /** Recurring services, at least 14 days before the next billing date. */
    requestCancellation: async (
      id: string,
      body: RequestCancellationRequest = {},
    ): Promise<MyService> =>
      request(
        MyService,
        `${base}/${encodeURIComponent(parseInput(EngagementId, id))}/cancel-request`,
        {
          method: 'POST',
          body: parseInput(RequestCancellationRequest, body),
        },
      ),
  };
}

export type MyServicesClient = ReturnType<typeof createMyServicesClient>;
