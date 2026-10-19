import { z } from 'zod';
import { CalendarDate } from '../clients/schemas.js';
import { DocumentRequestPacketStatus, DocumentRequestStatus } from '../db-enums.js';
import { MyDocument } from './schemas.js';

// The client's side of request packets (R55): the portal's "Document Request & Upload" page
// (docs/mockups/firm-workspace/documents/source/firmivra-frame-7-client-document-request-upload.jpg)
// and the list of requests it is opened from. A packet is what the firm sent (title, due date,
// message) with a checklist of items; each item is a document request (`document_requests`, its
// `packet_id`), so the item's upload is the portal's ordinary upload with its `requestId`
// (`api.myDocuments(slug).createUpload`). Submit for Review moves the packet to SUBMITTED.
// Routes: /api/v1/portal/{firmSlug}/me/request-packets. The client sees only their own packets
// that were sent: never a DRAFT, a CANCELLED one or one for a member of the firm. A portal login
// that is not the household's sees the open ones (OPEN and SUBMITTED) only, as with requests.
// Another client's packet is 404.

const DateTime = z.iso.datetime({ offset: true });
const Ref = z.object({ id: z.uuid(), name: z.string() });
const ServiceRef = z.object({ id: z.uuid(), title: z.string() });

export const MyRequestPacketId = z.uuid();

/**
 * The packet's state for the client, computed (stored statuses are OPEN, SUBMITTED, COMPLETED):
 * NOT_STARTED (open, nothing answered), IN_PROGRESS (some items answered), READY (every required
 * item answered, not submitted yet), SUBMITTED, COMPLETED. An open packet past its `expiresAt`
 * is EXPIRED: it takes no more uploads and cannot be submitted.
 */
export const MyRequestPacketView = z.enum([
  'NOT_STARTED',
  'IN_PROGRESS',
  'READY',
  'SUBMITTED',
  'COMPLETED',
  'EXPIRED',
]);
export type MyRequestPacketView = z.infer<typeof MyRequestPacketView>;

/** "2 of 4 required items uploaded": an item counts once it is SUBMITTED, ACCEPTED or NOT_AVAILABLE. */
export const MyRequestPacketProgress = z.object({
  requiredTotal: z.number().int(),
  requiredAnswered: z.number().int(),
  /** Every item, optional ones too. */
  itemsTotal: z.number().int(),
  itemsAnswered: z.number().int(),
});
export type MyRequestPacketProgress = z.infer<typeof MyRequestPacketProgress>;

/** One row of the client's requests. */
export const MyRequestPacketRow = z.object({
  id: z.uuid(),
  /** "DR-0024" (the firm sees the same). */
  reference: z.string(),
  title: z.string(),
  service: ServiceRef,
  status: DocumentRequestPacketStatus.exclude(['DRAFT', 'CANCELLED']),
  view: MyRequestPacketView,
  dueOn: CalendarDate.nullable(),
  /** Open, and the due date has passed. */
  overdue: z.boolean(),
  progress: MyRequestPacketProgress,
  sentAt: DateTime,
  submittedAt: DateTime.nullable(),
});
export type MyRequestPacketRow = z.infer<typeof MyRequestPacketRow>;

/** GET /portal/{firmSlug}/me/request-packets: open ones first (soonest due), then the newest. */
export const MyRequestPacketList = z.object({ items: z.array(MyRequestPacketRow).max(200) });
export type MyRequestPacketList = z.infer<typeof MyRequestPacketList>;

/** One checklist item ("W-2 forms", Required) with the files uploaded for it, newest first. */
export const MyRequestPacketItem = z.object({
  id: z.uuid(),
  title: z.string(),
  /** Shown under the title ("January–December 2024"). */
  instructions: z.string().nullable(),
  required: z.boolean(),
  category: Ref.nullable(),
  /**
   * REQUESTED: awaiting upload ("Not added" when optional). SUBMITTED: uploaded. ACCEPTED: the
   * firm accepted it. REJECTED: the firm asked again (`statusNote`: why). NOT_AVAILABLE: the
   * client said they don't have it (`statusNote`: their reason). CANCELLED items are left out.
   */
  status: DocumentRequestStatus.exclude(['CANCELLED']),
  statusNote: z.string().nullable(),
  /** View and download with `api.myDocuments(slug).download(id)` (a clean scan only). */
  files: z.array(MyDocument).max(50),
  /** Whether an upload is taken now (the packet is open and not expired, the item is not closed). */
  canUpload: z.boolean(),
});
export type MyRequestPacketItem = z.infer<typeof MyRequestPacketItem>;

/**
 * The Activity tab, oldest first, from the records' own times: when it was sent, each file
 * uploaded, each item's latest answer or review, submitted, completed. Never a file's contents.
 */
export const MyRequestPacketEvent = z.object({
  at: DateTime,
  kind: z.enum([
    'SENT',
    'UPLOADED',
    'NOT_AVAILABLE',
    'ACCEPTED',
    'REJECTED',
    'SUBMITTED',
    'COMPLETED',
  ]),
  /** The item it concerns, if any. */
  itemTitle: z.string().nullable(),
  /** Who: the client ("You") or the firm. */
  by: z.enum(['YOU', 'FIRM']),
});
export type MyRequestPacketEvent = z.infer<typeof MyRequestPacketEvent>;

/** GET /portal/{firmSlug}/me/request-packets/{id}: Document Request & Upload. */
export const MyRequestPacket = MyRequestPacketRow.extend({
  /** The firm's message as sent (variables resolved); null when it sent none. */
  message: z.string().nullable(),
  /** "Requested by K. Allen"; null when the person is no longer named (left the firm). */
  requestedBy: z.string().nullable(),
  /** The service's tax year, if it has one. */
  taxYear: z.number().int().nullable(),
  expiresAt: DateTime.nullable(),
  /**
   * More than one file per item: the screen keeps every file. Otherwise it shows Replace: a new
   * upload for the item, and the newest file is the answer (the older one stays on record).
   */
  allowMultipleFiles: z.boolean(),
  items: z.array(MyRequestPacketItem),
  /**
   * Whether Submit for Review is open now: OPEN, not expired, every required item answered, and
   * a household login (PRIMARY or SPOUSE; an AUTHORIZED login gets 403, as for "I don't have this").
   */
  canSubmit: z.boolean(),
  activity: z.array(MyRequestPacketEvent).max(200),
});
export type MyRequestPacket = z.infer<typeof MyRequestPacket>;
