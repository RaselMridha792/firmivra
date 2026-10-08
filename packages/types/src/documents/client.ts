import { type ApiRequest, parseInput, toQuery } from '../client.js';
import { clientPath, portalMe } from '../clients/client.js';
import {
  ConfirmUploadRequest,
  CreateDocumentRequestRequest,
  CreateFirmUploadRequest,
  CreateMyUploadRequest,
  DocumentCategory,
  DocumentCategoryList,
  DocumentId,
  DocumentRequestId,
  DownloadLink,
  FirmDocument,
  FirmDocumentList,
  FirmDocumentRequest,
  FirmDocumentRequestList,
  ListDocumentRequestsQuery,
  ListFirmDocumentsQuery,
  ListMyDocumentsQuery,
  MyDocument,
  type MyDocumentCategory,
  MyDocumentCategoryList,
  MyDocumentList,
  MyDocumentRequest,
  MyDocumentRequestList,
  NotAvailableRequest,
  RejectDocumentRequestRequest,
  UploadTargets,
  UploadTicket,
} from './schemas.js';

const doc = (id: string) => `/business/documents/${parseInput(DocumentId, id)}`;
const req = (id: string) => `/business/document-requests/${parseInput(DocumentRequestId, id)}`;

/**
 * `api.documents` (apps/web/src/lib/api.ts): a client's documents and document requests, for the
 * firm (client record > Documents). Staff reach only the clients they may see (others are 404,
 * as in api.clients). Upload with `uploadFile()` (apps/web/src/lib/upload.ts):
 *   uploadFile(file, {
 *     start: (facts) => api.documents.createUpload(clientId, { serviceId, ...facts }),
 *     finish: (uploadToken) => api.documents.confirmUpload({ uploadToken }),
 *   })
 * Bad input rejects with ApiRequestError(400, 'VALIDATION_FAILED') before anything is sent.
 */
export function createDocumentsClient(request: ApiRequest) {
  return {
    /** One page, newest first; pass `nextCursor` back as `cursor`. */
    list: async (clientId: string, query: ListFirmDocumentsQuery = {}): Promise<FirmDocumentList> =>
      request(
        FirmDocumentList,
        `${clientPath(clientId)}/documents${toQuery(parseInput(ListFirmDocumentsQuery, query))}`,
      ),
    get: async (id: string): Promise<FirmDocument> => request(FirmDocument, doc(id)),
    /** Step 1 of an upload. 409 NO_OPEN_SERVICE or CATEGORY_ARCHIVED. */
    createUpload: async (clientId: string, body: CreateFirmUploadRequest): Promise<UploadTicket> =>
      request(UploadTicket, `${clientPath(clientId)}/documents/uploads`, {
        method: 'POST',
        body: parseInput(CreateFirmUploadRequest, body),
      }),
    /**
     * Step 3: saves the document. 410 UPLOAD_EXPIRED; 409 UPLOAD_MISMATCH, FILE_PASSWORD_PROTECTED
     * or FILE_HAS_MACROS.
     */
    confirmUpload: async (body: ConfirmUploadRequest): Promise<FirmDocument> =>
      request(FirmDocument, '/business/documents/uploads/confirm', {
        method: 'POST',
        body: parseInput(ConfirmUploadRequest, body),
      }),
    /** A 5-minute link, always a download (never inline). 409 SCAN_PENDING or FILE_BLOCKED. */
    download: async (id: string): Promise<DownloadLink> =>
      request(DownloadLink, `${doc(id)}/download`),

    /** The firm's categories in order; archived ones too, for old documents. */
    categories: async (): Promise<DocumentCategory[]> =>
      (await request(DocumentCategoryList, '/business/document-categories')).items,

    /** The client's document requests, newest first. */
    requests: async (
      clientId: string,
      query: ListDocumentRequestsQuery = {},
    ): Promise<FirmDocumentRequest[]> =>
      (
        await request(
          FirmDocumentRequestList,
          `${clientPath(clientId)}/document-requests${toQuery(parseInput(ListDocumentRequestsQuery, query))}`,
        )
      ).items,
    /** "Request a document". 409 NO_OPEN_SERVICE or CATEGORY_ARCHIVED. */
    createRequest: async (
      clientId: string,
      body: CreateDocumentRequestRequest,
    ): Promise<FirmDocumentRequest> =>
      request(FirmDocumentRequest, `${clientPath(clientId)}/document-requests`, {
        method: 'POST',
        body: parseInput(CreateDocumentRequestRequest, body),
      }),
    /**
     * Accept the uploaded file. 409 NOTHING_SUBMITTED, SCAN_PENDING (its newest file is still
     * being checked) or REQUEST_CLOSED.
     */
    acceptRequest: async (id: string): Promise<FirmDocumentRequest> =>
      request(FirmDocumentRequest, `${req(id)}/accept`, { method: 'POST', body: {} }),
    /** "Mark missing": the client is asked again. 409 NOTHING_SUBMITTED or REQUEST_CLOSED. */
    rejectRequest: async (
      id: string,
      body: RejectDocumentRequestRequest,
    ): Promise<FirmDocumentRequest> =>
      request(FirmDocumentRequest, `${req(id)}/reject`, {
        method: 'POST',
        body: parseInput(RejectDocumentRequestRequest, body),
      }),
    /** Never deleted. 409 REQUEST_CLOSED once accepted or cancelled. */
    cancelRequest: async (id: string): Promise<FirmDocumentRequest> =>
      request(FirmDocumentRequest, `${req(id)}/cancel`, { method: 'POST', body: {} }),
  };
}

