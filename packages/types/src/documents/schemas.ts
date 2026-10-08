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
//      checksum; an Excel or Word file must be a real Office package without macros or a
//      password), saves the document and starts the malware scan.
// A file can be downloaded only once its scan is clean: `download` answers a link that works for
// 5 minutes, always as an attachment, or 409 SCAN_PENDING / FILE_BLOCKED.
// The portal never sees INTERNAL documents, and never another client's. There are no delete
// routes at launch.
// Screens show this module's errors with `errorMessage(error, DOCUMENT_ERRORS)`: errorMessage()
// alone (apps/web/src/lib/errors.ts) knows only the generic codes.
// Responses are plain objects (a field the API adds later is dropped, so an open page keeps
// working); requests are strict (unknown fields such as businessId are refused).

const DateTime = z.iso.datetime({ offset: true });

/**
 * What a file may be, for clients and staff alike: PDF, JPG, PNG, Excel (.xlsx) or Word (.docx),
 * at most 10 MB (docs/SYSTEM-DESIGN.md "Uploads"; Excel and Word from Rasel, Oct 8). Office files
 * only without macros: .xls, .xlsm, .doc, .docm and .csv stay refused (their types are not here,
 * and a name's ending must fit its declared type).
 */
export const UPLOAD_LIMITS = {
  maxBytes: 10 * 1024 * 1024,
  /** The types in words, for the picker's hint and the messages. */
  typeNames: 'PDF, JPG, PNG, Excel (.xlsx) or Word (.docx)',
  /** Content type and the file name endings that go with it (for the picker's `accept`). */
  types: {
    'application/pdf': ['.pdf'],
    'image/jpeg': ['.jpg', '.jpeg'],
    'image/png': ['.png'],
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'],
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['.docx'],
  },
} as const;
export const UploadContentType = z.enum(
  Object.keys(UPLOAD_LIMITS.types) as [keyof typeof UPLOAD_LIMITS.types],
  `Upload a ${UPLOAD_LIMITS.typeNames} file`,
);
export type UploadContentType = z.infer<typeof UploadContentType>;

/**
 * True when the file name (trimmed, in any case) ends in an ending of `contentType` with a name
 * before it: "Budget.XLSX" fits Excel; "Budget.xlsm", "Budget.xls" and ".xlsx" do not.
 */
export function fileNameFitsType(fileName: string, contentType: UploadContentType): boolean {
  const endings: readonly string[] = UPLOAD_LIMITS.types[contentType];
  const name = fileName.trim().toLowerCase();
  return endings.some((ending) => name.endsWith(ending) && name.length > ending.length);
}

/** What a browser says when it has no type for a file (some do for .xlsx and .docx). */
const NO_TYPE: readonly string[] = ['', 'application/octet-stream'];

/**
 * The content type to declare for a picked file (`uploadFile()` uses it): the browser's type when
 * it is one of ours; when the browser gives none ('' or application/octet-stream), the type whose
 * ending the file name has, in any case ("Budget.xlsx" is Excel). Otherwise null: refuse the file.
 * A type the browser gives must still fit the name (`fileNameFitsType`, as `createUpload` checks).
 */
export function uploadContentTypeFor(
  fileName: string,
  browserType: string,
): UploadContentType | null {
  if (Object.hasOwn(UPLOAD_LIMITS.types, browserType)) return browserType as UploadContentType;
  if (!NO_TYPE.includes(browserType)) return null;
  return UploadContentType.options.find((type) => fileNameFitsType(fileName, type)) ?? null;
}

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
  /**
   * The client uploaded a file for it ("Received"). If that file comes back INFECTED or FAILED,
   * the API puts the request back to REQUESTED: the client is asked again.
   */
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
  /**
   * Shown to staff and the client, and the download's name. No control or invisible formatting
   * characters (such as a right-to-left override or a zero-width space), no line or paragraph
   * separators, no / or \. It must end in an ending of its content type (checked with the type).
   */
  fileName: z
    .string()
    .trim()
    .min(1, 'The file needs a name')
    .max(255, 'Use a file name of at most 255 characters')
    .regex(
      /^[^\p{Cc}\p{Cf}\p{Zl}\p{Zp}/\\]+$/u,
      'Rename the file: its name has characters that are not allowed',
    ),
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

/** The name's ending must fit the declared type (".pdf" for a PDF), with a name before it. */
const nameFitsType = (
  body: { fileName: string; contentType: UploadContentType },
  ctx: z.RefinementCtx,
) => {
  if (!fileNameFitsType(body.fileName, body.contentType)) {
    ctx.addIssue({
      code: 'custom',
      path: ['fileName'],
      message: `The file name must end in ${UPLOAD_LIMITS.types[body.contentType].join(' or ')}`,
    });
  }
};

