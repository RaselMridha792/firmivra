import { z } from 'zod';
import { clearable, text } from '../clients/text.js';
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

export const OutboundMessage = z.object({
  id: z.uuid(),
  status: OutboundStatus,
  channel: OutboundChannel,
  subject: z.string().nullable(),
  body: z.string(),
  /** The template it started from (MSG-F11); the text stays editable. */
  templateId: z.uuid().nullable(),
  /** Only while SCHEDULED. */
  scheduledFor: DateTime.nullable(),
  /** The firm's time zone: a schedule is picked and shown in it. */
  timezone: z.string(),
  recipients: z.array(OutboundRecipient),
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
        'READY',
      ]),
      severity: z.enum(['BLOCK', 'WARN', 'OK']),
      message: z.string(),
    }),
  ),
});
export type OutboundReview = z.infer<typeof OutboundReview>;
