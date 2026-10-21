import { z } from 'zod';
import { CalendarDate, MemberRef, TaxYear } from '../clients/schemas.js';
import { clearable, SearchText, text } from '../clients/text.js';
import {
  DocumentDirection,
  DocumentFolderScope,
  DocumentRequestPacketStatus,
  DocumentRequestStatus,
  DocumentReviewStatus,
  FolderClientAccess,
  FolderColor,
  ScanStatus,
} from '../db-enums.js';
import {
  UPLOAD_FILE_FACTS,
  UPLOAD_LIMITS,
  UploadContentType,
  uploadNameFitsType,
} from './schemas.js';

// The firm-wide Documents module (R55 contract, for R56's screens): the library (main page,
// Frames 1 Upload, 2 Details and Review, 5 Share), the requests dashboard and Create Request
// (Frames 3 and 4), folders, request templates and settings (Frame 6). Designs and guide:
// docs/mockups/firm-workspace/documents/source/. API brief: docs/work/briefs/r37-intake-docs-tax-api.md.
// It adds to R5's per-client contract (schemas.ts, client.ts), which stays as it is.
//
// Every document belongs to a client and one of that client's services (engagement): the
// database has no firm-only or lead documents yet, so "Upload for: Firm" is a FIRM-scope folder
// for an INTERNAL document of a client. Request packets go to a client (or a member, for one
// client's work). Sharing is with the client's portal logins or members only: no public or
// external links. Firm routes under /api/v1/business, `@Access('DOCUMENTS', capability)`; Staff
// reach only their own clients (others 404). Every change is audited (ids and field names only).

const DateTime = z.iso.datetime({ offset: true });
const NamedRef = z.object({ id: z.uuid(), name: z.string() });
const ServiceRef = z.object({ id: z.uuid(), title: z.string() });
const Page = { total: z.number().int(), page: z.number().int(), pageSize: z.number().int() };
const page = {
  page: z.coerce.number().int().min(1).optional().default(1),
  pageSize: z.coerce.number().int().min(1).max(100).optional().default(10),
};
/** At most 20 tags of 1 to 40 characters; the database refuses duplicates ignoring case. */
const Tags = z.array(text(40)).max(20, 'Use at most 20 tags');
const Note500 = clearable(text(500, 'many'));

export const DocumentFolderId = z.uuid();
export const DocumentRequestPacketId = z.uuid();
export const DocumentRequestItemId = z.uuid();
export const DocumentRequestTemplateId = z.uuid();
export const DocumentShareId = z.uuid();

// ---------- Library (main page, Frame 2) ----------

/** Which documents a list shows: live ones, the archived ones, or the trash. */
export const LibraryScope = z.enum(['active', 'archived', 'trash']);
export type LibraryScope = z.infer<typeof LibraryScope>;

/** One document of the firm-wide library (table row and Frame 2's Document Information). */
export const LibraryDocument = z.object({
  id: z.uuid(),
  fileName: z.string(),
  contentType: z.string(),
  sizeBytes: z.number().int(),
  client: NamedRef,
  service: ServiceRef,
  folder: z.object({ id: z.uuid(), name: z.string(), color: FolderColor }).nullable(),
  category: NamedRef.nullable(),
  direction: DocumentDirection,
  taxYear: z.number().int().nullable(),
  description: z.string().nullable(),
  tags: z.array(z.string()),
  /** Null: no review needed. "Signed" is not a review status (Firm Sign keeps it). */
  reviewStatus: DocumentReviewStatus.nullable(),
  reviewer: MemberRef.nullable(),
  reviewedAt: DateTime.nullable(),
  reviewedBy: MemberRef.nullable(),
  /** Download and preview only when CLEAN. */
  scanStatus: ScanStatus,
  /** The document's own validity (a license, an ID), not its retention. */
  expiresOn: CalendarDate.nullable(),
  versionNo: z.number().int(),
  /** The version this one replaces; null for version 1. */
  replacesId: z.uuid().nullable(),
  /** A newer version replaced it (it stays readable in the version history). */
  superseded: z.boolean(),
  /** The request item it answers. */
  requestId: z.uuid().nullable(),
  /** The client can see it: shared by the firm, or uploaded by the client. */
  visibleToClient: z.boolean(),
  uploadedBy: z.object({ name: z.string(), byClient: z.boolean() }).nullable(),
  createdAt: DateTime,
  updatedAt: DateTime,
  archivedAt: DateTime.nullable(),
  trashedAt: DateTime.nullable(),
});
export type LibraryDocument = z.infer<typeof LibraryDocument>;

