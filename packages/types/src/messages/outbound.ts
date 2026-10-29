import { z } from 'zod';
import { clearable, text } from '../clients/text.js';
import { UploadContentType } from '../documents/schemas.js';
import {
  MessageChannel,
  OutboundExclusion,
  OutboundMessageStatus,
  OutboundRecipientStatus,
} from '../db-enums.js';

// New Message (R60, MSG-F09, F10, F14; Octavia's Frame 2): a message the firm composes to chosen
// clients and leads, kept as a draft, scheduled or sent, on R36's outbound_messages (kind DIRECT).
// Firm routes: /api/v1/business/outbound-messages... Owner and Admin reach every client and lead;
// Staff only their own (others are 404, as is another firm's).
//
// How each channel reaches each person (Rasel, Oct 28):
// - A client's message always lives in their portal conversation. PORTAL: the usual notice. EMAIL:
//   an email that a new message is waiting, with the link to the portal's Messages, never the
//   text. SMS to clients is not set up.
// - A lead has no portal: EMAIL and SMS carry the text, as Send Email on the Leads page does.
// Who cannot receive is skipped with the reason, never silently; nothing is ever sent twice.

const DateTime = z.iso.datetime({ offset: true });

export const OutboundChannel = MessageChannel;
export type OutboundChannel = z.infer<typeof OutboundChannel>;
export const OutboundStatus = OutboundMessageStatus;
export type OutboundStatus = z.infer<typeof OutboundStatus>;

/** One person and whether the channel reaches them. */
export const OutboundRecipient = z.object({
  kind: z.enum(['CLIENT', 'LEAD']),
  id: z.uuid(),
  name: z.string(),
  /** False: `reason` says why; they are skipped, never sent to. */
  canReceive: z.boolean(),
  reason: OutboundExclusion.nullable(),
  /** QUEUED until it is sent (null before the message is saved). */
  status: OutboundRecipientStatus.nullable(),
  /**
   * The conversation it went to, for Open: a client's portal thread, or the lead's own thread
   * that keeps the lead's email or text (the Messages Leads tab).
   */
  threadId: z.uuid().nullable(),
});
export type OutboundRecipient = z.infer<typeof OutboundRecipient>;

/**
 * MSG-F13: what a message can be about, one of the client's own records. The thread it opens takes
 * it as its related record, so it shows under Appointments, Invoices or Documents in Messages.
 */
export const OUTBOUND_RELATED_TYPES = [
  'appointment',
  'invoice',
  'tax_return',
  'document_request',
  'task',
  'engagement',
] as const;
export const OutboundRelatedType = z.enum(OUTBOUND_RELATED_TYPES);
export type OutboundRelatedType = z.infer<typeof OutboundRelatedType>;
export const OUTBOUND_RELATED_LABELS: Record<OutboundRelatedType, string> = {
  appointment: 'Appointment',
  invoice: 'Invoice or payment',
  tax_return: 'Tax return',
  document_request: 'Document request',
  task: 'Task',
  engagement: 'Service',
};
/** A record of the client's, as the Related To list shows it. */
export const OutboundRelated = z.object({
  type: OutboundRelatedType,
  id: z.uuid(),
  /** Its name in words, e.g. "Invoice INV-1001" or "2025 Tax Return". */
  label: z.string(),
});
export type OutboundRelated = z.infer<typeof OutboundRelated>;

/**
 * GET /business/outbound-messages/related-options?clientId=: the client's records a message can be
 * about, newest first, at most 20 of each type (404 for a client out of reach).
 */
export const OutboundRelatedOptionsQuery = z.strictObject({ clientId: z.uuid() });
export type OutboundRelatedOptionsQuery = z.input<typeof OutboundRelatedOptionsQuery>;
export const OutboundRelatedOptions = z.object({ items: z.array(OutboundRelated) });
export type OutboundRelatedOptions = z.infer<typeof OutboundRelatedOptions>;

/**
 * GET /business/outbound-messages/assignees (MSG-F16): the firm's active members who can own the
 * conversations. One with the Staff role owns only conversations with their own clients.
 */
export const OutboundAssignee = z.object({
  userId: z.uuid(),
  name: z.string(),
  role: z.enum(['OWNER', 'ADMIN', 'STAFF']),
});
export type OutboundAssignee = z.infer<typeof OutboundAssignee>;
export const OutboundAssigneeList = z.object({ items: z.array(OutboundAssignee) });
export type OutboundAssigneeList = z.infer<typeof OutboundAssigneeList>;

