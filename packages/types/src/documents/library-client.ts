import { z } from 'zod';
import { type ApiRequest, parseInput, toQuery } from '../client.js';
import { OkResponse } from '../schemas.js';
import {
  BulkDocumentsRequest,
  BulkDocumentsResult,
  BulkRequestPacketsRequest,
  BulkRequestPacketsResult,
  CancelRequestPacketRequest,
  CreateDocumentCategoryRequest,
  CreateDocumentFolderRequest,
  CreateDocumentShareRequest,
  CreateLibraryUploadRequest,
  CreateRequestItemRequest,
  CreateRequestPacketRequest,
  CreateRequestTemplateRequest,
  DocumentAccess,
  DocumentActivityList,
  DocumentFolder,
  DocumentFolderId,
  DocumentFolderList,
  DocumentRequestItemId,
  DocumentRequestPacketId,
  DocumentRequestTemplateId,
  DocumentSettings,
  DocumentShare,
  DocumentShareId,
  DocumentVersionList,
  LibraryDocument,
  LibraryPage,
  LibraryQuery,
  LibrarySummary,
  ReorderDocumentFoldersRequest,
  ReorderRequestItemsRequest,
  RequestPacketDetail,
  RequestPacketPage,
  RequestPacketsQuery,
  RequestPacketSummary,
  RequestTemplate,
  RequestTemplateList,
  RequestTemplatesQuery,
  ReviewDocumentRequest,
  UpdateDocumentCategoryRequest,
  UpdateDocumentFolderRequest,
  UpdateDocumentSettingsRequest,
  UpdateDocumentShareRequest,
  UpdateLibraryDocumentRequest,
  UpdateRequestItemRequest,
  UpdateRequestPacketRequest,
  UpdateRequestTemplateRequest,
} from './library.js';
import { DocumentCategory, DocumentId, DownloadLink, UploadTicket } from './schemas.js';

const DOCS = '/business/documents';
const FOLDERS = '/business/document-folders';
const CATEGORIES = '/business/document-categories';
const PACKETS = '/business/document-request-packets';
const TEMPLATES = '/business/document-request-templates';
const SETTINGS = '/business/document-settings';
const doc = (id: string) => `${DOCS}/${parseInput(DocumentId, id)}`;
const folder = (id: string) => `${FOLDERS}/${parseInput(DocumentFolderId, id)}`;
const packet = (id: string) => `${PACKETS}/${parseInput(DocumentRequestPacketId, id)}`;
const item = (id: string, itemId: string) =>
  `${packet(id)}/items/${parseInput(DocumentRequestItemId, itemId)}`;
const template = (id: string) => `${TEMPLATES}/${parseInput(DocumentRequestTemplateId, id)}`;
const share = (id: string, shareId: string) =>
  `${doc(id)}/shares/${parseInput(DocumentShareId, shareId)}`;
const post = (body: unknown = {}) => ({ method: 'POST', body });
const patch = (body: unknown) => ({ method: 'PATCH', body });

/**
 * `api.documentLibrary` (apps/web/src/lib/api.ts): the firm-wide Documents module (library,
 * upload, details and review, sharing, folders, requests dashboard, Create Request, templates,
 * settings). R5's `api.documents` stays for a client's own Documents tab, the item accept/reject
 * routes and the upload confirm step. Bad input rejects with ApiRequestError(400,
 * 'VALIDATION_FAILED') before anything is sent. No business id is ever sent.
 *
 * Upload (Frame 1) with `uploadFile()`:
 *   uploadFile(file, {
 *     start: (facts) => api.documentLibrary.createUpload({ clientId, serviceId, ...facts }),
 *     confirm: (body) => api.documents.confirmUpload(body),
 *   })
 */
