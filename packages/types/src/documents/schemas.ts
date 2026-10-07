import { z } from 'zod';
import { CalendarDate, MemberRef, TaxYear } from '../clients/schemas.js';
import { clearable, text } from '../clients/text.js';

// Secure documents (R5): files a client uploads for an open service, files the firm shares with
// the client or keeps for itself, and document requests ("W-2 from your employer").
// Firm routes: /api/v1/business/... (staff see only the clients they may see, as in R10).
// Portal routes: /api/v1/portal/{firmSlug}/me/... (the signed-in client's own documents only).
//
// Upload, in three calls (the browser helper `uploadFile()` in apps/web/src/lib/upload.ts does
// all three):
//   1. `createUpload` with the file's name, type, size and SHA-256: the API checks the service
//      and the limits and answers an `UploadTicket` (a one-time URL, valid for minutes).
//   2. The browser PUTs the file to `ticket.url` with exactly `ticket.headers` (straight to
//      storage, under the firm's own prefix and key; the API never streams the file).
//   3. `confirmUpload` with `ticket.uploadToken`: the API checks the stored file (size, type,
//      checksum), saves the document and starts the malware scan.
// A file can be downloaded only once its scan is clean: `download` answers a link that works for
// 5 minutes, or 409 SCAN_PENDING / FILE_BLOCKED.
// The portal never sees INTERNAL documents, and never another client's.
// Responses are plain objects (a field the API adds later is dropped, so an open page keeps
// working); requests are strict (unknown fields such as businessId are refused).

const DateTime = z.iso.datetime({ offset: true });

/** What a file may be: PDF, JPG or PNG, at most 10 MB (docs/SYSTEM-DESIGN.md, "Uploads"). */
export const UPLOAD_LIMITS = {
  maxBytes: 10 * 1024 * 1024,
  /** Content type and the file name endings that go with it (for the picker's `accept`). */
  types: {
    'application/pdf': ['.pdf'],
    'image/jpeg': ['.jpg', '.jpeg'],
    'image/png': ['.png'],
  },
} as const;
export const UploadContentType = z.enum(
  Object.keys(UPLOAD_LIMITS.types) as [keyof typeof UPLOAD_LIMITS.types],
  'Upload a PDF, JPG or PNG file',
);
export type UploadContentType = z.infer<typeof UploadContentType>;

/**
 * Tax services take tax documents ("Upload more tax documents for my tax preparer"); every other
 * kind is a business service ("Upload more documents for my business services").
 */
export const TAX_SERVICE_KINDS = ['ANNUAL_TAX', 'QUARTERLY_TAX', 'TAX_PLANNING'] as const;

// The database's enums (R0 publishes them as shared enums; these stay module-local until then).
const Direction = z.enum([
  /** Uploaded by the client. */
  'CLIENT_TO_FIRM',
  /** Shared by the firm with the client. */
  'FIRM_TO_CLIENT',
  /** The firm's own: never shown to the client. */
  'INTERNAL',
]);
const Scan = z.enum(['PENDING', 'CLEAN', 'INFECTED', 'FAILED']);
const RequestStatus = z.enum([
  'REQUESTED',
  /** The client uploaded a file for it ("Received"). */
  'SUBMITTED',
  'ACCEPTED',
  /** The firm marked the upload missing (`statusNote`: why); the client is asked again. */
  'REJECTED',
  /** The client said "I don't have this" (`statusNote`: their reason). */
  'NOT_AVAILABLE',
  'CANCELLED',
]);
export type DocumentRequestStatus = z.infer<typeof RequestStatus>;

export const DocumentId = z.uuid();
export const DocumentRequestId = z.uuid();

const Ref = z.object({ id: z.uuid(), name: z.string() });
/** The service (engagement) a document or request belongs to. */
const ServiceRef = z.object({ id: z.uuid(), title: z.string() });

