import { z } from 'zod';
import { SUPPORT_ATTACHMENT_LIMITS } from '../admin-support/schemas.js';
import { type ApiRequest, parseInput } from '../client.js';
import { text } from '../clients/text.js';
import { ScanStatus, SupportTicketStatus } from '../db-enums.js';
import { megabytes, UploadContentType, UploadPutTicket } from '../documents/schemas.js';

/**
 * Settings > Requests from Firmivra (SA-FRM-F06, Y09): Firmivra's requests for information about
 * the firm's account, each a Support ticket the Super Admin opened from the firm's page (Actions >
 * Request Information). The Owner reads the request and Firmivra's replies sent to the firm, and
 * answers with text and files; an answer moves the ticket back to Open in Firmivra's queue.
 * Owner only: every route is 403 for other members, and 404 for a ticket that is not one of the
 * firm's own requests. Firmivra's internal notes and replies kept back are never shown.
 */

const Id = z.uuid();
const DateTime = z.iso.datetime({ offset: true });

/** Every request's subject starts so (the Super Admin queue shows it the same way). */
export const FIRMIVRA_REQUEST_PREFIX = 'Information request: ';

/** The firm's words for where a request stands. */
export const FIRMIVRA_REQUEST_STATUS_LABELS: Readonly<Record<SupportTicketStatus, string>> = {
  WAITING_ON_CUSTOMER: 'Waiting on You',
  OPEN: 'Answered',
  IN_PROGRESS: 'In Review',
  RESOLVED: 'Resolved',
  CLOSED: 'Closed',
};

/** One request in the list, newest first. */
export const FirmivraRequestItem = z.object({
  id: Id,
  /** The ticket's number in Firmivra's queue ("#1042"). */
  number: z.number().int().positive(),
  /** Without the prefix. */
  subject: z.string(),
  status: SupportTicketStatus,
  requestedAt: DateTime,
  /** The newest message either way, or the request itself. */
  lastActivityAt: DateTime,
  /** Firmivra is waiting for the firm's answer. */
  awaitingAnswer: z.boolean(),
});
export type FirmivraRequestItem = z.infer<typeof FirmivraRequestItem>;

export const FirmivraRequestList = z.object({ items: z.array(FirmivraRequestItem) });
export type FirmivraRequestList = z.infer<typeof FirmivraRequestList>;

/** A file on a message. Only a CLEAN file can be opened. */
export const FirmivraRequestFile = z.object({
  id: Id,
  fileName: z.string(),
  contentType: z.string(),
  sizeBytes: z.number().int().min(0),
  scanStatus: ScanStatus,
});
export type FirmivraRequestFile = z.infer<typeof FirmivraRequestFile>;

/** A message in the thread: Firmivra's sent reply, or the firm's answer. */
export const FirmivraRequestMessage = z.object({
  id: Id,
  from: z.enum(['FIRMIVRA', 'FIRM']),
  /** The firm member's name; "Firmivra" for Firmivra's team. */
  authorName: z.string(),
  body: z.string(),
  at: DateTime,
  files: z.array(FirmivraRequestFile),
});
export type FirmivraRequestMessage = z.infer<typeof FirmivraRequestMessage>;

/** GET /business/firmivra-requests/{id}: the request and its thread, oldest first. */
export const FirmivraRequestThread = FirmivraRequestItem.extend({
  /** What Firmivra asked (the ticket's description). */
  request: z.string(),
  messages: z.array(FirmivraRequestMessage),
  /** False once Firmivra resolved or closed it: 409 REQUEST_CLOSED on a reply. */
  canReply: z.boolean(),
});
export type FirmivraRequestThread = z.infer<typeof FirmivraRequestThread>;

export const FirmivraRequestId = Id;

/**
 * POST /business/firmivra-requests/{id}/uploads: where to PUT one file for an answer (one PUT, at
 * most 10 MB). Give its `uploadToken` to the reply within 15 minutes; the API checks the stored
 * bytes then, and refuses a file that is not what was declared (409, deleted).
 */
export const CreateFirmivraRequestUploadRequest = z.strictObject({
  fileName: text(200),
  contentType: UploadContentType,
  sizeBytes: z
    .number()
    .int()
    .positive()
    .max(
      SUPPORT_ATTACHMENT_LIMITS.maxBytes,
      `Max size: ${megabytes(SUPPORT_ATTACHMENT_LIMITS.maxBytes)}`,
    ),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
});
export type CreateFirmivraRequestUploadRequest = z.input<typeof CreateFirmivraRequestUploadRequest>;

/**
 * POST /business/firmivra-requests/{id}/replies: the firm's answer, with up to 10 files. The
 * same `requestId` again answers the same message (a double click sends one). 409
 * REQUEST_CLOSED when Firmivra resolved or closed the request.
 */
export const ReplyFirmivraRequestRequest = z.strictObject({
  requestId: Id,
  body: text(5000, 'many', 'Write your answer'),
  uploadTokens: z
    .array(z.string().min(1).max(8192))
    .max(SUPPORT_ATTACHMENT_LIMITS.maxFiles, 'Attach at most 10 files at a time')
    .default([]),
});
export type ReplyFirmivraRequestRequest = z.input<typeof ReplyFirmivraRequestRequest>;

/** GET /business/firmivra-requests/{id}/files/{fileId}: a 5-minute link to a CLEAN file. */
export const FirmivraRequestFileLink = z.object({ url: z.string(), expiresAt: DateTime });
export type FirmivraRequestFileLink = z.infer<typeof FirmivraRequestFileLink>;

const BASE = '/business/firmivra-requests';
const one = (id: string) => `${BASE}/${parseInput(FirmivraRequestId, id)}`;

/** `api.firmivraRequests` (apps/web/src/lib/api.ts): the Owner only. */
export function createFirmivraRequestsClient(request: ApiRequest) {
  return {
    list: async (): Promise<FirmivraRequestList> => request(FirmivraRequestList, BASE),
    get: async (id: string): Promise<FirmivraRequestThread> =>
      request(FirmivraRequestThread, one(id)),
    createUpload: async (
      id: string,
      body: CreateFirmivraRequestUploadRequest,
    ): Promise<UploadPutTicket> =>
      request(UploadPutTicket, `${one(id)}/uploads`, {
        method: 'POST',
        body: parseInput(CreateFirmivraRequestUploadRequest, body),
      }),
    reply: async (id: string, body: ReplyFirmivraRequestRequest): Promise<FirmivraRequestThread> =>
      request(FirmivraRequestThread, `${one(id)}/replies`, {
        method: 'POST',
        body: parseInput(ReplyFirmivraRequestRequest, body),
      }),
    fileLink: async (id: string, fileId: string): Promise<FirmivraRequestFileLink> =>
      request(FirmivraRequestFileLink, `${one(id)}/files/${parseInput(FirmivraRequestId, fileId)}`),
  };
}
export type FirmivraRequestsClient = ReturnType<typeof createFirmivraRequestsClient>;