export function createDocumentLibraryClient(request: ApiRequest) {
  return {
    // Library
    list: async (query: LibraryQuery = {}): Promise<LibraryPage> =>
      request(LibraryPage, `${DOCS}${toQuery(parseInput(LibraryQuery, query))}`),
    summary: async (): Promise<LibrarySummary> => request(LibrarySummary, `${DOCS}/summary`),
    /** Frame 2's details (R5's GET /business/documents/{id} keeps its older shape). */
    get: async (id: string): Promise<LibraryDocument> =>
      request(LibraryDocument, `${doc(id)}/details`),
    createUpload: async (body: CreateLibraryUploadRequest): Promise<UploadTicket> =>
      request(UploadTicket, `${DOCS}/uploads`, post(parseInput(CreateLibraryUploadRequest, body))),
    update: async (id: string, body: UpdateLibraryDocumentRequest): Promise<LibraryDocument> =>
      request(LibraryDocument, doc(id), patch(parseInput(UpdateLibraryDocumentRequest, body))),
    review: async (id: string, body: ReviewDocumentRequest): Promise<LibraryDocument> =>
      request(LibraryDocument, `${doc(id)}/review`, post(parseInput(ReviewDocumentRequest, body))),
    archive: async (id: string): Promise<LibraryDocument> =>
      request(LibraryDocument, `${doc(id)}/archive`, post()),
    restore: async (id: string): Promise<LibraryDocument> =>
      request(LibraryDocument, `${doc(id)}/restore`, post()),
    /** Move to Trash (DELETE capability); `untrash` brings it back. */
    trash: async (id: string): Promise<LibraryDocument> =>
      request(LibraryDocument, `${doc(id)}/trash`, post()),
    untrash: async (id: string): Promise<LibraryDocument> =>
      request(LibraryDocument, `${doc(id)}/untrash`, post()),
    versions: async (id: string): Promise<DocumentVersionList['items']> =>
      (await request(DocumentVersionList, `${doc(id)}/versions`)).items,
    activity: async (id: string): Promise<DocumentActivityList['items']> =>
      (await request(DocumentActivityList, `${doc(id)}/activity`)).items,
    /** An inline view link (CLEAN only: 409 FILE_NOT_CLEAN). */
    preview: async (id: string): Promise<DownloadLink> =>
      request(DownloadLink, `${doc(id)}/preview`),
    bulk: async (body: BulkDocumentsRequest): Promise<BulkDocumentsResult> =>
      request(BulkDocumentsResult, `${DOCS}/bulk`, post(parseInput(BulkDocumentsRequest, body))),

    // Sharing
    access: async (id: string): Promise<DocumentAccess> =>
      request(DocumentAccess, `${doc(id)}/access`),
    share: async (id: string, body: CreateDocumentShareRequest): Promise<DocumentShare> =>
      request(
        DocumentShare,
        `${doc(id)}/shares`,
        post(parseInput(CreateDocumentShareRequest, body)),
      ),
    updateShare: async (
      id: string,
      shareId: string,
      body: UpdateDocumentShareRequest,
    ): Promise<DocumentShare> =>
      request(
        DocumentShare,
        share(id, shareId),
        patch(parseInput(UpdateDocumentShareRequest, body)),
      ),
    revokeShare: async (id: string, shareId: string): Promise<OkResponse> =>
      request(OkResponse, `${share(id, shareId)}/revoke`, post()),
    accessHistory: async (id: string): Promise<DocumentActivityList['items']> =>
      (await request(DocumentActivityList, `${doc(id)}/access-history`)).items,

    // Folders and categories
    folders: async (): Promise<DocumentFolderList['items']> =>
      (await request(DocumentFolderList, FOLDERS)).items,
    createFolder: async (body: CreateDocumentFolderRequest): Promise<DocumentFolder> =>
      request(DocumentFolder, FOLDERS, post(parseInput(CreateDocumentFolderRequest, body))),
    updateFolder: async (id: string, body: UpdateDocumentFolderRequest): Promise<DocumentFolder> =>
      request(DocumentFolder, folder(id), patch(parseInput(UpdateDocumentFolderRequest, body))),
    /** 409 FOLDER_NOT_EMPTY while it has documents or subfolders. */
    deleteFolder: async (id: string): Promise<OkResponse> =>
      request(OkResponse, folder(id), { method: 'DELETE' }),
    reorderFolders: async (
      body: ReorderDocumentFoldersRequest,
    ): Promise<DocumentFolderList['items']> =>
      (
        await request(
          DocumentFolderList,
          `${FOLDERS}/reorder`,
          post(parseInput(ReorderDocumentFoldersRequest, body)),
        )
      ).items,
    createCategory: async (body: CreateDocumentCategoryRequest): Promise<DocumentCategory> =>
      request(DocumentCategory, CATEGORIES, post(parseInput(CreateDocumentCategoryRequest, body))),
    updateCategory: async (
      id: string,
      body: UpdateDocumentCategoryRequest,
    ): Promise<DocumentCategory> =>
      request(
        DocumentCategory,
        `${CATEGORIES}/${parseInput(z.uuid(), id)}`,
        patch(parseInput(UpdateDocumentCategoryRequest, body)),
      ),

    // Requests dashboard and Create Request
    requests: async (query: RequestPacketsQuery = {}): Promise<RequestPacketPage> =>
      request(RequestPacketPage, `${PACKETS}${toQuery(parseInput(RequestPacketsQuery, query))}`),
    requestSummary: async (): Promise<RequestPacketSummary> =>
      request(RequestPacketSummary, `${PACKETS}/summary`),
    request: async (id: string): Promise<RequestPacketDetail> =>
      request(RequestPacketDetail, packet(id)),
    /** Save as Draft, or Send (`send: true`). Retry-safe by `idempotencyKey`. */
    createRequest: async (body: CreateRequestPacketRequest): Promise<RequestPacketDetail> =>
      request(RequestPacketDetail, PACKETS, post(parseInput(CreateRequestPacketRequest, body))),
    updateRequest: async (
      id: string,
      body: UpdateRequestPacketRequest,
    ): Promise<RequestPacketDetail> =>
      request(RequestPacketDetail, packet(id), patch(parseInput(UpdateRequestPacketRequest, body))),
    sendRequest: async (id: string): Promise<RequestPacketDetail> =>
      request(RequestPacketDetail, `${packet(id)}/send`, post()),
    resendRequest: async (id: string): Promise<RequestPacketDetail> =>
      request(RequestPacketDetail, `${packet(id)}/resend`, post()),
    remindRequest: async (id: string): Promise<RequestPacketDetail> =>
      request(RequestPacketDetail, `${packet(id)}/remind`, post()),
    completeRequest: async (id: string): Promise<RequestPacketDetail> =>
      request(RequestPacketDetail, `${packet(id)}/complete`, post()),
    cancelRequest: async (
      id: string,
      body: CancelRequestPacketRequest = {},
    ): Promise<RequestPacketDetail> =>
      request(
        RequestPacketDetail,
        `${packet(id)}/cancel`,
        post(parseInput(CancelRequestPacketRequest, body)),
      ),
    bulkRequests: async (body: BulkRequestPacketsRequest): Promise<BulkRequestPacketsResult> =>
      request(
        BulkRequestPacketsResult,
        `${PACKETS}/bulk`,
        post(parseInput(BulkRequestPacketsRequest, body)),
      ),
    /** Checklist items: a draft only (409 REQUEST_SENT after sending). */
    addItem: async (id: string, body: CreateRequestItemRequest): Promise<RequestPacketDetail> =>
      request(
        RequestPacketDetail,
        `${packet(id)}/items`,
        post(parseInput(CreateRequestItemRequest, body)),
      ),
    updateItem: async (
      id: string,
      itemId: string,
      body: UpdateRequestItemRequest,
    ): Promise<RequestPacketDetail> =>
      request(
        RequestPacketDetail,
        item(id, itemId),
        patch(parseInput(UpdateRequestItemRequest, body)),
      ),
    /** Takes the item off the draft (it is cancelled, never deleted). */
    removeItem: async (id: string, itemId: string): Promise<RequestPacketDetail> =>
      request(RequestPacketDetail, item(id, itemId), { method: 'DELETE' }),
    reorderItems: async (
      id: string,
      body: ReorderRequestItemsRequest,
    ): Promise<RequestPacketDetail> =>
      request(
        RequestPacketDetail,
        `${packet(id)}/items/reorder`,
        post(parseInput(ReorderRequestItemsRequest, body)),
      ),

    // Templates and saved lists
    templates: async (query: RequestTemplatesQuery = {}): Promise<RequestTemplateList['items']> =>
      (
        await request(
          RequestTemplateList,
          `${TEMPLATES}${toQuery(parseInput(RequestTemplatesQuery, query))}`,
        )
      ).items,
    createTemplate: async (body: CreateRequestTemplateRequest): Promise<RequestTemplate> =>
      request(RequestTemplate, TEMPLATES, post(parseInput(CreateRequestTemplateRequest, body))),
    updateTemplate: async (
      id: string,
      body: UpdateRequestTemplateRequest,
    ): Promise<RequestTemplate> =>
      request(RequestTemplate, template(id), patch(parseInput(UpdateRequestTemplateRequest, body))),
    archiveTemplate: async (id: string): Promise<OkResponse> =>
      request(OkResponse, `${template(id)}/archive`, post()),

    // Settings
    settings: async (): Promise<DocumentSettings> => request(DocumentSettings, SETTINGS),
    updateSettings: async (body: UpdateDocumentSettingsRequest): Promise<DocumentSettings> =>
      request(DocumentSettings, SETTINGS, patch(parseInput(UpdateDocumentSettingsRequest, body))),
  };
}
export type DocumentLibraryClient = ReturnType<typeof createDocumentLibraryClient>;