/**
 * GET /business/documents: the firm-wide library. Search matches the file name, client, category,
 * service, description and tags. `folderId: 'firm'` / `'client'` are the panel's Firm Documents
 * and Client Documents (documents in FIRM- or CLIENT-scope folders and without a folder).
 */
export const LibraryQuery = z.strictObject({
  scope: LibraryScope.optional().default('active'),
  folderId: z.union([z.uuid(), z.enum(['firm', 'client'])]).optional(),
  clientId: z.uuid().optional(),
  serviceId: z.uuid().optional(),
  categoryId: z.uuid().optional(),
  taxYear: z.coerce.number().int().min(2000).max(2100).optional(),
  reviewStatus: DocumentReviewStatus.optional(),
  reviewerUserId: z.uuid().optional(),
  direction: DocumentDirection.optional(),
  tag: text(40).optional(),
  uploadedFrom: CalendarDate.optional(),
  uploadedTo: CalendarDate.optional(),
  search: SearchText.optional(),
  sort: z.enum(['newest', 'oldest', 'name', 'size', 'client']).optional().default('newest'),
  ...page,
});
export type LibraryQuery = z.input<typeof LibraryQuery>;

export const LibraryPage = z.object({ items: z.array(LibraryDocument).max(100), ...Page });
export type LibraryPage = z.infer<typeof LibraryPage>;

/** GET /business/documents/summary: the KPI cards and the folder panel's counts. */
export const LibrarySummary = z.object({
  all: z.number().int(),
  /** Uploaded in the last 7 days. */
  recentlyUploaded: z.number().int(),
  /** Review status NEEDS_REVIEW or IN_REVIEW. */
  needsReview: z.number().int(),
  /** Review status VERIFIED or COMPLETED. */
  completed: z.number().int(),
  /** Open request items still waiting for a file (REQUESTED or REJECTED). */
  missing: z.number().int(),
  folders: z.object({
    firm: z.number().int(),
    client: z.number().int(),
    archived: z.number().int(),
    trash: z.number().int(),
    byFolder: z.array(z.object({ folderId: z.uuid(), count: z.number().int() })),
  }),
});
export type LibrarySummary = z.infer<typeof LibrarySummary>;

/**
 * POST /business/documents/uploads (Frame 1), then R5's POST /business/documents/uploads/confirm
 * with the ticket. `shareWithClient` makes it FIRM_TO_CLIENT (else INTERNAL); `notifyClient`
 * needs it. `replacesId` uploads a new version of that document (same client and service).
 * `requestId` answers a request item.
 */
export const CreateLibraryUploadRequest = z
  .strictObject({
    clientId: z.uuid(),
    /** The client's service (engagement); required: every document belongs to one. */
    serviceId: z.uuid(),
    categoryId: z.uuid().nullable().optional(),
    folderId: z.uuid().nullable().optional(),
    taxYear: TaxYear.nullable().optional(),
    description: Note500,
    tags: Tags.optional(),
    reviewerUserId: z.uuid().nullable().optional(),
    expiresOn: CalendarDate.nullable().optional(),
    shareWithClient: z.boolean().optional().default(false),
    notifyClient: z.boolean().optional().default(false),
    replacesId: z.uuid().nullable().optional(),
    requestId: z.uuid().nullable().optional(),
    ...UPLOAD_FILE_FACTS,
  })
  .superRefine(uploadNameFitsType)
  .refine((b) => !b.notifyClient || b.shareWithClient, {
    path: ['notifyClient'],
    message: 'Share the document with the client to notify them',
  });
export type CreateLibraryUploadRequest = z.input<typeof CreateLibraryUploadRequest>;

