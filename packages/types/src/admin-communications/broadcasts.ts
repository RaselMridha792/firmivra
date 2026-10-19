import { z } from 'zod';
import { MemberRef } from '../clients/schemas.js';
import { SearchText } from '../clients/text.js';
import {
  BusinessStatus,
  CommBroadcastStatus,
  CommDeliveryStatus,
  CommMediaKind,
  ScanStatus,
} from '../db-enums.js';
import { ADMIN_COMM_BODY_MAX, ADMIN_COMM_SMS_MAX } from './schemas.js';

// Super Admin Communications, broadcasts (R0 stage B6): one message to an audience (a segment) on
// email, SMS and in-app; the segments; the file library for images and attachments. A firm's
// clients are never in an audience. Routes: /api/v1/admin/communications/... (Super Admin only).
// Lifecycle (the database keeps it): DRAFT <-> SCHEDULED -> SENDING -> SENT, PARTIALLY_SENT or
// FAILED; SCHEDULED -> CANCELLED; FAILED -> SENDING (retry). Only drafts are deleted; a finished or
// cancelled broadcast is archived once. Sending counts the segment and needs at least one channel
// and one recipient.

const DateTime = z.iso.datetime({ offset: true });
const count = z.number().int().min(0);
const paging = {
  page: z.coerce.number().int().min(1).max(10_000).optional().default(1),
  pageSize: z.coerce.number().int().min(1).max(100).optional().default(25),
};
const page = <T extends z.ZodType>(item: T) =>
  z.object({
    items: z.array(item).max(100),
    total: count,
    page: count.min(1),
    pageSize: count.min(1),
  });

export const AdminCommBroadcastId = z.uuid();
export const AdminCommSegmentId = z.uuid();
export const AdminCommMediaId = z.uuid();

/** Where a broadcast goes. In-app reaches team members and firm owners with an account. */
export const AdminCommBroadcastChannel = z.enum(['EMAIL', 'SMS', 'IN_APP']);
export type AdminCommBroadcastChannel = z.infer<typeof AdminCommBroadcastChannel>;

// ---------- Segments ----------

/**
 * Who a segment reaches: the API's rules, stored as the segment's definition. Each contact type
 * adds its people: FIRM the active owners of firms (optionally only firms in `firmStatuses`, or
 * only `firmIds`), LEAD sales contacts (optionally only `salesContactIds`), TEAM the Super Admin
 * team. A person reached twice is counted once per channel.
 */
export const AdminCommSegmentDefinition = z
  .strictObject({
    contactTypes: z
      .array(z.enum(['FIRM', 'LEAD', 'TEAM']))
      .min(1, 'Choose who this audience reaches')
      .max(3),
    firmStatuses: z.array(BusinessStatus).max(4).optional(),
    firmIds: z.array(z.uuid()).max(500).optional(),
    salesContactIds: z.array(z.uuid()).max(500).optional(),
  })
  .refine((d) => d.contactTypes.includes('FIRM') || (!d.firmStatuses && !d.firmIds), {
    message: 'Firm filters need firms in the audience',
    path: ['firmStatuses'],
  })
  .refine((d) => d.contactTypes.includes('LEAD') || !d.salesContactIds, {
    message: 'Lead filters need leads in the audience',
    path: ['salesContactIds'],
  });
export type AdminCommSegmentDefinition = z.input<typeof AdminCommSegmentDefinition>;

export const AdminCommSegment = z.object({
  id: AdminCommSegmentId,
  name: z.string(),
  description: z.string().nullable(),
  definition: AdminCommSegmentDefinition,
  /** The last count and when it was taken; null until counted. */
  lastCount: count.nullable(),
  lastCountedAt: DateTime.nullable(),
  archivedAt: DateTime.nullable(),
  createdBy: MemberRef.nullable(),
  createdAt: DateTime,
  updatedAt: DateTime,
});
export type AdminCommSegment = z.infer<typeof AdminCommSegment>;

/** GET /admin/communications/segments (archived ones with `archived: true`). */
export const ListAdminCommSegmentsQuery = z.strictObject({
  search: SearchText.optional(),
  archived: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => v === 'true'),
  ...paging,
});
export type ListAdminCommSegmentsQuery = z.input<typeof ListAdminCommSegmentsQuery>;
export const ListAdminCommSegmentsResponse = page(AdminCommSegment);
export type ListAdminCommSegmentsResponse = z.infer<typeof ListAdminCommSegmentsResponse>;

