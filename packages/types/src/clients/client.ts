import { type ApiRequest, parseInput } from '../client.js';
import { OkResponse } from '../schemas.js';
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
const one = (id: string) => `${BASE}/${encodeURIComponent(parseInput(ClientId, id))}`;
const year = (id: string, taxYear: number) =>
  `${one(id)}/tax-years/${String(parseInput(TaxYear, taxYear))}`;

/** Query string from the defined values only. */
export function toQuery(values: Record<string, string | number | undefined>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) {
    if (value !== undefined) params.set(key, String(value));
  }
  const query = params.toString();
  return query ? `?${query}` : '';
}

/**
 * `api.clients` (apps/web/src/lib/api.ts): the firm's clients. Owner, Admin and Staff read and
 * edit; archive and restore are Owner and Admin (403 FORBIDDEN otherwise). Another firm's client
 * is 404 NOT_FOUND. Bad input rejects with ApiRequestError(400, 'VALIDATION_FAILED') before
 * anything is sent, the same error the API gives.
 */
export function createClientsClient(request: ApiRequest) {
  return {
    /** One page, newest first; pass `nextCursor` back as `cursor` for the next page. */
    list: async (query: ListClientsQuery = {}): Promise<ListClientsResponse> => {
      const q = parseInput(ListClientsQuery, query);
      return request(ListClientsResponse, `${BASE}${toQuery(q)}`);
    },
    get: async (id: string): Promise<ClientRecord> => request(ClientRecord, one(id)),
    /** 409 DUPLICATE_EMAIL. */
    create: async (body: CreateClientRequest): Promise<ClientRecord> =>
      request(ClientRecord, BASE, { method: 'POST', body: parseInput(CreateClientRequest, body) }),
    /** 409 DUPLICATE_EMAIL or CLIENT_ARCHIVED. */
    update: async (id: string, body: UpdateClientRequest): Promise<ClientRecord> =>
      request(ClientRecord, one(id), {
        method: 'PATCH',
        body: parseInput(UpdateClientRequest, body),
      }),
    /** Owner and Admin. Hidden from the default list; never deleted. */
    archive: async (id: string): Promise<ClientRecord> =>
      request(ClientRecord, `${one(id)}/archive`, { method: 'POST', body: {} }),
    /** Owner and Admin. */
    restore: async (id: string): Promise<ClientRecord> =>
      request(ClientRecord, `${one(id)}/restore`, { method: 'POST', body: {} }),
    /** SSN and date of birth go in here and come back only as ssnLast4 and dateOfBirth. */
    updateProfile: async (id: string, body: UpdateClientProfileRequest): Promise<ClientProfile> =>
      request(ClientProfile, `${one(id)}/profile`, {
        method: 'PUT',
        body: parseInput(UpdateClientProfileRequest, body),
      }),
    /** Newest year first. */
    taxYears: async (id: string): Promise<ClientTaxYear[]> =>
      (await request(ClientTaxYearList, `${one(id)}/tax-years`)).items,
    /** Sets (or first adds) the year's status. 409 TAX_STATUS_ARCHIVED. */
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
 * The client comes from the session, never from the URL.
 */
export function createMyProfileClient(request: ApiRequest, firmSlug: string) {
  const me = `/portal/${encodeURIComponent(firmSlug.toLowerCase())}/me`;
  return {
    get: async (): Promise<MyProfile> => request(MyProfile, `${me}/profile`),
    /** "Save Changes": contact details and additional information. */
    update: async (body: UpdateMyProfileRequest): Promise<MyProfile> =>
      request(MyProfile, `${me}/profile`, {
        method: 'PATCH',
        body: parseInput(UpdateMyProfileRequest, body),
      }),
    /** "Request Name Change": the firm's staff get a task. 409 NAME_CHANGE_PENDING. */
    requestNameChange: async (body: RequestNameChangeRequest): Promise<OkResponse> =>
      request(OkResponse, `${me}/profile/name-change`, {
        method: 'POST',
        body: parseInput(RequestNameChangeRequest, body),
      }),
    /** The status of each tax year and the firm's note, newest first. */
    taxYears: async (): Promise<MyTaxYearList['items']> =>
      (await request(MyTaxYearList, `${me}/tax-years`)).items,
  };
}

export type MyProfileClient = ReturnType<typeof createMyProfileClient>;