/** PATCH /business/documents/{id}: Edit Details, Rename, Move (the file itself never changes). */
export const UpdateLibraryDocumentRequest = z
  .strictObject({
    fileName: text(255),
    description: Note500,
    tags: Tags,
    folderId: z.uuid().nullable(),
    categoryId: z.uuid().nullable(),
    taxYear: TaxYear.nullable(),
    reviewerUserId: z.uuid().nullable(),
    expiresOn: CalendarDate.nullable(),
  })
  .partial()
  .refine((b) => Object.keys(b).length > 0, 'Change something first');
export type UpdateLibraryDocumentRequest = z.input<typeof UpdateLibraryDocumentRequest>;

/**
 * POST /business/documents/{id}/review: Start Review, Mark Verified, Request Replacement (with a
 * reason, sent to the client when the document answers a request item), Complete.
 */
export const ReviewDocumentRequest = z.discriminatedUnion('action', [
  z.strictObject({ action: z.literal('START') }),
  z.strictObject({ action: z.literal('VERIFY') }),
  z.strictObject({ action: z.literal('REQUEST_REPLACEMENT'), reason: text(500, 'many') }),
  z.strictObject({ action: z.literal('COMPLETE') }),
]);
export type ReviewDocumentRequest = z.input<typeof ReviewDocumentRequest>;

/** GET /business/documents/{id}/versions: the version chain, newest first. */
export const DocumentVersionList = z.object({
  items: z.array(
    z.object({
      id: z.uuid(),
      versionNo: z.number().int(),
      fileName: z.string(),
      sizeBytes: z.number().int(),
      scanStatus: ScanStatus,
      uploadedBy: z.object({ name: z.string(), byClient: z.boolean() }).nullable(),
      createdAt: DateTime,
      current: z.boolean(),
    }),
  ),
});
export type DocumentVersionList = z.infer<typeof DocumentVersionList>;

/** One entry of a document's or a request's activity (from the audit log; never content). */
export const DocumentActivity = z.object({
  id: z.uuid(),
  at: DateTime,
  kind: z.enum([
    'UPLOADED',
    'DOWNLOADED',
    'RENAMED',
    'UPDATED',
    'MOVED',
    'REVIEW',
    'REPLACED',
    'SHARED',
    'SHARE_CHANGED',
    'SHARE_REVOKED',
    'ARCHIVED',
    'RESTORED',
    'TRASHED',
    'REQUEST_CREATED',
    'REQUEST_SENT',
    'REQUEST_REMINDED',
    'REQUEST_RECEIVED',
    'REQUEST_COMPLETED',
    'REQUEST_CANCELLED',
    'OTHER',
  ]),
  label: z.string(),
  by: z.string().nullable(),
});
export type DocumentActivity = z.infer<typeof DocumentActivity>;
export const DocumentActivityList = z.object({ items: z.array(DocumentActivity).max(200) });
export type DocumentActivityList = z.infer<typeof DocumentActivityList>;

/** POST /business/documents/bulk: the selected-rows bar (at most 100). */
export const BulkDocumentsRequest = z.discriminatedUnion('action', [
  z.strictObject({
    action: z.literal('MOVE'),
    ids: z.array(z.uuid()).min(1).max(100),
    folderId: z.uuid().nullable(),
  }),
  z.strictObject({
    action: z.literal('RECLASSIFY'),
    ids: z.array(z.uuid()).min(1).max(100),
    categoryId: z.uuid().nullable(),
  }),
  z.strictObject({
    action: z.literal('ASSIGN_REVIEWER'),
    ids: z.array(z.uuid()).min(1).max(100),
    reviewerUserId: z.uuid().nullable(),
  }),
  z.strictObject({ action: z.literal('ARCHIVE'), ids: z.array(z.uuid()).min(1).max(100) }),
  /** Short-lived links, one per CLEAN document (each download is audited). */
  z.strictObject({ action: z.literal('DOWNLOAD'), ids: z.array(z.uuid()).min(1).max(100) }),
]);
export type BulkDocumentsRequest = z.input<typeof BulkDocumentsRequest>;

