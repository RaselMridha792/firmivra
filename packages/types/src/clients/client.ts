import { type ApiRequest, parseInput, toQuery } from '../client.js';
import { FirmSlug, OkResponse } from '../schemas.js';
import {
  ClientId,
  ClientProfile,
  ClientRecord,
  ClientTaxYear,
  ClientTaxYearHistory,
  ClientTaxYearList,
  CreateClientRequest,
  ListClientsQuery,
  ListClientsResponse,
  MyProfile,
  MyTaxYearList,
  RequestNameChangeRequest,
  SetClientTaxYearRequest,
  TaxYear,
  UpdateClientProfileRequest,
  UpdateClientRequest,
  UpdateMyProfileRequest,
} from './schemas.js';

const BASE = '/business/clients';
/** A client's path. Exported for the engagements and tax-returns clients. */
export const clientPath = (id: string) => `${BASE}/${parseInput(ClientId, id)}`;
const year = (id: string, taxYear: number) =>
  `${clientPath(id)}/tax-years/${String(parseInput(TaxYear, taxYear))}`;
/** The signed-in client's portal base. Checked when called, so a bad slug rejects, never throws. */
export const portalMe = (firmSlug: string) => `/portal/${parseInput(FirmSlug, firmSlug)}/me`;

/**
 * `api.clients` (apps/web/src/lib/api.ts): the firm's clients. Owner and Admin see all; Staff see
 * and edit only their own (others are 404 NOT_FOUND, as is another firm's client). Archive,
 * restore and the assignee are Owner and Admin (403 FORBIDDEN). Bad input rejects with
 * ApiRequestError(400, 'VALIDATION_FAILED') before anything is sent, the same error the API gives.
 */
export function createClientsClient(request: ApiRequest) {
  return {
    /** One page, newest first; pass `nextCursor` back as `cursor` for the next page. */
    list: async (query: ListClientsQuery = {}): Promise<ListClientsResponse> =>
      request(ListClientsResponse, `${BASE}${toQuery(parseInput(ListClientsQuery, query))}`),
    get: async (id: string): Promise<ClientRecord> => request(ClientRecord, clientPath(id)),
    /** 409 DUPLICATE_EMAIL. Staff: the client is assigned to them. */
    create: async (body: CreateClientRequest): Promise<ClientRecord> =>
      request(ClientRecord, BASE, { method: 'POST', body: parseInput(CreateClientRequest, body) }),
    /** 409 DUPLICATE_EMAIL or CLIENT_ARCHIVED. */
    update: async (id: string, body: UpdateClientRequest): Promise<ClientRecord> =>
      request(ClientRecord, clientPath(id), {
        method: 'PATCH',
        body: parseInput(UpdateClientRequest, body),
      }),
    /** Owner and Admin. Hidden from the default list; never deleted. Repeating is harmless. */
    archive: async (id: string): Promise<ClientRecord> =>
      request(ClientRecord, `${clientPath(id)}/archive`, { method: 'POST', body: {} }),
    /** Owner and Admin. */
    restore: async (id: string): Promise<ClientRecord> =>
      request(ClientRecord, `${clientPath(id)}/restore`, { method: 'POST', body: {} }),
    /**
     * SSN, EIN and date of birth go in here and come back only as ssnLast4, einLast4 and
     * dateOfBirth. 409 CLIENT_ARCHIVED.
     */
    updateProfile: async (id: string, body: UpdateClientProfileRequest): Promise<ClientProfile> =>
      request(ClientProfile, `${clientPath(id)}/profile`, {
        method: 'PUT',
        body: parseInput(UpdateClientProfileRequest, body),
      }),
    /** Newest year first. */
    taxYears: async (id: string): Promise<ClientTaxYear[]> =>
      (await request(ClientTaxYearList, `${clientPath(id)}/tax-years`)).items,
    /** Sets (or first adds) the year's status. 409 TAX_STATUS_ARCHIVED or CLIENT_ARCHIVED. */
    setTaxYear: async (
      id: string,
      taxYear: number,
      body: SetClientTaxYearRequest,
    ): Promise<ClientTaxYear> =>
      request(ClientTaxYear, year(id, taxYear), {
        method: 'PUT',
        body: parseInput(SetClientTaxYearRequest, body),
      }),
    /** Every change of the year's status or client note, newest first. */
    taxYearHistory: async (id: string, taxYear: number): Promise<ClientTaxYearHistory['items']> =>
      (await request(ClientTaxYearHistory, `${year(id, taxYear)}/history`)).items,
  };
}

export type ClientsClient = ReturnType<typeof createClientsClient>;

/**
 * `api.myProfile(firmSlug)`: the signed-in client's own record at one firm (portal "My Profile").
 * The client comes from the session, never from the URL. Changes are for the primary login only
 * (403 FORBIDDEN for spouse and authorized logins).
 */
export function createMyProfileClient(request: ApiRequest, firmSlug: string) {
  return {
    get: async (): Promise<MyProfile> => request(MyProfile, `${portalMe(firmSlug)}/profile`),
    /** "Save Changes": contact details and additional information. */
    update: async (body: UpdateMyProfileRequest): Promise<MyProfile> =>
      request(MyProfile, `${portalMe(firmSlug)}/profile`, {
        method: 'PATCH',
        body: parseInput(UpdateMyProfileRequest, body),
      }),
    /** "Request Name Change": the firm's staff get a task. 409 NAME_CHANGE_PENDING. */
    requestNameChange: async (body: RequestNameChangeRequest): Promise<OkResponse> =>
      request(OkResponse, `${portalMe(firmSlug)}/profile/name-change`, {
        method: 'POST',
        body: parseInput(RequestNameChangeRequest, body),
      }),
    /** The status of each tax year and the firm's note, newest first. */
    taxYears: async (): Promise<MyTaxYearList['items']> =>
      (await request(MyTaxYearList, `${portalMe(firmSlug)}/tax-years`)).items,
  };
}

export type MyProfileClient = ReturnType<typeof createMyProfileClient>;