/** The most files one New Message carries (MSG-F12). */
export const OUTBOUND_FILES_MAX = 10;
/** The most a file may be: the database's limit; Messages Settings may set less. */
export const OUTBOUND_FILE_MAX_BYTES = 25 * 1024 * 1024;

/**
 * A file sent with New Message (MSG-F12). Files reach clients only, through their portal (an email
 * to a client links the portal; it never carries a file); a lead or a text cannot take them.
 * CHECKING while the virus scan runs: the message sends only once every file is READY.
 */
export const OutboundFile = z.object({
  id: z.uuid(),
  fileName: z.string(),
  contentType: z.string(),
  sizeBytes: z.number().int().min(1),
  status: z.enum(['CHECKING', 'READY', 'BLOCKED']),
  createdAt: DateTime,
});
export type OutboundFile = z.infer<typeof OutboundFile>;

export const OutboundMessage = z.object({
  id: z.uuid(),
  status: OutboundStatus,
  channel: OutboundChannel,
  subject: z.string().nullable(),
  body: z.string(),
  /** The template it started from (MSG-F11); the text stays editable. */
  templateId: z.uuid().nullable(),
  /** MSG-F13: the client's record it is about. */
  related: OutboundRelated.nullable(),
  /** MSG-F16: who owns the conversations it opens. */
  assignedTo: z.object({ userId: z.uuid(), name: z.string() }).nullable(),
  /** Only while SCHEDULED. */
  scheduledFor: DateTime.nullable(),
  /** The firm's time zone: a schedule is picked and shown in it. */
  timezone: z.string(),
  recipients: z.array(OutboundRecipient),
  /** Its files (MSG-F12), oldest first. */
  files: z.array(OutboundFile),
  counts: z.object({
    total: z.number().int(),
    canReceive: z.number().int(),
    cannotReceive: z.number().int(),
  }),
  createdBy: z.object({ userId: z.uuid(), name: z.string() }),
  /** A draft or a scheduled message can still change or be canceled. */
  editable: z.boolean(),
  completedAt: DateTime.nullable(),
  canceledAt: DateTime.nullable(),
  createdAt: DateTime,
  /** Send it back as `version`: a change made since is 409 STALE_VERSION. */
  updatedAt: DateTime,
});
export type OutboundMessage = z.infer<typeof OutboundMessage>;

const People = {
  clientIds: z.array(z.uuid()).max(100).optional().default([]),
  leadIds: z.array(z.uuid()).max(100).optional().default([]),
};
const Body = text(10_000, 'many', 'Enter a message');

/**
 * POST /business/outbound-messages/check: who the channel reaches, before anything is saved (the
 * recipient list and the channel cards). Nothing is written.
 */
export const CheckOutboundRequest = z.strictObject({ channel: OutboundChannel, ...People });
export type CheckOutboundRequest = z.input<typeof CheckOutboundRequest>;
export const OutboundCheck = z.object({
  recipients: z.array(OutboundRecipient),
  /** Each channel and why it is unavailable for the firm as a whole (null: available). */
  channels: z.array(
    z.object({
      channel: OutboundChannel,
      unavailable: z.enum(['TURNED_OFF', 'NOT_SET_UP']).nullable(),
    }),
  ),
});
export type OutboundCheck = z.infer<typeof OutboundCheck>;

/**
 * POST /business/outbound-messages (Save Draft): a new draft. PUT .../{id} replaces a draft's or
 * a scheduled message's content and recipients (`version` guards it); when its recipients or
 * channel change the answer is a new draft (a new id; the old one is canceled, never deleted).
 */
const SaveShape = {
  channel: OutboundChannel,
  subject: clearable(text(200)),
  body: Body,
  /** An active template of the firm (404 otherwise), or none. */
  templateId: z.uuid().nullable().optional(),
  /**
   * MSG-F13: one of the client's records (404 otherwise); only with exactly one client (400
   * RELATED_NEEDS_ONE_CLIENT). Leads in the same message take no record.
   */
  related: z.strictObject({ type: OutboundRelatedType, id: z.uuid() }).nullable().optional(),
  /**
   * MSG-F16: an active member who owns the conversations it opens (404 otherwise); a member with
   * the Staff role only for their own clients (400 ASSIGNEE_CANNOT_REACH).
   */
  assignedUserId: z.uuid().nullable().optional(),
  ...People,
};
const saveRules = <
  T extends z.ZodType<{ channel: string; body: string; clientIds: string[]; leadIds: string[] }>,