export const BulkDocumentsResult = z.object({
  updated: z.number().int(),
  /** Documents left out, each with an error code (NOT_FOUND, FILE_NOT_CLEAN, ...). */
  skipped: z.array(z.object({ id: z.uuid(), code: z.string() })),
  links: z.array(z.object({ id: z.uuid(), url: z.string(), expiresAt: DateTime })).optional(),
});
export type BulkDocumentsResult = z.infer<typeof BulkDocumentsResult>;

// ---------- Sharing (Frame 5) ----------

export const DocumentShare = z.object({
  id: z.uuid(),
  recipient: z.object({
    kind: z.enum(['CLIENT', 'MEMBER']),
    /** The client login's id (CLIENT) or the member's user id (MEMBER). */
    id: z.uuid(),
    name: z.string(),
    email: z.string().nullable(),
  }),
  /** Viewing is implied by any grant. */
  canDownload: z.boolean(),
  /** Upload a new version (never overwrite). */
  canUpload: z.boolean(),
  canSign: z.boolean(),
  expiresAt: DateTime.nullable(),
  grantedBy: MemberRef.nullable(),
  createdAt: DateTime,
});
export type DocumentShare = z.infer<typeof DocumentShare>;

/** GET /business/documents/{id}/access: current access and who it can be shared with. */
export const DocumentAccess = z.object({
  document: z.object({
    id: z.uuid(),
    fileName: z.string(),
    versionNo: z.number().int(),
    direction: DocumentDirection,
  }),
  shares: z.array(DocumentShare),
  /** The client's portal logins (an INTERNAL document cannot be shared with them). */
  clientLogins: z.array(
    z.object({ id: z.uuid(), name: z.string(), email: z.string(), primary: z.boolean() }),
  ),
});
export type DocumentAccess = z.infer<typeof DocumentAccess>;

/** POST /business/documents/{id}/shares. One live grant per person (409 SHARE_EXISTS). */
export const CreateDocumentShareRequest = z.strictObject({
  recipient: z.discriminatedUnion('kind', [
    z.strictObject({ kind: z.literal('CLIENT'), clientAccountId: z.uuid() }),
    z.strictObject({ kind: z.literal('MEMBER'), userId: z.uuid() }),
  ]),
  canDownload: z.boolean().optional().default(true),
  canUpload: z.boolean().optional().default(false),
  canSign: z.boolean().optional().default(false),
  /** In the future; null never expires. */
  expiresAt: DateTime.nullable().optional(),
  notify: z.boolean().optional().default(false),
});
export type CreateDocumentShareRequest = z.input<typeof CreateDocumentShareRequest>;

/** PATCH /business/documents/{id}/shares/{shareId}: permissions and expiry. */
export const UpdateDocumentShareRequest = z
  .strictObject({
    canDownload: z.boolean(),
    canUpload: z.boolean(),
    canSign: z.boolean(),
    expiresAt: DateTime.nullable(),
  })
  .partial()
  .refine((b) => Object.keys(b).length > 0, 'Change something first');
export type UpdateDocumentShareRequest = z.input<typeof UpdateDocumentShareRequest>;

// ---------- Folders and categories (Frame 6) ----------

export const DocumentFolder = z.object({
  id: z.uuid(),
  name: z.string(),
  description: z.string().nullable(),
  parentId: z.uuid().nullable(),
  /** CLIENT folders hold client documents; FIRM folders internal ones. Fixed at creation. */
  scope: DocumentFolderScope,
  color: FolderColor,
  sortOrder: z.number().int(),
  requireExpiryDate: z.boolean(),
  remindBeforeExpiry: z.boolean(),
  allowClientUploads: z.boolean(),
  notifyStaffOnUpload: z.boolean(),
  defaultClientAccess: FolderClientAccess,
  documentCount: z.number().int(),
  subfolderCount: z.number().int(),
  createdAt: DateTime,
  updatedAt: DateTime,
});
export type DocumentFolder = z.infer<typeof DocumentFolder>;

/** GET /business/document-folders: the live folders, flat (build the tree from parentId). */
export const DocumentFolderList = z.object({ items: z.array(DocumentFolder).max(1000) });
export type DocumentFolderList = z.infer<typeof DocumentFolderList>;

