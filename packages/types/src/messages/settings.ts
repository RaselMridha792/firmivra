import { z } from 'zod';
import { clearable, text } from '../clients/text.js';

// Messages Settings (R60, MSG-F02; Octavia's section 19): the firm's one row of message_settings
// (R36). No row means the defaults below. Provider connections and credentials are Integrations';
// consent and suppression are the Communications consent records; a member's own signature is
// GET/PUT /business/me/message-signature. Nothing here sends anything.
//
// GET /business/message-settings: every firm member (the composer reads the channels).
// PATCH /business/message-settings: Owner and Admin. The fields sent change; `version` (the
// `updatedAt` read, or null before the first save) guards a concurrent save (409 STALE_VERSION);
// the screen always sends it, and leaving it out overwrites.

/** The file types the database allows (message_settings_attachments). */
export const MESSAGE_ATTACHMENT_TYPES = [
  'pdf',
  'doc',
  'docx',
  'xls',
  'xlsx',
  'jpg',
  'jpeg',
  'png',
  'csv',
  'txt',
] as const;
export const MessageAttachmentType = z.enum(MESSAGE_ATTACHMENT_TYPES);
export type MessageAttachmentType = z.infer<typeof MessageAttachmentType>;

/** "HH:MM", 24-hour, in the firm's time zone. */
const TimeOfDay = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:MM');

export const MESSAGE_SETTINGS_DEFAULTS = {
  portalEnabled: true,
  emailEnabled: true,
  smsEnabled: false,
  senderName: null,
  signature: null,
  notifyUnread: true,
  notifyAssignment: true,
  notifyReply: true,
  notifyFailure: true,
  notifyBulkComplete: true,
  defaultAssigneeUserId: null,
  readReceiptsEnabled: false,
  retentionMonths: null,
  attachmentMaxMb: 10,
  allowedAttachmentTypes: ['pdf', 'doc', 'docx', 'jpg', 'png'],
  quietHoursStart: null,
  quietHoursEnd: null,
  bulkConfirmThreshold: 100,
  bulkRequiresManager: true,
} as const;

export const MessageSettings = z.object({
  /** Channels the firm offers. A channel's provider is set up in Integrations. */
  portalEnabled: z.boolean(),
  emailEnabled: z.boolean(),
  smsEnabled: z.boolean(),
  /** Whether text messages can leave at all: the firm's registered SMS number (Integrations). */
  smsReady: z.boolean(),
  /** The name messages come from; empty: the firm's name. */
  senderName: z.string().nullable(),
  /** The firm's default signature; a member's own replaces it on their messages. */
  signature: z.string().nullable(),
  notifyUnread: z.boolean(),
  notifyAssignment: z.boolean(),
  notifyReply: z.boolean(),
  notifyFailure: z.boolean(),
  notifyBulkComplete: z.boolean(),
  /** Who a new conversation goes to when nobody is named. */
  defaultAssignee: z.object({ userId: z.uuid(), name: z.string() }).nullable(),
  /** Read receipts, only where the channel reports them (portal and email). */
  readReceiptsEnabled: z.boolean(),
  /** Archive threads after this many months of silence; null keeps them open. */
  retentionMonths: z.number().int().nullable(),
  attachmentMaxMb: z.number().int(),
  allowedAttachmentTypes: z.array(MessageAttachmentType),
  /** No texts or client alerts between these times, firm time zone (both or neither). */
  quietHoursStart: TimeOfDay.nullable(),
  quietHoursEnd: TimeOfDay.nullable(),
  /** A bulk send to more recipients than this asks for an explicit confirmation. */
  bulkConfirmThreshold: z.number().int(),
  /** Only Owner and Admin send bulk messages. */
  bulkRequiresManager: z.boolean(),
  /** The firm's time zone, for the quiet hours. */
  timezone: z.string(),
  /** Null before the first save (the defaults). Send it back as `version`. */
  updatedAt: z.iso.datetime({ offset: true }).nullable(),
  updatedBy: z.object({ userId: z.uuid(), name: z.string() }).nullable(),
});
export type MessageSettings = z.infer<typeof MessageSettings>;

export const UpdateMessageSettingsRequest = z
  .strictObject({
    version: z.iso.datetime({ offset: true }).nullable().optional(),
    portalEnabled: z.boolean().optional(),
    emailEnabled: z.boolean().optional(),
    smsEnabled: z.boolean().optional(),
    senderName: clearable(text(100)),
    signature: clearable(text(1000, 'many')),
    notifyUnread: z.boolean().optional(),
    notifyAssignment: z.boolean().optional(),
    notifyReply: z.boolean().optional(),
    notifyFailure: z.boolean().optional(),
    notifyBulkComplete: z.boolean().optional(),
    /** An active member of the firm (404 otherwise); null: nobody. */
    defaultAssigneeUserId: z.uuid().nullable().optional(),
    readReceiptsEnabled: z.boolean().optional(),
    retentionMonths: z.number().int().min(1).max(240).nullable().optional(),
    attachmentMaxMb: z.number().int().min(1).max(25).optional(),
    allowedAttachmentTypes: z
      .array(MessageAttachmentType)
      .min(1, 'Allow at least one file type')
      .max(MESSAGE_ATTACHMENT_TYPES.length)
      .refine((a) => new Set(a).size === a.length, 'List each file type once')
      .optional(),
    quietHoursStart: TimeOfDay.nullable().optional(),
    quietHoursEnd: TimeOfDay.nullable().optional(),
    bulkConfirmThreshold: z.number().int().min(1).max(100_000).optional(),
    bulkRequiresManager: z.boolean().optional(),
  })
  .refine((b) => Object.keys(b).some((k) => k !== 'version'), 'Change at least one setting')
  .refine(
    (b) =>
      (b.quietHoursStart === undefined) === (b.quietHoursEnd === undefined) &&
      (b.quietHoursStart === null) === (b.quietHoursEnd === null),
    { message: 'Set both quiet hours or neither', path: ['quietHoursEnd'] },
  )
  .refine((b) => !b.quietHoursStart || b.quietHoursStart !== b.quietHoursEnd, {
    message: 'Quiet hours need a different start and end',
    path: ['quietHoursEnd'],
  });
export type UpdateMessageSettingsRequest = z.input<typeof UpdateMessageSettingsRequest>;