export type DocumentsClient = ReturnType<typeof createDocumentsClient>;

/**
 * `api.myDocuments(firmSlug)`: the signed-in client's documents at one firm (My Documents). Only
 * their own, never INTERNAL ones; a download needs a clean scan. Upload for an open service:
 *   uploadFile(file, {
 *     start: (facts) => api.myDocuments(slug).createUpload({ serviceId, requestId, ...facts }),
 *     finish: (uploadToken) => api.myDocuments(slug).confirmUpload({ uploadToken }),
 *   })
 */
export function createMyDocumentsClient(request: ApiRequest, firmSlug: string) {
  const base = () => `${portalMe(firmSlug)}/documents`;
  const one = (id: string) => `${base()}/${parseInput(DocumentId, id)}`;
  return {
    /** "My Uploaded Documents" (default) or the firm's shared files (`source: 'FIRM'`). */
    list: async (query: ListMyDocumentsQuery = {}): Promise<MyDocumentList> =>
      request(MyDocumentList, `${base()}${toQuery(parseInput(ListMyDocumentsQuery, query))}`),
    get: async (id: string): Promise<MyDocument> => request(MyDocument, one(id)),
    /** What the Upload Documents pop-up may offer (tax and business services that are open). */
    uploadTargets: async (): Promise<UploadTargets> =>
      request(UploadTargets, `${base()}/upload-targets`),
    /** Step 1. 409 NO_OPEN_SERVICE, REQUEST_CLOSED or CATEGORY_ARCHIVED. */
    createUpload: async (body: CreateMyUploadRequest): Promise<UploadTicket> =>
      request(UploadTicket, `${base()}/uploads`, {
        method: 'POST',
        body: parseInput(CreateMyUploadRequest, body),
      }),
    /**
     * Step 3. 410 UPLOAD_EXPIRED; 409 UPLOAD_MISMATCH, FILE_PASSWORD_PROTECTED or FILE_HAS_MACROS
     * (DOCUMENT_ERRORS has what to tell the client).
     */
    confirmUpload: async (body: ConfirmUploadRequest): Promise<MyDocument> =>
      request(MyDocument, `${base()}/uploads/confirm`, {
        method: 'POST',
        body: parseInput(ConfirmUploadRequest, body),
      }),
    /**
     * A 5-minute link, always a download (never inline). 409 SCAN_PENDING, or FILE_BLOCKED (show
     * `PORTAL_BLOCKED_TEXT[source]`, never that it failed the malware scan).
     */
    download: async (id: string): Promise<DownloadLink> =>
      request(DownloadLink, `${one(id)}/download`),
    /** The firm's active categories, for the upload pop-up and the filter. */
    categories: async (): Promise<MyDocumentCategory[]> =>
      (await request(MyDocumentCategoryList, `${portalMe(firmSlug)}/document-categories`)).items,
    /** The client's document requests, open ones first. */
    requests: async (): Promise<MyDocumentRequest[]> =>
      (await request(MyDocumentRequestList, `${portalMe(firmSlug)}/document-requests`)).items,
    /** "I don't have this". 409 REQUEST_CLOSED. */
    notAvailable: async (id: string, body: NotAvailableRequest): Promise<MyDocumentRequest> =>
      request(
        MyDocumentRequest,
        `${portalMe(firmSlug)}/document-requests/${parseInput(DocumentRequestId, id)}/not-available`,
        { method: 'POST', body: parseInput(NotAvailableRequest, body) },
      ),
  };
}

export type MyDocumentsClient = ReturnType<typeof createMyDocumentsClient>;