// ---------- Upload (both sides) ----------
/** What `uploadFile()` learns from the file itself and adds to every `createUpload`. */
const FileFacts = {
  fileName: text(255, 'one', 'The file needs a name'),
  contentType: UploadContentType,
  sizeBytes: z
    .number()
    .int()
    .min(1, 'The file is empty')
    .max(UPLOAD_LIMITS.maxBytes, 'The file is larger than 10 MB'),
  /** SHA-256 of the file, hex; storage refuses the upload if the bytes differ. */
  sha256: z.string().regex(/^[0-9a-f]{64}$/, 'Not a SHA-256'),
};
export type UploadFileFacts = { [K in keyof typeof FileFacts]: z.input<(typeof FileFacts)[K]> };

/** Step 1's answer: where the browser PUTs the file, and how. */
export const UploadTicket = z.object({
  /** Give it back to `confirmUpload`. Opaque. */
  uploadToken: z.string().min(1),
  url: z.string(),
  method: z.literal('PUT'),
  /**
   * Send exactly these with the PUT (the content type and checksum are signed). Never
   * Content-Length: the browser sets it from the file.
   */
  headers: z.record(z.string(), z.string()),
  expiresAt: DateTime,
});
export type UploadTicket = z.infer<typeof UploadTicket>;

/** Step 3: POST .../documents/uploads/confirm. 410 UPLOAD_EXPIRED; 409 UPLOAD_MISMATCH. */
export const ConfirmUploadRequest = z.strictObject({ uploadToken: z.string().min(1).max(4000) });
export type ConfirmUploadRequest = z.input<typeof ConfirmUploadRequest>;

/** GET .../documents/{id}/download: a link for one download, valid for 5 minutes. */
export const DownloadLink = z.object({ url: z.string(), expiresAt: DateTime });
export type DownloadLink = z.infer<typeof DownloadLink>;

// ---------- Firm side ----------
/** A client's document as the firm sees it. */
export const FirmDocument = z.object({
  id: z.uuid(),
  clientId: z.uuid(),
  service: ServiceRef,
  category: Ref.nullable(),
  /** The request it answers. */
  requestId: z.uuid().nullable(),
  direction: Direction,
  fileName: z.string(),
  contentType: z.string(),
  sizeBytes: z.number().int(),
  taxYear: z.number().int().nullable(),
  /** Download works only when CLEAN. */
  scanStatus: Scan,
  /** Who uploaded it: the client (`byClient`) or a firm member. Null for a carried-over file. */
  uploadedBy: z.object({ name: z.string(), byClient: z.boolean() }).nullable(),
  createdAt: DateTime,
});
export type FirmDocument = z.infer<typeof FirmDocument>;

/**
 * GET /business/clients/{clientId}/documents (client record > Documents). Newest first. Search
 * matches the file name. `direction` filters "From the client", "Shared" or "Internal".
 */
export const ListFirmDocumentsQuery = z.strictObject({
  serviceId: z.uuid().optional(),
  categoryId: z.uuid().optional(),
  taxYear: TaxYear.optional(),
  direction: Direction.optional(),
  search: z.string().trim().max(100).optional(),
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional().default(25),
});
export type ListFirmDocumentsQuery = z.input<typeof ListFirmDocumentsQuery>;

export const FirmDocumentList = z.object({
  items: z.array(FirmDocument).max(100),
  /** Null on the last page. */
  nextCursor: z.string().nullable(),
  /** Every tax year among this client's documents, newest first (the "All Years" filter). */
  years: z.array(z.number().int()),
});
export type FirmDocumentList = z.infer<typeof FirmDocumentList>;

/**
 * POST /business/clients/{clientId}/documents/uploads: a file the firm adds to an open service
 * (ACTIVE engagement; 409 NO_OPEN_SERVICE). `shareWithClient` makes it FIRM_TO_CLIENT ("Firm
 * Uploaded Documents" in the portal); otherwise it stays INTERNAL.
 */
export const CreateFirmUploadRequest = z.strictObject({
  serviceId: z.uuid(),
  categoryId: z.uuid().nullable().optional(),
  taxYear: TaxYear.nullable().optional(),
  shareWithClient: z.boolean().optional().default(false),
  ...FileFacts,
});
export type CreateFirmUploadRequest = z.input<typeof CreateFirmUploadRequest>;