export const CreateAdminCommSegmentRequest = z.strictObject({
  name: z.string().trim().min(1, 'Name the audience').max(120),
  description: z.string().trim().max(1000).optional(),
  definition: AdminCommSegmentDefinition,
});
export type CreateAdminCommSegmentRequest = z.input<typeof CreateAdminCommSegmentRequest>;
/** Archived segments are not edited; archive with `archived: true` (never deleted). */
export const UpdateAdminCommSegmentRequest = z
  .strictObject({
    name: z.string().trim().min(1, 'Name the audience').max(120).optional(),
    description: z.string().trim().max(1000).nullable().optional(),
    definition: AdminCommSegmentDefinition.optional(),
    archived: z.literal(true).optional(),
  })
  .refine((b) => Object.keys(b).length > 0, 'Change at least one thing');
export type UpdateAdminCommSegmentRequest = z.input<typeof UpdateAdminCommSegmentRequest>;

/** POST /admin/communications/segments/:id/count: people reached per channel now. */
export const AdminCommSegmentCount = z.object({
  /** Distinct people. */
  total: count,
  /** With an address for each channel. */
  byChannel: z.object({ EMAIL: count, SMS: count, IN_APP: count }),
  countedAt: DateTime,
});
export type AdminCommSegmentCount = z.infer<typeof AdminCommSegmentCount>;

// ---------- Files ----------

export const AdminCommMedia = z.object({
  id: AdminCommMediaId,
  kind: CommMediaKind,
  fileName: z.string(),
  contentType: z.string(),
  sizeBytes: z.number().int().min(1),
  /** Only CLEAN files are used in a message. */
  scanStatus: ScanStatus,
  uploadedBy: MemberRef.nullable(),
  createdAt: DateTime,
});
export type AdminCommMedia = z.infer<typeof AdminCommMedia>;

export const ADMIN_COMM_MEDIA_MAX_BYTES = 10 * 1024 * 1024;
export const ADMIN_COMM_INLINE_IMAGE_TYPES = [
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
] as const;

/**
 * POST /admin/communications/media: an upload ticket. The browser PUTs the file to `uploadUrl`
 * (S3, `platform/communications/<id>/`) within its expiry; the scanner then marks it CLEAN.
 */
export const CreateAdminCommMediaRequest = z
  .strictObject({
    kind: CommMediaKind,
    fileName: z
      .string()
      .trim()
      .min(1)
      .max(255)
      .refine((n) => !/[/\\]/.test(n), 'A file name has no slashes'),
    contentType: z.string().regex(/^[a-z]+\/[a-z0-9.+-]+$/, 'Unknown file type'),
    sizeBytes: z
      .number()
      .int()
      .min(1)
      .max(ADMIN_COMM_MEDIA_MAX_BYTES, 'Use a file of at most 10 MB'),
    sha256: z.string().regex(/^[0-9a-f]{64}$/),
  })
  .refine(
    (b) =>
      b.kind !== 'INLINE_IMAGE' ||
      (ADMIN_COMM_INLINE_IMAGE_TYPES as readonly string[]).includes(b.contentType),
    { message: 'An image is PNG, JPEG, GIF or WebP', path: ['contentType'] },
  );
export type CreateAdminCommMediaRequest = z.input<typeof CreateAdminCommMediaRequest>;
export const AdminCommMediaTicket = z.object({
  media: AdminCommMedia,
  uploadUrl: z.string(),
  expiresAt: DateTime,
});
export type AdminCommMediaTicket = z.infer<typeof AdminCommMediaTicket>;

/** GET /admin/communications/media: the library, newest first. */
export const ListAdminCommMediaQuery = z.strictObject({
  kind: CommMediaKind.optional(),
  ...paging,
});
export type ListAdminCommMediaQuery = z.input<typeof ListAdminCommMediaQuery>;
export const ListAdminCommMediaResponse = page(AdminCommMedia);
export type ListAdminCommMediaResponse = z.infer<typeof ListAdminCommMediaResponse>;

// ---------- Broadcasts ----------

export const AdminCommBroadcastChannelContent = z.object({
  id: z.uuid(),
  channel: AdminCommBroadcastChannel,
  /** Email only. */
  subject: z.string().nullable(),
  body: z.string(),
  /** DRAFT, then SENDING and SENT, PARTIALLY_SENT or FAILED. */
  status: CommBroadcastStatus,
  sentCount: count,
  failedCount: count,
  /** Library files on this channel (email). */
  media: z.array(AdminCommMedia),
});
export type AdminCommBroadcastChannelContent = z.infer<typeof AdminCommBroadcastChannelContent>;

