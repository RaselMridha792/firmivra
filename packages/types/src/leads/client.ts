import { type ApiRequest, parseInput, toQuery } from '../client.js';
import {
  ConvertLeadRequest,
  ConvertLeadResponse,
  DeclineLeadRequest,
  DownloadLink,
  LeadCounts,
  LeadDetail,
  LeadId,
  LeadUploadId,
  LeadList,
  ListLeadsQuery,
} from './schemas.js';

const one = (id: string) => `/business/leads/${parseInput(LeadId, id)}`;

/**
 * `api.leads` (apps/web/src/lib/api.ts): the firm's Begin Online leads inbox. Owner, Admin and
 * Staff. Another firm's lead, and a lead the visitor has not sent, are 404 NOT_FOUND. Bad input
 * rejects with ApiRequestError(400, 'VALIDATION_FAILED') before anything is sent.
 */
export function createLeadsClient(request: ApiRequest) {
  return {
    /** Newest sent first, paged by `nextCursor`. */
    list: async (query: ListLeadsQuery = {}): Promise<LeadList> =>
      request(LeadList, `/business/leads${toQuery(parseInput(ListLeadsQuery, query))}`),
    /** The badge on the menu: leads waiting for the firm. */
    counts: async (): Promise<LeadCounts> => request(LeadCounts, '/business/leads/count'),
    /** The lead with its answers (SSN and EIN as last 4 only) and its files. */
    get: async (id: string): Promise<LeadDetail> => request(LeadDetail, one(id)),
    /** SUBMITTED to IN_REVIEW (someone is on it). 409 INVALID_STATUS from any other status. */
    startReview: async (id: string): Promise<LeadDetail> =>
      request(LeadDetail, `${one(id)}/review`, { method: 'POST', body: {} }),
    /**
     * 409 INVALID_STATUS (already converted or declined), DUPLICATE_EMAIL (a new client's email is
     * another client's: pass that `clientId`), CLIENT_ARCHIVED; 404 for a client the member does
     * not reach (Staff: not theirs) or a member not active in this firm; 403 FORBIDDEN when Staff
     * assign someone else.
     */
    convert: async (id: string, body: ConvertLeadRequest = {}): Promise<ConvertLeadResponse> =>
      request(ConvertLeadResponse, `${one(id)}/convert`, {
        method: 'POST',
        body: parseInput(ConvertLeadRequest, body),
      }),
    /** 409 INVALID_STATUS. The reason is never sent to the visitor. */
    decline: async (id: string, body: DeclineLeadRequest): Promise<LeadDetail> =>
      request(LeadDetail, `${one(id)}/decline`, {
        method: 'POST',
        body: parseInput(DeclineLeadRequest, body),
      }),
    /** A short-lived link to one CLEAN file; 409 FILE_NOT_AVAILABLE otherwise. */
    downloadUpload: async (id: string, uploadId: string): Promise<DownloadLink> =>
      request(DownloadLink, `${one(id)}/uploads/${parseInput(LeadUploadId, uploadId)}/download`),
  };
}

export type LeadsClient = ReturnType<typeof createLeadsClient>;