/** GET /business/document-categories: the firm's categories, in order. */
export const DocumentCategory = Ref.extend({
  /** Years documents in it are kept; null keeps them for good. */
  retentionYears: z.number().int().nullable(),
  archivedAt: DateTime.nullable(),
});
export type DocumentCategory = z.infer<typeof DocumentCategory>;
export const DocumentCategoryList = z.object({ items: z.array(DocumentCategory) });

/** A document request as the firm sees it. */
export const FirmDocumentRequest = z.object({
  id: z.uuid(),
  clientId: z.uuid(),
  service: ServiceRef,
  category: Ref.nullable(),
  title: z.string(),
  /** Shown to the client. */
  instructions: z.string().nullable(),
  dueOn: CalendarDate.nullable(),
  status: RequestStatus,
  /** Shown to both: the client's reason (NOT_AVAILABLE) or the firm's (REJECTED). */
  statusNote: z.string().nullable(),
  /** The files uploaded for it, newest first. */
  documents: z.array(z.object({ id: z.uuid(), fileName: z.string(), createdAt: DateTime })),
  requestedBy: MemberRef.nullable(),
  createdAt: DateTime,
  resolvedAt: DateTime.nullable(),
});
export type FirmDocumentRequest = z.infer<typeof FirmDocumentRequest>;
export const FirmDocumentRequestList = z.object({ items: z.array(FirmDocumentRequest) });

/** GET /business/clients/{clientId}/document-requests. Newest first. */
export const ListDocumentRequestsQuery = z.strictObject({
  status: RequestStatus.optional(),
  serviceId: z.uuid().optional(),
});
export type ListDocumentRequestsQuery = z.input<typeof ListDocumentRequestsQuery>;

/**
 * POST /business/clients/{clientId}/document-requests ("Request a document"), for an open
 * service (409 NO_OPEN_SERVICE). The client gets a bell and an email (no content).
 */
export const CreateDocumentRequestRequest = z.strictObject({
  serviceId: z.uuid(),
  title: text(200, 'one', 'Say which document you need'),
  instructions: clearable(text(1000, 'many')),
  categoryId: z.uuid().nullable().optional(),
  dueOn: clearable(CalendarDate),
});
export type CreateDocumentRequestRequest = z.input<typeof CreateDocumentRequestRequest>;

/** POST /business/document-requests/{id}/reject ("Mark missing"): the reason goes to the client. */
export const RejectDocumentRequestRequest = z.strictObject({
  reason: text(500, 'many', 'Tell the client what is missing'),
});
export type RejectDocumentRequestRequest = z.input<typeof RejectDocumentRequestRequest>;

// ---------- Portal (the signed-in client) ----------
/**
 * One of the client's documents (My Documents). `source` MINE: they uploaded it; FIRM: the firm
 * shared it. INTERNAL documents never reach the portal.
 */
export const MyDocument = z.object({
  id: z.uuid(),
  source: z.enum(['MINE', 'FIRM']),
  service: ServiceRef,
  category: Ref.nullable(),
  requestId: z.uuid().nullable(),
  fileName: z.string(),
  contentType: z.string(),
  sizeBytes: z.number().int(),
  /** Null shows as "N/A". */
  taxYear: z.number().int().nullable(),
  /** CHECKING: the scan is running (no download yet); BLOCKED: it failed the scan. */
  status: z.enum(['CHECKING', 'READY', 'BLOCKED']),
  /** When the file was stored ("Upload Date"). */
  uploadedAt: DateTime,
});
export type MyDocument = z.infer<typeof MyDocument>;

/** GET /portal/{firmSlug}/me/documents. "View My Uploads" is `source: 'MINE'` (the default). */
export const ListMyDocumentsQuery = z.strictObject({
  source: z.enum(['MINE', 'FIRM']).optional().default('MINE'),
  categoryId: z.uuid().optional(),
  taxYear: TaxYear.optional(),
  search: z.string().trim().max(100).optional(),
  /** "File Name" sorts by name; the default is newest first. */
  sort: z.enum(['newest', 'name']).optional().default('newest'),
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional().default(25),
});
export type ListMyDocumentsQuery = z.input<typeof ListMyDocumentsQuery>;