const FolderSettings = {
  description: Note500,
  color: FolderColor.optional(),
  requireExpiryDate: z.boolean().optional(),
  remindBeforeExpiry: z.boolean().optional(),
  /** FIRM folders: always false. */
  allowClientUploads: z.boolean().optional(),
  notifyStaffOnUpload: z.boolean().optional(),
  /** FIRM folders: always NONE. */
  defaultClientAccess: FolderClientAccess.optional(),
};

/** POST /business/document-folders (Add Folder). At most 5 levels; names unique per parent. */
export const CreateDocumentFolderRequest = z.strictObject({
  name: text(80),
  parentId: z.uuid().nullable().optional(),
  /** A subfolder takes its parent's scope. */
  scope: DocumentFolderScope.optional().default('CLIENT'),
  ...FolderSettings,
});
export type CreateDocumentFolderRequest = z.input<typeof CreateDocumentFolderRequest>;

/** PATCH /business/document-folders/{id}. A new parentId moves it (same scope, no cycles). */
export const UpdateDocumentFolderRequest = z
  .strictObject({ name: text(80), parentId: z.uuid().nullable(), ...FolderSettings })
  .partial()
  .refine((b) => Object.keys(b).length > 0, 'Change something first');
export type UpdateDocumentFolderRequest = z.input<typeof UpdateDocumentFolderRequest>;

/** POST /business/document-folders/reorder: one parent's children in their new order. */
export const ReorderDocumentFoldersRequest = z.strictObject({
  parentId: z.uuid().nullable(),
  ids: z.array(z.uuid()).min(1).max(200),
});
export type ReorderDocumentFoldersRequest = z.input<typeof ReorderDocumentFoldersRequest>;

/** POST /business/document-categories (document types). */
export const CreateDocumentCategoryRequest = z.strictObject({
  name: text(80),
  /** Years documents of this type are kept; null keeps them for good. */
  retentionYears: z.number().int().min(1).max(100).nullable().optional(),
});
export type CreateDocumentCategoryRequest = z.input<typeof CreateDocumentCategoryRequest>;

/** PATCH /business/document-categories/{id}; `archived` hides it from new uploads. */
export const UpdateDocumentCategoryRequest = z
  .strictObject({
    name: text(80),
    retentionYears: z.number().int().min(1).max(100).nullable(),
    archived: z.boolean(),
  })
  .partial()
  .refine((b) => Object.keys(b).length > 0, 'Change something first');
export type UpdateDocumentCategoryRequest = z.input<typeof UpdateDocumentCategoryRequest>;

// ---------- Request packets (Frames 3 and 4) ----------

/**
 * The dashboard's status, computed from the packet, its items and dates: Outstanding (sent,
 * nothing received), Partially Received, Ready for Review (every required item received),
 * Overdue (open after its due date), Expired (open after its expiry).
 */
export const RequestPacketView = z.enum([
  'DRAFT',
  'OUTSTANDING',
  'PARTIALLY_RECEIVED',
  'READY_FOR_REVIEW',
  'OVERDUE',
  'EXPIRED',
  'COMPLETED',
  'CANCELLED',
]);
export type RequestPacketView = z.infer<typeof RequestPacketView>;

/** One checklist item (a `document_requests` row). */
export const RequestItem = z.object({
  id: z.uuid(),
  title: z.string(),
  instructions: z.string().nullable(),
  required: z.boolean(),
  category: NamedRef.nullable(),
  status: DocumentRequestStatus,
  /** The client's reason (NOT_AVAILABLE) or the firm's (REJECTED: replacement needed). */
  statusNote: z.string().nullable(),
  sortOrder: z.number().int(),
  documents: z.array(
    z.object({ id: z.uuid(), fileName: z.string(), scanStatus: ScanStatus, createdAt: DateTime }),
  ),
  resolvedAt: DateTime.nullable(),
});
export type RequestItem = z.infer<typeof RequestItem>;

