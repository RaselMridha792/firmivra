import { type ApiRequest, parseInput } from '../client.js';
import {
  CreateTaxStatusRequest,
  type ListTaxStatusesQuery,
  ListTaxStatusesResponse,
  OrderTaxStatusesRequest,
  RenameTaxStatusRequest,
  TaxStatus,
} from './schemas.js';

const BASE = '/business/tax-statuses';
const one = (id: string) => `${BASE}/${encodeURIComponent(id)}`;

/**
 * `api.taxStatuses` (apps/web/src/lib/api.ts): the firm's tax statuses. Staff may list;
 * Owner and Admin change. Bad input rejects with ApiRequestError(400, 'VALIDATION_FAILED')
 * before anything is sent, the same error the API gives.
 */
export function createTaxStatusesClient(request: ApiRequest) {
  return {
    /** In display order. Archived statuses only with `{ includeArchived: true }`. */
    list: async (query: ListTaxStatusesQuery = {}): Promise<TaxStatus[]> => {
      const path = query.includeArchived ? `${BASE}?includeArchived=true` : BASE;
      return (await request(ListTaxStatusesResponse, path)).items;
    },
    /** Adds a status at the end. 409 DUPLICATE_NAME or CONFIGURATION_LIMIT. */
    create: async (body: CreateTaxStatusRequest): Promise<TaxStatus> =>
      request(TaxStatus, BASE, { method: 'POST', body: parseInput(CreateTaxStatusRequest, body) }),
    /** 409 DUPLICATE_NAME; 404 for an unknown id. */
    rename: async (id: string, body: RenameTaxStatusRequest): Promise<TaxStatus> =>
      request(TaxStatus, one(id), {
        method: 'PATCH',
        body: parseInput(RenameTaxStatusRequest, body),
      }),
    /**
     * Every active status's id, in the new order; returns the new list.
     * 404 for an unknown id; 409 CONFLICT when an active status is missing.
     */
    reorder: async (ids: string[]): Promise<TaxStatus[]> => {
      const body = parseInput(OrderTaxStatusesRequest, { ids });
      return (await request(ListTaxStatusesResponse, `${BASE}/order`, { method: 'PUT', body }))
        .items;
    },
    /** Hides the status from new choices; client years that use it keep it. */
    archive: async (id: string): Promise<TaxStatus> =>
      request(TaxStatus, `${one(id)}/archive`, { method: 'POST' }),
  };
}

export type TaxStatusesClient = ReturnType<typeof createTaxStatusesClient>;
