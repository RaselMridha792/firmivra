import type { z } from 'zod';
import { ApiRequestError, type ApiRequest, parseInput, toQuery } from '../client.js';
import { portalMe } from '../clients/client.js';
import { OkResponse } from '../schemas.js';
import { DownloadLink, type UploadFileFacts, UploadTicket } from '../documents/schemas.js';
import { ESIGN_ERRORS } from './errors.js';
import {
  ConfirmEsignUploadBody,
  EsignCorrectRecipientBody,
  CreateEsignRequestBody,
  CreateEsignUploadBody,
  EsignDocument,
  EsignDocumentId,
  EsignDownloadFile,
  EsignEventList,
  EsignFromVaultBody,
  EsignMergeValues,
  EsignReadiness,
  EsignRecipientId,
  EsignRequestDetail,
  EsignRequestId,
  EsignContentType,
  EsignRequestList,
  EsignStatus,
  EsignSummary,
  ListEsignRequestsQuery,
  MySignaturesStatus,
  EsignPutFieldsBody,
  EsignPutPagePlanBody,
  EsignPutRecipientsBody,
  EsignRemindBody,
  EsignReplaceBody,
  EsignResendCopyBody,
  SendEsignRequestBody,
  UpdateEsignRequestBody,
  EsignVoidBody,
} from './schemas.js';

const BASE = '/esign';
const one = (id: string) => `${BASE}/requests/${parseInput(EsignRequestId, id)}`;

/**
 * `api.esign` (apps/web/src/lib/api.ts): Firm Sign's signature requests, for the firm
 * (docs/api/esign.yaml). Every call but `status()` answers 403 MODULE_OFF when Firm Sign is off.
 * Upload a file with `uploadFile()` (apps/web/src/lib/upload.ts):
 *   uploadFile(file, {
 *     start: (facts) => api.esign.createUpload(requestId, facts),
 *     finish: (uploadToken) => api.esign.confirmUpload(requestId, { uploadToken }),
 *   })
 * Bad input rejects with ApiRequestError(400, 'VALIDATION_FAILED') before anything is sent.
 * `baseUrl` is the one given to `createRequest` (for `documentContentUrl`).
 */