export const RequestPacketRow = z.object({
  id: z.uuid(),
  /** "DR-0024". */
  reference: z.string(),
  title: z.string(),
  client: NamedRef,
  service: ServiceRef,
  recipient: z.object({
    kind: z.enum(['CLIENT', 'MEMBER']),
    userId: z.uuid().nullable(),
    name: z.string(),
  }),
  status: DocumentRequestPacketStatus,
  view: RequestPacketView,
  items: z.object({
    total: z.number().int(),
    required: z.number().int(),
    /** Submitted, accepted or marked not available. */
    received: z.number().int(),
  }),
  dueOn: CalendarDate.nullable(),
  expiresAt: DateTime.nullable(),
  assignedTo: MemberRef.nullable(),
  sentAt: DateTime.nullable(),
  updatedAt: DateTime,
});
export type RequestPacketRow = z.infer<typeof RequestPacketRow>;

/** GET /business/document-request-packets/{id}: the staff view of one request. */
export const RequestPacketDetail = RequestPacketRow.extend({
  templateId: z.uuid().nullable(),
  messageSubject: z.string().nullable(),
  messageBody: z.string().nullable(),
  notifyEmail: z.boolean(),
  notifyPortal: z.boolean(),
  notifySms: z.boolean(),
  reminderDaysBefore: z.number().int().nullable(),
  allowMultipleFiles: z.boolean(),
  allowClientComments: z.boolean(),
  requestedBy: MemberRef.nullable(),
  submittedAt: DateTime.nullable(),
  completedAt: DateTime.nullable(),
  cancelledAt: DateTime.nullable(),
  checklist: z.array(RequestItem),
  activity: z.array(DocumentActivity),
});
export type RequestPacketDetail = z.infer<typeof RequestPacketDetail>;

export const RequestPacketTab = z.enum([
  'all',
  'draft',
  'outstanding',
  'partially_received',
  'ready_for_review',
  'due_soon',
  'overdue',
  'completed',
  'cancelled',
]);
export type RequestPacketTab = z.infer<typeof RequestPacketTab>;

/** GET /business/document-request-packets: the dashboard. Search: title, reference, client. */
export const RequestPacketsQuery = z.strictObject({
  tab: RequestPacketTab.optional().default('all'),
  search: SearchText.optional(),
  clientId: z.uuid().optional(),
  serviceId: z.uuid().optional(),
  templateId: z.uuid().optional(),
  assignedUserId: z.uuid().optional(),
  dueFrom: CalendarDate.optional(),
  dueTo: CalendarDate.optional(),
  sort: z.enum(['due', 'newest', 'client', 'title']).optional().default('due'),
  ...page,
});
export type RequestPacketsQuery = z.input<typeof RequestPacketsQuery>;

export const RequestPacketPage = z.object({ items: z.array(RequestPacketRow).max(100), ...Page });
export type RequestPacketPage = z.infer<typeof RequestPacketPage>;

/** GET /business/document-request-packets/summary: the five cards. */
export const RequestPacketSummary = z.object({
  total: z.number().int(),
  outstanding: z.number().int(),
  partiallyReceived: z.number().int(),
  completed: z.number().int(),
  overdue: z.number().int(),
});
export type RequestPacketSummary = z.infer<typeof RequestPacketSummary>;

const ItemInput = z.strictObject({
  title: text(200),
  instructions: clearable(text(1000, 'many')),
  required: z.boolean().optional().default(true),
  categoryId: z.uuid().nullable().optional(),
});
export const CreateRequestItemRequest = ItemInput;
export type CreateRequestItemRequest = z.input<typeof ItemInput>;
export const UpdateRequestItemRequest = ItemInput.partial().refine(
  (b) => Object.keys(b).length > 0,
  'Change something first',
);
export type UpdateRequestItemRequest = z.input<typeof UpdateRequestItemRequest>;

const PacketSetup = {
  title: text(200),
  dueOn: CalendarDate.nullable().optional(),
  /** After the due date. */
  expiresAt: DateTime.nullable().optional(),
  assignedUserId: z.uuid().nullable().optional(),
  messageSubject: clearable(text(200)),
  messageBody: clearable(text(1000, 'many')),
  notifyEmail: z.boolean().optional(),
  notifyPortal: z.boolean().optional(),
  notifySms: z.boolean().optional(),
  reminderDaysBefore: z.number().int().min(1).max(30).nullable().optional(),
  allowMultipleFiles: z.boolean().optional(),
  allowClientComments: z.boolean().optional(),
};

