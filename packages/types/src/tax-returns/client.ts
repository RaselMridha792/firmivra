import { type ApiRequest, parseInput, toQuery } from '../client.js';
import { clientPath, portalMe } from '../clients/client.js';
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

const one = (id: string) => `/business/tax-returns/${parseInput(TaxReturnId, id)}`;

/**
 * `api.taxReturns` (apps/web/src/lib/api.ts): a client's tax returns. Owner and Admin: every
 * client's; Staff: only their own clients' (others are 404 NOT_FOUND, as is another firm's).
 * Bad input rejects with ApiRequestError(400, 'VALIDATION_FAILED') before anything is sent.
 */
export function createTaxReturnsClient(request: ApiRequest) {
  return {
    /** Newest year first. */
    listForClient: async (clientId: string): Promise<TaxReturn[]> =>
      (await request(TaxReturnList, `${clientPath(clientId)}/tax-returns`)).items,
    /**
     * 409 INVALID_DOCUMENT (another client's, an internal or an infected PDF) or CLIENT_ARCHIVED;
     * 404 for an engagement that is not this client's, a document the firm does not have, or (for
     * Staff) a document of a client they can't reach.
     */
    create: async (clientId: string, body: CreateTaxReturnRequest): Promise<TaxReturn> =>
      request(TaxReturn, `${clientPath(clientId)}/tax-returns`, {
        method: 'POST',
        body: parseInput(CreateTaxReturnRequest, body),
      }),
    /**
     * 409 INVALID_DOCUMENT, INVALID_STATUS or CLIENT_ARCHIVED; 404 as for create. 400
     * VALIDATION_FAILED (filedOn) when the return would be FILED or ACCEPTED without a filed date.
     */
    update: async (id: string, body: UpdateTaxReturnRequest): Promise<TaxReturn> =>
      request(TaxReturn, one(id), {
        method: 'PATCH',
        body: parseInput(UpdateTaxReturnRequest, body),
      }),
    /** Only a return that was never filed (409 RETURN_LOCKED otherwise); 409 CLIENT_ARCHIVED. */
    remove: async (id: string): Promise<OkResponse> =>
      request(OkResponse, one(id), { method: 'DELETE', body: {} }),
  };
}

export type TaxReturnsClient = ReturnType<typeof createTaxReturnsClient>;

/** `api.myTaxReturns(firmSlug)`: the signed-in client's returns at one firm (portal Taxes tab). */
export function createMyTaxReturnsClient(request: ApiRequest, firmSlug: string) {
  return {
    list: async (query: MyTaxReturnsQuery = {}): Promise<MyTaxReturn[]> => {
      const q = toQuery(parseInput(MyTaxReturnsQuery, query));
      return (await request(MyTaxReturnList, `${portalMe(firmSlug)}/tax-returns${q}`)).items;
    },
  };
}

export type MyTaxReturnsClient = ReturnType<typeof createMyTaxReturnsClient>;