export const AdminCommBroadcast = z.object({
  id: AdminCommBroadcastId,
  name: z.string(),
  status: CommBroadcastStatus,
  segment: z.object({ id: AdminCommSegmentId, name: z.string() }).nullable(),
  channels: z.array(AdminCommBroadcastChannelContent),
  scheduledAt: DateTime.nullable(),
  scheduledTimeZone: z.string().nullable(),
  /** Counted when the send starts. */
  recipientCount: count.nullable(),
  duplicatedFromId: AdminCommBroadcastId.nullable(),
  sendStartedAt: DateTime.nullable(),
  finishedAt: DateTime.nullable(),
  errorMessage: z.string().nullable(),
  archivedAt: DateTime.nullable(),
  createdBy: MemberRef.nullable(),
  updatedBy: MemberRef.nullable(),
  createdAt: DateTime,
  updatedAt: DateTime,
});
export type AdminCommBroadcast = z.infer<typeof AdminCommBroadcast>;

/** GET /admin/communications/broadcasts: newest first; archived ones with `archived: true`. */
export const ListAdminCommBroadcastsQuery = z.strictObject({
  status: CommBroadcastStatus.optional(),
  channel: AdminCommBroadcastChannel.optional(),
  search: SearchText.optional(),
  archived: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => v === 'true'),
  ...paging,
});
export type ListAdminCommBroadcastsQuery = z.input<typeof ListAdminCommBroadcastsQuery>;
export const ListAdminCommBroadcastsResponse = page(AdminCommBroadcast);
export type ListAdminCommBroadcastsResponse = z.infer<typeof ListAdminCommBroadcastsResponse>;

/** GET /admin/communications/broadcasts/summary: the cards (archived ones not counted). */
export const AdminCommBroadcastSummary = z.object({
  total: count,
  drafts: count,
  scheduled: count,
  /** SENT and PARTIALLY_SENT. */
  sent: count,
  failed: count,
});
export type AdminCommBroadcastSummary = z.infer<typeof AdminCommBroadcastSummary>;

/** POST /admin/communications/broadcasts: step 1 makes a draft with its name. */
export const CreateAdminCommBroadcastRequest = z.strictObject({
  name: z.string().trim().min(1, 'Name the broadcast').max(120),
});
export type CreateAdminCommBroadcastRequest = z.input<typeof CreateAdminCommBroadcastRequest>;

const ChannelInput = z
  .strictObject({
    channel: AdminCommBroadcastChannel,
    subject: z.string().trim().max(300).optional(),
    body: z.string().trim().min(1, 'Write the message').max(ADMIN_COMM_BODY_MAX),
    mediaIds: z.array(AdminCommMediaId).max(10).optional(),
  })
  .superRefine((c, ctx) => {
    if (c.channel === 'EMAIL' && !c.subject)
      ctx.addIssue({ code: 'custom', path: ['subject'], message: 'Add a subject' });
    if (c.channel !== 'EMAIL' && c.subject)
      ctx.addIssue({ code: 'custom', path: ['subject'], message: 'Only email has a subject' });
    if (c.channel === 'SMS' && c.body.length > ADMIN_COMM_SMS_MAX)
      ctx.addIssue({
        code: 'custom',
        path: ['body'],
        message: `A text message is at most ${ADMIN_COMM_SMS_MAX} characters`,
      });
    if (c.channel !== 'EMAIL' && c.mediaIds?.length)
      ctx.addIssue({ code: 'custom', path: ['mediaIds'], message: 'Files go on email only' });
  });

/**
 * PATCH /admin/communications/broadcasts/:id: steps 1 to 3 (name, audience, message), a draft or
 * scheduled broadcast only (409 NOT_EDITABLE). `channels` replaces the set: each channel once.
 */
export const UpdateAdminCommBroadcastRequest = z
  .strictObject({
    name: z.string().trim().min(1, 'Name the broadcast').max(120).optional(),
    segmentId: AdminCommSegmentId.nullable().optional(),
    channels: z
      .array(ChannelInput)
      .max(3)
      .refine((cs) => new Set(cs.map((c) => c.channel)).size === cs.length, 'Use each channel once')
      .optional(),
  })
  .refine((b) => Object.keys(b).length > 0, 'Change at least one thing');
export type UpdateAdminCommBroadcastRequest = z.input<typeof UpdateAdminCommBroadcastRequest>;

/** POST .../schedule (step 4): a time in the future, with its IANA zone. */
export const ScheduleAdminCommBroadcastRequest = z.strictObject({
  scheduledAt: DateTime,
  scheduledTimeZone: z.string().min(1).max(64),
});
export type ScheduleAdminCommBroadcastRequest = z.input<typeof ScheduleAdminCommBroadcastRequest>;