/**
 * POST /business/document-request-packets (Create Document Request): Save as Draft, or Send at
 * once (`send`). Sending needs a due date, a subject, a message and at least one item (400
 * REQUEST_INCOMPLETE). Retry-safe by `idempotencyKey`. `templateId` copies a template's items
 * (before `items`).
 */
export const CreateRequestPacketRequest = z.strictObject({
  idempotencyKey: z.uuid(),
  clientId: z.uuid(),
  /** The client's service; the API picks the open one when the client has exactly one. */
  serviceId: z.uuid().optional(),
  recipient: z
    .discriminatedUnion('kind', [
      z.strictObject({ kind: z.literal('CLIENT') }),
      z.strictObject({ kind: z.literal('MEMBER'), userId: z.uuid() }),
    ])
    .optional()
    .default({ kind: 'CLIENT' }),
  templateId: z.uuid().nullable().optional(),
  items: z.array(ItemInput).max(100).optional(),
  send: z.boolean().optional().default(false),
  ...PacketSetup,
});
export type CreateRequestPacketRequest = z.input<typeof CreateRequestPacketRequest>;

/**
 * PATCH /business/document-request-packets/{id}: a draft changes freely; after sending only the
 * due date, assignee, reminder and expiry change (409 REQUEST_SENT otherwise).
 */
export const UpdateRequestPacketRequest = z
  .strictObject(PacketSetup)
  .partial()
  .refine((b) => Object.keys(b).length > 0, 'Change something first');
export type UpdateRequestPacketRequest = z.input<typeof UpdateRequestPacketRequest>;

/** POST .../{id}/items/reorder: the draft's items in their new order. */
export const ReorderRequestItemsRequest = z.strictObject({
  ids: z.array(z.uuid()).min(1).max(100),
});
export type ReorderRequestItemsRequest = z.input<typeof ReorderRequestItemsRequest>;

/** POST .../{id}/cancel. */
export const CancelRequestPacketRequest = z.strictObject({ reason: Note500 });
export type CancelRequestPacketRequest = z.input<typeof CancelRequestPacketRequest>;

/** POST /business/document-request-packets/bulk: reminders, reassign (at most 100). */
export const BulkRequestPacketsRequest = z.discriminatedUnion('action', [
  z.strictObject({ action: z.literal('REMIND'), ids: z.array(z.uuid()).min(1).max(100) }),
  z.strictObject({
    action: z.literal('ASSIGN'),
    ids: z.array(z.uuid()).min(1).max(100),
    assignedUserId: z.uuid().nullable(),
  }),
]);
export type BulkRequestPacketsRequest = z.input<typeof BulkRequestPacketsRequest>;

export const BulkRequestPacketsResult = z.object({
  updated: z.number().int(),
  skipped: z.array(z.object({ id: z.uuid(), code: z.string() })),
});
export type BulkRequestPacketsResult = z.infer<typeof BulkRequestPacketsResult>;

// ---------- Request templates and "My saved lists" ----------

export const RequestTemplate = z.object({
  id: z.uuid(),
  name: z.string(),
  description: z.string().nullable(),
  /** FIRM: the firm's request type; MINE: the signed-in member's saved list. */
  owner: z.enum(['FIRM', 'MINE']),
  items: z.array(
    z.object({
      id: z.uuid(),
      title: z.string(),
      description: z.string().nullable(),
      required: z.boolean(),
      category: NamedRef.nullable(),
    }),
  ),
  updatedAt: DateTime,
});
export type RequestTemplate = z.infer<typeof RequestTemplate>;

/** GET /business/document-request-templates. */
export const RequestTemplatesQuery = z.strictObject({
  owner: z.enum(['FIRM', 'MINE', 'all']).optional().default('all'),
  search: SearchText.optional(),
});
export type RequestTemplatesQuery = z.input<typeof RequestTemplatesQuery>;
export const RequestTemplateList = z.object({ items: z.array(RequestTemplate).max(500) });
export type RequestTemplateList = z.infer<typeof RequestTemplateList>;