/** Step 1's answer: where the browser PUTs the file, and how. */
export const UploadTicket = z.object({
  /** Give it back to `confirmUpload`. Opaque. */
  uploadToken: z.string().min(1),
  url: z.string(),
  method: z.literal('PUT'),
  /**
   * Send exactly these with the PUT (the content type and checksum are signed). Never
   * Content-Length: the browser sets it from the file (also signed).
   */
  headers: z.record(z.string(), z.string()),
  /** Start the PUT before this (4 minutes); confirm within 5 minutes of the ticket. */
  expiresAt: DateTime,
});
export type UploadTicket = z.infer<typeof UploadTicket>;

/**
 * Step 3: POST .../documents/uploads/confirm. 410 UPLOAD_EXPIRED; 409 UPLOAD_MISMATCH,
 * FILE_PASSWORD_PROTECTED or FILE_HAS_MACROS (the API checks the stored bytes).
 */
export const ConfirmUploadRequest = z.strictObject({ uploadToken: z.string().min(1).max(4000) });
export type ConfirmUploadRequest = z.input<typeof ConfirmUploadRequest>;

/**
 * GET .../documents/{id}/download: a link for one download, valid for 5 minutes. Always an
 * attachment (the browser saves the file; it never opens inline), whatever the type.
 */
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
  /**
   * The exact scan result; download works only when CLEAN. PENDING: still being checked (also
   * while a scan that broke on our side waits for its rescan). INFECTED: malware found. FAILED:
   * the file itself couldn't be scanned. INFECTED and FAILED are final: the file is uploaded again.
   */
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
 * POST /business/clients/{clientId}/documents/uploads: a file the firm adds to an open service.
 * 404 for a service or category that isn't this client's or firm's; then 409 NO_OPEN_SERVICE
 * (not ACTIVE) or CATEGORY_ARCHIVED. `shareWithClient` makes it FIRM_TO_CLIENT ("Firm Uploaded
 * Documents" in the portal); otherwise it stays INTERNAL.
 */
export const CreateFirmUploadRequest = z
  .strictObject({
    serviceId: z.uuid(),
    categoryId: z.uuid().nullable().optional(),
    taxYear: TaxYear.nullable().optional(),
    shareWithClient: z.boolean().optional().default(false),
    ...FileFacts,
  })
  .superRefine(nameFitsType);
export type CreateFirmUploadRequest = z.input<typeof CreateFirmUploadRequest>;

/** GET /business/document-categories: the firm's categories, in order. */
export const DocumentCategory = Ref.extend({
  /** Years documents in it are kept; null keeps them for good. */
  retentionYears: z.number().int().nullable(),
  archivedAt: DateTime.nullable(),
});
export type DocumentCategory = z.infer<typeof DocumentCategory>;
export const DocumentCategoryList = z.object({ items: z.array(DocumentCategory) });
export type DocumentCategoryList = z.infer<typeof DocumentCategoryList>;

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
/** At most the 200 newest. */
export const FirmDocumentRequestList = z.object({ items: z.array(FirmDocumentRequest).max(200) });

/** GET /business/clients/{clientId}/document-requests. Newest first. */
export const ListDocumentRequestsQuery = z.strictObject({
  status: RequestStatus.optional(),
  serviceId: z.uuid().optional(),
});
export type ListDocumentRequestsQuery = z.input<typeof ListDocumentRequestsQuery>;

/**
 * POST /business/clients/{clientId}/document-requests ("Request a document"), for an open
 * service: 404 for a service or category that isn't the client's or firm's, then 409
 * NO_OPEN_SERVICE or CATEGORY_ARCHIVED. The client gets a bell and an email (no content).
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
  /**
   * CHECKING: the scan is running (no download yet). READY: it can be downloaded. BLOCKED: it
   * can't be downloaded (INFECTED or FAILED for the firm); the screen shows
   * `PORTAL_BLOCKED_TEXT[source]` and never says it failed the malware scan.
   */
  status: z.enum(['CHECKING', 'READY', 'BLOCKED']),
  /** When the file was stored ("Upload Date"). */
  uploadedAt: DateTime,
});
export type MyDocument = z.infer<typeof MyDocument>;

/**
 * What the portal shows for a BLOCKED document, by its `source`: on its row and for its
 * FILE_BLOCKED. Never that it failed the malware scan (Rasel, Oct 8).
 */
export const PORTAL_BLOCKED_TEXT = {
  /** The client's own upload: they upload it again. */
  MINE: "This file couldn't be checked. Please upload it again.",
  /** A file the firm shared: the client can't upload it, the firm shares it again. */
  FIRM: "This file couldn't be checked. Ask your firm to share it again.",
} as const satisfies Record<MyDocument['source'], string>;

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
  /**
   * REQUESTED or REJECTED requests: an upload for one answers it. A SUBMITTED request is back
   * here (REQUESTED) once its newest file comes back INFECTED or FAILED.
   */
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
 * POST /portal/{firmSlug}/me/documents/uploads. 404 for a service, request or category that
 * isn't the client's or their firm's; then 409 NO_OPEN_SERVICE (service not ACTIVE),
 * REQUEST_CLOSED (request of another service, or not open: a SUBMITTED request takes no second
 * file until the firm marks it missing or its newest file comes back INFECTED or FAILED) or
 * CATEGORY_ARCHIVED. An upload with a `requestId` answers it (SUBMITTED). A replacement is a new
 * upload for the same request; the old file stays.
 */