>(
  schema: T,
) =>
  schema
    .refine((b) => b.clientIds.length + b.leadIds.length > 0, {
      message: 'Choose at least one recipient',
      path: ['clientIds'],
    })
    .refine((b) => b.channel !== 'SMS' || b.body.length <= 1600, {
      message: 'A text message is at most 1,600 characters',
      path: ['body'],
    });
export const SaveOutboundRequest = saveRules(z.strictObject(SaveShape));
export type SaveOutboundRequest = z.input<typeof SaveOutboundRequest>;
export const UpdateOutboundRequest = saveRules(z.strictObject({ ...SaveShape, version: DateTime }));
export type UpdateOutboundRequest = z.input<typeof UpdateOutboundRequest>;

/**
 * POST .../{id}/send: now. Sending a message already sent answers it as it is (idempotent). A
 * merge field that cannot be filled for someone who receives it is 409 UNRESOLVED_FIELDS unless
 * `confirmUnresolved` (the Review step's "send them as they are").
 */
export const SendOutboundRequest = z.strictObject({
  version: DateTime,
  confirmUnresolved: z.boolean().optional(),
});
export type SendOutboundRequest = z.input<typeof SendOutboundRequest>;
/** POST .../{id}/schedule: at a future time (at least a minute ahead). */
export const ScheduleOutboundRequest = z.strictObject({
  version: DateTime,
  scheduledFor: DateTime,
  confirmUnresolved: z.boolean().optional(),
});
export type ScheduleOutboundRequest = z.input<typeof ScheduleOutboundRequest>;
/** POST .../{id}/cancel: a draft or a scheduled message, before it is sent. */
export const CancelOutboundRequest = z.strictObject({ version: DateTime });
export type CancelOutboundRequest = z.input<typeof CancelOutboundRequest>;

/** GET /business/outbound-messages: drafts and scheduled messages (Staff: their own). */
export const ListOutboundQuery = z.strictObject({
  status: z.enum(['DRAFT', 'SCHEDULED']).optional(),
});
export type ListOutboundQuery = z.input<typeof ListOutboundQuery>;
export const OutboundMessageList = z.object({ items: z.array(OutboundMessage) });
export type OutboundMessageList = z.infer<typeof OutboundMessageList>;

/**
 * GET .../{id}/review (MSG-F15): what each person would get, merge fields filled from their own
 * record, the fields that cannot be filled, the timing and the checks. Nothing is sent.
 */
export const OutboundReview = z.object({
  channel: OutboundChannel,
  timing: z.object({
    mode: z.enum(['NOW', 'SCHEDULED']),
    scheduledFor: DateTime.nullable(),
    timezone: z.string(),
  }),
  recipients: z.array(
    OutboundRecipient.pick({
      kind: true,
      id: true,
      name: true,
      canReceive: true,
      reason: true,
    }).extend({
      subject: z.string().nullable(),
      body: z.string(),
      unresolved: z.array(z.string()),
    }),
  ),
  /** Fields left unfilled for someone who receives it: Send needs `confirmUnresolved`. */
  unresolved: z.array(z.string()),
  checks: z.array(
    z.object({
      code: z.enum([
        'NO_RECIPIENTS',
        'SUBJECT_REQUIRED',
        'UNRESOLVED_FIELDS',
        'SOME_SKIPPED',
        'FILES_NOT_READY',
        'FILES_NEED_PORTAL',
        'READY',
      ]),
      severity: z.enum(['BLOCK', 'WARN', 'OK']),
      message: z.string(),
    }),
  ),
});
export type OutboundReview = z.infer<typeof OutboundReview>;

/**
 * POST .../{id}/files/uploads: where to send a file for a draft or a scheduled message (step 1 of
 * Documents' three; PUT or multipart, then POST .../files/uploads/confirm with the token). The type
 * must be one Messages Settings allow and the size within their limit (400 ATTACHMENT_TYPE,
 * ATTACHMENT_TOO_LARGE); at most 10 files (400 TOO_MANY_FILES); 409 NOT_EDITABLE once sent.
 */
export const StartOutboundFileRequest = z.strictObject({
  fileName: text(200, 'one', 'Enter a file name'),
  contentType: UploadContentType,
  sizeBytes: z.number().int().min(1).max(OUTBOUND_FILE_MAX_BYTES, 'A file is at most 25 MB'),
  /** SHA-256 of the file, hex. */
  sha256: z.string().regex(/^[0-9a-f]{64}$/, 'Use the lower-case hex SHA-256'),
});
export type StartOutboundFileRequest = z.input<typeof StartOutboundFileRequest>;
