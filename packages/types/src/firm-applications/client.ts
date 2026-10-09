import { type ApiRequest, parseInput, toQuery } from '../client.js';
import {
  AdminDashboard,
  ApproveFirmApplicationRequest,
  DeclineFirmApplicationRequest,
  FirmApplicationCounts,
  FirmApplicationId,
  FirmApplicationRecord,
  FirmCounts,
  FirmId,
  FirmRecord,
  ListFirmApplicationsQuery,
  ListFirmApplicationsResponse,
  ListFirmsQuery,
  ListFirmsResponse,
  RequestFirmInfoRequest,
  SaveFirmNotesRequest,
  SubmitFirmApplicationRequest,
  SubmitFirmApplicationResponse,
} from './schemas.js';

const BASE = '/admin/firm-applications';
const FIRMS = '/admin/firms';
const one = (id: string) => `${BASE}/${parseInput(FirmApplicationId, id)}`;

/**
 * `api.firmApplications` (apps/web/src/lib/api.ts). `submit` is public (the firm site's apply
 * form); everything else is the Super Admin site's (401 without its session, 403 for anyone who is
 * not a Super Admin). Bad input rejects with ApiRequestError(400, 'VALIDATION_FAILED') before
 * anything is sent, the same error the API gives. Each action returns the updated application.
 */
export function createFirmApplicationsClient(request: ApiRequest) {
  return {
    /** "Submit Application": always `{ received: true }`. 429 RATE_LIMITED. */
    submit: async (body: SubmitFirmApplicationRequest): Promise<SubmitFirmApplicationResponse> =>
      request(SubmitFirmApplicationResponse, '/firm-applications', {
        method: 'POST',
        body: parseInput(SubmitFirmApplicationRequest, body),
      }),

    /** One page, newest first unless `order: 'oldest'`. */
    list: async (query: ListFirmApplicationsQuery = {}): Promise<ListFirmApplicationsResponse> =>
      request(
        ListFirmApplicationsResponse,
        `${BASE}${toQuery(parseInput(ListFirmApplicationsQuery, query))}`,
      ),
    /** The stat cards and tab counts. */
    counts: async (): Promise<FirmApplicationCounts> =>
      request(FirmApplicationCounts, `${BASE}/counts`),
    get: async (id: string): Promise<FirmApplicationRecord> =>
      request(FirmApplicationRecord, one(id)),
    /** Creates the firm and invites its owner. 409 APPLICATION_DECIDED or SLUG_TAKEN. */
    approve: async (
      id: string,
      body: ApproveFirmApplicationRequest = {},
    ): Promise<FirmApplicationRecord> =>
      request(FirmApplicationRecord, `${one(id)}/approve`, {
        method: 'POST',
        body: parseInput(ApproveFirmApplicationRequest, body),
      }),
    /** Emails the applicant; the application stays pending. 409 APPLICATION_DECIDED. */
    requestInfo: async (id: string, body: RequestFirmInfoRequest): Promise<FirmApplicationRecord> =>
      request(FirmApplicationRecord, `${one(id)}/request-info`, {
        method: 'POST',
        body: parseInput(RequestFirmInfoRequest, body),
      }),
    /** 409 APPLICATION_DECIDED. */
    decline: async (
      id: string,
      body: DeclineFirmApplicationRequest,
    ): Promise<FirmApplicationRecord> =>
      request(FirmApplicationRecord, `${one(id)}/decline`, {
        method: 'POST',
        body: parseInput(DeclineFirmApplicationRequest, body),
      }),
    /** "Save Note" (also after a decision). */
    saveNotes: async (id: string, body: SaveFirmNotesRequest): Promise<FirmApplicationRecord> =>
      request(FirmApplicationRecord, `${one(id)}/notes`, {
        method: 'PUT',
        body: parseInput(SaveFirmNotesRequest, body),
      }),
    /**
     * Sends the owner a new activation link (the old one stops working). 409 INVITE_NOT_NEEDED;
     * 429 RATE_LIMITED.
     */
    resendOwnerInvite: async (id: string): Promise<FirmApplicationRecord> =>
      request(FirmApplicationRecord, `${one(id)}/owner-invite`, { method: 'POST', body: {} }),

    /** The firms page: one page, newest first. */
    listFirms: async (query: ListFirmsQuery = {}): Promise<ListFirmsResponse> =>
      request(ListFirmsResponse, `${FIRMS}${toQuery(parseInput(ListFirmsQuery, query))}`),
    firmCounts: async (): Promise<FirmCounts> => request(FirmCounts, `${FIRMS}/counts`),
    getFirm: async (id: string): Promise<FirmRecord> =>
      request(FirmRecord, `${FIRMS}/${parseInput(FirmId, id)}`),

    /** The Super Admin dashboard's counts. */
    dashboard: async (): Promise<AdminDashboard> => request(AdminDashboard, '/admin/dashboard'),
  };
}

export type FirmApplicationsClient = ReturnType<typeof createFirmApplicationsClient>;