const TemplateItem = z.strictObject({
  title: text(200),
  description: clearable(text(1000, 'many')),
  required: z.boolean().optional().default(true),
  categoryId: z.uuid().nullable().optional(),
});

/** POST /business/document-request-templates: a firm type (MANAGE) or one's own list. */
export const CreateRequestTemplateRequest = z.strictObject({
  name: text(100),
  description: clearable(text(300, 'many')),
  owner: z.enum(['FIRM', 'MINE']).optional().default('MINE'),
  items: z.array(TemplateItem).min(1).max(100),
});
export type CreateRequestTemplateRequest = z.input<typeof CreateRequestTemplateRequest>;

/** PATCH /business/document-request-templates/{id}: `items` replaces the list. */
export const UpdateRequestTemplateRequest = z
  .strictObject({
    name: text(100),
    description: clearable(text(300, 'many')),
    items: z.array(TemplateItem).min(1).max(100),
  })
  .partial()
  .refine((b) => Object.keys(b).length > 0, 'Change something first');
export type UpdateRequestTemplateRequest = z.input<typeof UpdateRequestTemplateRequest>;

// ---------- Settings (Frame 6) ----------

/** GET /business/document-settings. One row per firm, made on the first read. */
export const DocumentSettings = z.object({
  requestReminderDaysBefore: z.number().int().nullable(),
  requestExpiryDays: z.number().int().nullable(),
  documentExpiryReminderDays: z.number().int().nullable(),
  shareExpiryDays: z.number().int().nullable(),
  /** At most 100 MB (the platform's limit, UPLOAD_LIMITS.maxBytes). */
  uploadMaxBytes: z.number().int(),
  /** A subset of the platform's types; all of them when none was chosen. */
  uploadTypes: z.array(UploadContentType),
  defaultReviewer: MemberRef.nullable(),
  updatedAt: DateTime.nullable(),
});
export type DocumentSettings = z.infer<typeof DocumentSettings>;

/** PATCH /business/document-settings (MANAGE). */
export const UpdateDocumentSettingsRequest = z
  .strictObject({
    requestReminderDaysBefore: z.number().int().min(1).max(30).nullable(),
    requestExpiryDays: z.number().int().min(1).max(365).nullable(),
    documentExpiryReminderDays: z.number().int().min(1).max(365).nullable(),
    shareExpiryDays: z.number().int().min(1).max(365).nullable(),
    uploadMaxBytes: z.number().int().min(1).max(UPLOAD_LIMITS.maxBytes),
    uploadTypes: z.array(UploadContentType).max(10),
    defaultReviewerUserId: z.uuid().nullable(),
  })
  .partial()
  .refine((b) => Object.keys(b).length > 0, 'Change something first');
export type UpdateDocumentSettingsRequest = z.input<typeof UpdateDocumentSettingsRequest>;

export const DocumentLibraryErrorCode = z.enum([
  /** 409: preview and download need a CLEAN file. */
  'FILE_NOT_CLEAN',
  /** 409: an INTERNAL document is never shared with the client. */
  'INTERNAL_DOCUMENT',
  /** 409: this person already has live access; change it instead. */
  'SHARE_EXISTS',
  /** 409: a FIRM folder holds only internal documents, and a folder needs a live parent. */
  'FOLDER_SCOPE',
  /** 409: a folder with documents or subfolders is not deleted. */
  'FOLDER_NOT_EMPTY',
  /** 400: at most 5 folder levels, and no folder inside itself. */
  'FOLDER_TOO_DEEP',
  /** 409: a folder or template name is taken. */
  'DUPLICATE_NAME',
  /** 409: the client has no open service to file it under; choose one. */
  'NO_ENGAGEMENT',
  /** 400: sending needs a due date, a subject, a message and at least one item. */
  'REQUEST_INCOMPLETE',
  /** 409: after sending, only the due date, assignee, reminder and expiry change. */
  'REQUEST_SENT',
  /** 409: not possible in this status (send a sent request, remind a completed one). */
  'INVALID_STATUS',
  /** 409: the assignee or reviewer is not an active member. */
  'NOT_A_MEMBER',
]);
export type DocumentLibraryErrorCode = z.infer<typeof DocumentLibraryErrorCode>;