export function createEsignClient(request: ApiRequest, baseUrl = '/api/v1') {
  const post = <S extends z.ZodType>(schema: S, path: string, body: unknown) =>
    request(schema, path, { method: 'POST', body });
  const put = <S extends z.ZodType>(schema: S, path: string, body: unknown) =>
    request(schema, path, { method: 'PUT', body });
  return {
    /** Whether Firm Sign is on, and the caller's access in it. Never MODULE_OFF. */
    status: async (): Promise<EsignStatus> => request(EsignStatus, `${BASE}/status`),

    /** One page, newest activity first; pass `nextCursor` back as `cursor`. */
    list: async (query: ListEsignRequestsQuery = {}): Promise<EsignRequestList> =>
      request(
        EsignRequestList,
        `${BASE}/requests${toQuery(parseInput(ListEsignRequestsQuery, query))}`,
      ),
    /** The dashboard's 9 counters and the quick filters' counts. */
    summary: async (): Promise<EsignSummary> => request(EsignSummary, `${BASE}/requests/summary`),
    get: async (id: string): Promise<EsignRequestDetail> => request(EsignRequestDetail, one(id)),
    /** A new DRAFT. 409 ENGAGEMENT_MISMATCH. */
    create: async (body: CreateEsignRequestBody): Promise<EsignRequestDetail> =>
      post(EsignRequestDetail, `${BASE}/requests`, parseInput(CreateEsignRequestBody, body)),
    /** DRAFT only. 409 INVALID_STATE, ENGAGEMENT_MISMATCH or RECIPIENTS_LINKED. */
    update: async (id: string, body: UpdateEsignRequestBody): Promise<EsignRequestDetail> =>
      request(EsignRequestDetail, one(id), {
        method: 'PATCH',
        body: parseInput(UpdateEsignRequestBody, body),
      }),
    /** Deletes a DRAFT that was never sent. 409 INVALID_STATE. */
    discard: async (id: string): Promise<OkResponse> =>
      request(OkResponse, one(id), { method: 'DELETE' }),

    /**
     * Upload step 1 (DRAFT only). Takes `uploadFile()`'s facts: an Excel or Word file, which
     * uploadFile lets through, rejects here with 400 FILE_TYPE_NOT_ALLOWED before anything is sent.
     * Give the picker `accept` from ESIGN_UPLOAD_TYPES.
     */
    createUpload: async (
      id: string,
      body: CreateEsignUploadBody | UploadFileFacts,
    ): Promise<UploadTicket> => {
      if (!EsignContentType.safeParse(body.contentType).success) {
        throw new ApiRequestError(400, 'FILE_TYPE_NOT_ALLOWED', ESIGN_ERRORS.FILE_TYPE_NOT_ALLOWED);
      }
      return post(
        UploadTicket,
        `${one(id)}/documents/uploads`,
        parseInput(CreateEsignUploadBody, body),
      );
    },
    /** Upload step 3: the file's pages join the end of the page plan. */
    confirmUpload: async (id: string, body: ConfirmEsignUploadBody): Promise<EsignDocument> =>
      post(
        EsignDocument,
        `${one(id)}/documents/uploads/confirm`,
        parseInput(ConfirmEsignUploadBody, body),
      ),
    /** Copy one of the client's CLEAN PDF, JPG or PNG documents into the request. */
    addFromVault: async (id: string, body: EsignFromVaultBody): Promise<EsignDocument> =>
      post(EsignDocument, `${one(id)}/documents/from-vault`, parseInput(EsignFromVaultBody, body)),
    /** Removes a file, its pages and their fields (DRAFT only). */
    removeDocument: async (id: string, documentId: string): Promise<EsignRequestDetail> =>
      request(
        EsignRequestDetail,
        `${one(id)}/documents/${parseInput(EsignDocumentId, documentId)}`,
        { method: 'DELETE' },
      ),
    /**
     * Same-origin address of a file's bytes, for the page viewer (pdfjs fetches it with the
     * session cookie). 409 SCAN_PENDING or FILE_BLOCKED until the file is CLEAN. Not a call:
     * nothing is sent until the viewer loads it.
     */
    documentContentUrl: (id: string, documentId: string): string =>
      `${baseUrl}${one(id)}/documents/${parseInput(EsignDocumentId, documentId)}/content`,
    putPagePlan: async (id: string, body: EsignPutPagePlanBody): Promise<EsignRequestDetail> =>
      put(EsignRequestDetail, `${one(id)}/page-plan`, parseInput(EsignPutPagePlanBody, body)),
    putRecipients: async (id: string, body: EsignPutRecipientsBody): Promise<EsignRequestDetail> =>
      put(EsignRequestDetail, `${one(id)}/recipients`, parseInput(EsignPutRecipientsBody, body)),
    putFields: async (id: string, body: EsignPutFieldsBody): Promise<EsignRequestDetail> =>
      put(EsignRequestDetail, `${one(id)}/fields`, parseInput(EsignPutFieldsBody, body)),
    mergeValues: async (id: string): Promise<EsignMergeValues> =>
      request(EsignMergeValues, `${one(id)}/merge-values`),
    readiness: async (id: string): Promise<EsignReadiness> =>
      request(EsignReadiness, `${one(id)}/readiness`),
    /** 409 NOT_READY or INVALID_STATE. */
    send: async (id: string, body: SendEsignRequestBody): Promise<EsignRequestDetail> =>
      post(EsignRequestDetail, `${one(id)}/send`, parseInput(SendEsignRequestBody, body)),

    /** 409 REMIND_TOO_SOON or REQUEST_CLOSED. */
    remind: async (id: string, body: EsignRemindBody = {}): Promise<EsignRequestDetail> =>
      post(EsignRequestDetail, `${one(id)}/remind`, parseInput(EsignRemindBody, body)),
    /** 409 REQUEST_CLOSED. */
    void: async (id: string, body: EsignVoidBody): Promise<EsignRequestDetail> =>
      post(EsignRequestDetail, `${one(id)}/void`, parseInput(EsignVoidBody, body)),
    /** 409 RECIPIENT_DONE or REQUEST_CLOSED. */
    correctRecipient: async (
      id: string,
      recipientId: string,
      body: EsignCorrectRecipientBody,
    ): Promise<EsignRequestDetail> =>
      post(
        EsignRequestDetail,
        `${one(id)}/recipients/${parseInput(EsignRecipientId, recipientId)}/correct`,
        parseInput(EsignCorrectRecipientBody, body),
      ),
    /** Voids it and answers the new DRAFT. 409 REQUEST_CLOSED. */
    replace: async (id: string, body: EsignReplaceBody): Promise<EsignRequestDetail> =>
      post(EsignRequestDetail, `${one(id)}/replace`, parseInput(EsignReplaceBody, body)),
    /** COMPLETED only (409 INVALID_STATE). */
    resendCopy: async (id: string, body: EsignResendCopyBody = {}): Promise<OkResponse> =>
      post(OkResponse, `${one(id)}/resend-copy`, parseInput(EsignResendCopyBody, body)),
    /** A 5-minute download link. 409 INVALID_STATE before the file exists. */
    download: async (id: string, file: EsignDownloadFile): Promise<DownloadLink> =>
      request(
        DownloadLink,
        `${one(id)}/download${toQuery({ file: parseInput(EsignDownloadFile, file) })}`,
      ),
    /** The timeline, oldest first. */
    events: async (id: string): Promise<EsignEventList> =>
      request(EsignEventList, `${one(id)}/events`),
  };
}

export type EsignClient = ReturnType<typeof createEsignClient>;

/**
 * `api.mySignatures(firmSlug)`: the signed-in client's Signature center at one firm. This
 * contract has only `status()`, for the portal menu's 'Signatures' line; the list, signing and
 * downloads come in contract 2.
 */
export function createMySignaturesClient(request: ApiRequest, firmSlug: string) {
  const base = () => `${portalMe(firmSlug)}/signatures`;
  return {
    status: async (): Promise<MySignaturesStatus> =>
      request(MySignaturesStatus, `${base()}/status`),
  };
}

export type MySignaturesClient = ReturnType<typeof createMySignaturesClient>;