export const MyDocumentList = z.object({
  items: z.array(MyDocument).max(100),
  nextCursor: z.string().nullable(),
  /** Every tax year in this source, newest first. */
  years: z.array(z.number().int()),
});
export type MyDocumentList = z.infer<typeof MyDocumentList>;

/** An open service the client may upload for, with its open requests. */
const UploadTarget = z.object({
  serviceId: z.uuid(),
  title: z.string(),
  taxYear: z.number().int().nullable(),
  /** REQUESTED or REJECTED requests: an upload for one answers it. */
  openRequests: z.array(
    z.object({ id: z.uuid(), title: z.string(), dueOn: CalendarDate.nullable() }),
  ),
});

/**
 * GET /portal/{firmSlug}/me/documents/upload-targets: what the Upload Documents pop-up offers.
 * An empty list is the STOP state for that choice; both empty: "I don't have an open service".
 */
export const UploadTargets = z.object({
  tax: z.array(UploadTarget),
  business: z.array(UploadTarget),
});
export type UploadTargets = z.infer<typeof UploadTargets>;

/**
 * POST /portal/{firmSlug}/me/documents/uploads. The service must be the client's and open
 * (409 NO_OPEN_SERVICE); a `requestId` must be an open request of that service (409
 * REQUEST_CLOSED), and the upload answers it (SUBMITTED).
 */
export const CreateMyUploadRequest = z.strictObject({
  serviceId: z.uuid(),
  requestId: z.uuid().nullable().optional(),
  categoryId: z.uuid().nullable().optional(),
  taxYear: TaxYear.nullable().optional(),
  ...FileFacts,
});
export type CreateMyUploadRequest = z.input<typeof CreateMyUploadRequest>;

/** GET /portal/{firmSlug}/me/document-categories: the firm's active categories, in order. */
export const MyDocumentCategoryList = z.object({ items: z.array(Ref) });
export type MyDocumentCategory = z.infer<typeof Ref>;

/** A request as the client sees it ("Your Next Steps"). */
export const MyDocumentRequest = z.object({
  id: z.uuid(),
  service: ServiceRef,
  category: Ref.nullable(),
  title: z.string(),
  instructions: z.string().nullable(),
  dueOn: CalendarDate.nullable(),
  status: RequestStatus,
  statusNote: z.string().nullable(),
});
export type MyDocumentRequest = z.infer<typeof MyDocumentRequest>;
export const MyDocumentRequestList = z.object({ items: z.array(MyDocumentRequest) });

/** POST /portal/{firmSlug}/me/document-requests/{id}/not-available ("I don't have this"). */
export const NotAvailableRequest = z.strictObject({
  reason: text(500, 'many', 'Tell your firm why'),
});
export type NotAvailableRequest = z.input<typeof NotAvailableRequest>;

/** Stable `error.code` values of this module, besides the generic ones in ApiError. */
export const DocumentErrorCode = z.enum([
  /** 409: the service is not open (ACTIVE), so nothing can be uploaded or requested for it. */
  'NO_OPEN_SERVICE',
  /** 409: the request is not open (accepted, cancelled, or the client said not available). */
  'REQUEST_CLOSED',
  /** 409: accept or "Mark missing" needs an uploaded file (status SUBMITTED). */
  'NOTHING_SUBMITTED',
  /** 409: the category is archived. */
  'CATEGORY_ARCHIVED',
  /** 410: the upload ticket is too old or was used; start the upload again. */
  'UPLOAD_EXPIRED',
  /** 409: the stored file is not what `createUpload` described (size, type or checksum). */
  'UPLOAD_MISMATCH',
  /** The browser could not PUT the file to storage (from `uploadFile()`, not the API). */
  'UPLOAD_FAILED',
  /** 409: the malware scan has not finished; try again in a moment. */
  'SCAN_PENDING',
  /** 409: the file failed the malware scan and cannot be downloaded. */
  'FILE_BLOCKED',
]);
export type DocumentErrorCode = z.infer<typeof DocumentErrorCode>;