export const CreateMyUploadRequest = z
  .strictObject({
    serviceId: z.uuid(),
    requestId: z.uuid().nullable().optional(),
    categoryId: z.uuid().nullable().optional(),
    taxYear: TaxYear.nullable().optional(),
    ...FileFacts,
  })
  .superRefine(nameFitsType);
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
/** At most 200: open ones first, then the newest. */
export const MyDocumentRequestList = z.object({ items: z.array(MyDocumentRequest).max(200) });

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
  /**
   * 409: accept or "Mark missing" needs an uploaded file (status SUBMITTED). A request whose
   * newest file came back INFECTED or FAILED is REQUESTED again.
   */
  'NOTHING_SUBMITTED',
  /** 409: the category is archived. */
  'CATEGORY_ARCHIVED',
  /** 410: the upload ticket is too old or was used; start the upload again. */
  'UPLOAD_EXPIRED',
  /**
   * 409 (confirm): the stored file is not what `createUpload` described: its size or checksum
   * differs, or its bytes are not its type (a renamed file, or an Office file that isn't a real
   * .xlsx or .docx package). A renamed .xlsm or .docm is FILE_HAS_MACROS instead.
   */
  'UPLOAD_MISMATCH',
  /**
   * 409 (confirm): an Excel or Word file saved with a password. Office then saves an encrypted
   * container, not a ZIP, so nothing in it can be checked. Tell the user: "Remove the password and
   * upload the file again."
   */
  'FILE_PASSWORD_PROTECTED',
  /**
   * 409 (confirm): the Excel or Word file holds macros: a vbaProject or vbaData part, or a
   * macro-enabled content type (so also an .xlsm or .docm renamed to .xlsx or .docx). Tell the
   * user: "Save it as a regular .xlsx or .docx without macros and upload again."
   */
  'FILE_HAS_MACROS',
  /**
   * 400 from `uploadFile()`, before anything is sent (the API answers VALIDATION_FAILED for the
   * same): the file is not a PDF, JPG, PNG, .xlsx or .docx by its type and its name's ending.
   */
  'FILE_TYPE_NOT_ALLOWED',
  /** 400 from `uploadFile()`, before anything is sent: the file is empty. */
  'FILE_EMPTY',
  /** 400 from `uploadFile()`, before anything is sent: the file is larger than 10 MB. */
  'FILE_TOO_LARGE',
  /** The browser could not PUT the file to storage (from `uploadFile()`, not the API). */
  'UPLOAD_FAILED',
  /**
   * 409: the malware scan has not finished (a download, or accepting a request whose newest file
   * is still being checked); try again in a moment.
   */
  'SCAN_PENDING',
  /**
   * 409: the file can't be downloaded: malware was found (INFECTED) or it couldn't be scanned
   * (FAILED). The portal never says it failed the malware scan: it shows
   * `PORTAL_BLOCKED_TEXT[source]`.
   */
  'FILE_BLOCKED',
]);
export type DocumentErrorCode = z.infer<typeof DocumentErrorCode>;

/**
 * What users see for this module's codes: `errorMessage(error, DOCUMENT_ERRORS)` on the upload
 * pop-up, My Documents and the firm's Documents tab. FILE_BLOCKED here is safe for both sides; on
 * the portal show `PORTAL_BLOCKED_TEXT[source]` for that document instead, and the firm's screen
 * may name its exact scanStatus.
 */
export const DOCUMENT_ERRORS = {
  NO_OPEN_SERVICE: 'This service is not open, so nothing can be uploaded or requested for it.',
  REQUEST_CLOSED: 'This request is no longer open. Reload and try again.',
  NOTHING_SUBMITTED: 'Nothing has been uploaded for this request yet.',
  CATEGORY_ARCHIVED: 'This category is archived. Choose another one.',
  UPLOAD_EXPIRED: 'This upload has expired. Please try again.',
  UPLOAD_MISMATCH: "This file doesn't match its type. Check the file and upload it again.",
  FILE_PASSWORD_PROTECTED: 'Remove the password and upload the file again.',
  FILE_HAS_MACROS: 'Save it as a regular .xlsx or .docx without macros and upload again.',
  FILE_TYPE_NOT_ALLOWED: `Upload a ${UPLOAD_LIMITS.typeNames} file.`,
  FILE_EMPTY: 'This file is empty. Choose another file.',
  FILE_TOO_LARGE: 'This file is larger than 10 MB. Choose a smaller file.',
  UPLOAD_FAILED: 'The upload did not go through. Check your connection and try again.',
  SCAN_PENDING: 'This file is still being checked. Try again in a moment.',
  FILE_BLOCKED: "This file couldn't be checked, so it can't be downloaded.",
} as const satisfies Record<DocumentErrorCode, string>;