/** POST .../send now, or .../retry: the client's key, sent again unchanged on a retry. */
export const SendAdminCommBroadcastRequest = z.strictObject({ idempotencyKey: z.uuid() });
export type SendAdminCommBroadcastRequest = z.input<typeof SendAdminCommBroadcastRequest>;

/**
 * POST .../test: each chosen channel's content, filled with samples, to the signed-in member
 * (their email, `phone` for SMS, their bell for in-app). Not stored as a send; audited as a test.
 */
export const TestAdminCommBroadcastRequest = z.strictObject({
  channels: z.array(AdminCommBroadcastChannel).min(1).max(3),
  phone: z
    .string()
    .regex(/^\+[1-9]\d{7,14}$/, 'Enter the number as +15125550147')
    .optional(),
});
export type TestAdminCommBroadcastRequest = z.input<typeof TestAdminCommBroadcastRequest>;
export const AdminCommBroadcastTestSent = z.object({ sentTo: z.array(z.string()) });
export type AdminCommBroadcastTestSent = z.infer<typeof AdminCommBroadcastTestSent>;

export const AdminCommBroadcastRecipient = z.object({
  id: z.uuid(),
  channel: AdminCommBroadcastChannel,
  contactType: z.enum(['FIRM', 'LEAD', 'TEAM']),
  name: z.string(),
  address: z.string(),
  status: CommDeliveryStatus,
  errorCode: z.string().nullable(),
  sentAt: DateTime.nullable(),
  deliveredAt: DateTime.nullable(),
  failedAt: DateTime.nullable(),
});
export type AdminCommBroadcastRecipient = z.infer<typeof AdminCommBroadcastRecipient>;

/** GET .../recipients: who it went to and each result. */
export const ListAdminCommBroadcastRecipientsQuery = z.strictObject({
  channel: AdminCommBroadcastChannel.optional(),
  status: CommDeliveryStatus.optional(),
  search: SearchText.optional(),
  ...paging,
});
export type ListAdminCommBroadcastRecipientsQuery = z.input<
  typeof ListAdminCommBroadcastRecipientsQuery
>;
export const ListAdminCommBroadcastRecipientsResponse = page(AdminCommBroadcastRecipient);
export type ListAdminCommBroadcastRecipientsResponse = z.infer<
  typeof ListAdminCommBroadcastRecipientsResponse
>;

export const AdminCommBroadcastErrorCode = z.enum([
  'NOT_FOUND',
  /** The broadcast is sending or sent: its name, audience, schedule and content are fixed. */
  'NOT_EDITABLE',
  'NOT_DRAFT',
  'NOT_SCHEDULED',
  /** Only a FAILED broadcast is retried. */
  'NOT_RETRYABLE',
  /** Only a finished or cancelled broadcast is archived. */
  'NOT_FINISHED',
  /** No audience chosen. */
  'NO_SEGMENT',
  /** No channel content yet. */
  'NO_CHANNEL',
  /** The audience counted no one with an address on these channels. */
  'EMPTY_AUDIENCE',
  'SCHEDULE_IN_PAST',
  /** The segment is archived. */
  'SEGMENT_ARCHIVED',
  /** A file is not CLEAN, or is not the kind it is used as. */
  'MEDIA_NOT_USABLE',
  'DUPLICATE_NAME',
  'IDEMPOTENCY_CONFLICT',
]);
export type AdminCommBroadcastErrorCode = z.infer<typeof AdminCommBroadcastErrorCode>;

export const ADMIN_COMM_BROADCAST_ERRORS: Readonly<Record<AdminCommBroadcastErrorCode, string>> = {
  NOT_FOUND: 'This is no longer available. The list is now up to date.',
  NOT_EDITABLE: 'This broadcast is already going out, so it can no longer be changed.',
  NOT_DRAFT: 'Only a draft can be deleted.',
  NOT_SCHEDULED: 'Only a scheduled broadcast can be cancelled.',
  NOT_RETRYABLE: 'Only a broadcast that failed can be sent again.',
  NOT_FINISHED: 'Only a sent or cancelled broadcast can be archived.',
  NO_SEGMENT: 'Choose an audience first.',
  NO_CHANNEL: 'Write the message for at least one channel first.',
  EMPTY_AUDIENCE: 'No one in this audience can be reached on these channels.',
  SCHEDULE_IN_PAST: 'Choose a time in the future.',
  SEGMENT_ARCHIVED: 'This audience is archived. Choose another.',
  MEDIA_NOT_USABLE: 'A file cannot be used yet: it is still being checked, or it was not safe.',
  DUPLICATE_NAME: 'That name is already used. Choose another.',
  IDEMPOTENCY_CONFLICT: 'This send was already used for another broadcast. Reload and try again.',
};
