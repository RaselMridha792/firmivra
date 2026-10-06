import { type ApiRequest, parseInput } from '../client.js';
import { toQuery } from '../clients/client.js';
import { ClientId } from '../clients/schemas.js';
import { OkResponse } from '../schemas.js';
import {
  CreateTaxReturnRequest,
  MyTaxReturn,
  MyTaxReturnList,
  MyTaxReturnsQuery,
  TaxReturn,
  TaxReturnId,
  TaxReturnList,
  UpdateTaxReturnRequest,
} from './schemas.js';

const BASE = '/business/tax-returns';
const one = (id: string) => `${BASE}/${encodeURIComponent(parseInput(TaxReturnId, id))}`;

/**
 * `api.taxReturns` (apps/web/src/lib/api.ts): a client's tax returns. Owner, Admin and Staff.
 * Another firm's return is 404 NOT_FOUND. Bad input rejects with
 * ApiRequestError(400, 'VALIDATION_FAILED') before anything is sent.
 */
export function createTaxReturnsClient(request: ApiRequest) {
  return {
    /** Newest year first. */
    listForClient: async (clientId: string): Promise<TaxReturn[]> => {
      const id = encodeURIComponent(parseInput(ClientId, clientId));
      return (await request(TaxReturnList, `/business/clients/${id}/tax-returns`)).items;
    },
    /** 409 INVALID_DOCUMENT; 404 for another firm's client or engagement. */
    create: async (body: CreateTaxReturnRequest): Promise<TaxReturn> =>
      request(TaxReturn, BASE, { method: 'POST', body: parseInput(CreateTaxReturnRequest, body) }),
    /** 409 INVALID_DOCUMENT. */
    update: async (id: string, body: UpdateTaxReturnRequest): Promise<TaxReturn> =>
      request(TaxReturn, one(id), {
        method: 'PATCH',
        body: parseInput(UpdateTaxReturnRequest, body),
      }),
    /** Only while IN_PROGRESS: 409 RETURN_LOCKED otherwise. */
    remove: async (id: string): Promise<OkResponse> =>
      request(OkResponse, one(id), { method: 'DELETE', body: {} }),
  };
}

export type TaxReturnsClient = ReturnType<typeof createTaxReturnsClient>;

/** `api.myTaxReturns(firmSlug)`: the signed-in client's returns at one firm (portal Taxes tab). */
export function createMyTaxReturnsClient(request: ApiRequest, firmSlug: string) {
  const base = `/portal/${encodeURIComponent(firmSlug.toLowerCase())}/me/tax-returns`;
  return {
    list: async (query: MyTaxReturnsQuery = {}): Promise<MyTaxReturn[]> =>
      (await request(MyTaxReturnList, `${base}${toQuery(parseInput(MyTaxReturnsQuery, query))}`))
        .items,
  };
}

export type MyTaxReturnsClient = ReturnType<typeof createMyTaxReturnsClient>;
