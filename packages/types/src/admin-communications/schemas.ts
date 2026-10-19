import { z } from 'zod';
import { MemberRef } from '../clients/schemas.js';
import { SearchText } from '../clients/text.js';
import {
  CommChannel,
  CommContactType,
  CommConversationStatus,
  CommDeliveryStatus,
  CommDirection,
  CommMessageStatus,
  CommRecipientKind,
  CommTemplateStatus,
} from '../db-enums.js';

// Super Admin Communications, the inbox (R0 stage B6, contract note
// docs/work/R0-stage-b6-communications.md): Firmivra's own correspondence with firms' people,
// sales leads and the Super Admin team. A firm's clients are never recipients. Conversations,
// their messages and delivery results, templates and their categories. Broadcasts, segments and
// the file library are the broadcasts contract's.
// Routes: /api/v1/admin/communications/... (the Super Admin site's session only).
// Responses are plain objects (a field the API adds later is dropped); requests are strict.
// Sending uses the platform's email and SMS adapters; what cannot go out yet is kept as sent to
// the queue (`SENDING`) and the delivery result follows later.

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
const oneLine = (max: number, message: string) =>
  z.string().trim().min(1, message).max(max, `Use at most ${max} characters`);

export const AdminCommConversationId = z.uuid();
export const AdminCommMessageId = z.uuid();
export const AdminCommTemplateId = z.uuid();
export const AdminCommTemplateCategoryId = z.uuid();

/** The longest SMS body the platform sends (several segments). */
export const ADMIN_COMM_SMS_MAX = 1600;
/** Email bodies (plain text or simple HTML). */
export const ADMIN_COMM_BODY_MAX = 50_000;

export const ADMIN_COMM_CONTACT_TYPE_LABELS: Readonly<Record<CommContactType, string>> = {
  FIRM: 'Firm',
  LEAD: 'Lead',
  TEAM: 'Team',
};
export const ADMIN_COMM_CHANNEL_LABELS: Readonly<Record<CommChannel, string>> = {
  EMAIL: 'Email',
  SMS: 'SMS',
  INTERNAL: 'Internal note',
  IN_APP: 'In-app',
};

/**
 * The merge fields templates and messages may use, written `{{firm.name}}` in a body and without
 * braces in `mergeFields`. The API fills them per recipient; a field with no value is left empty.
 */
export const ADMIN_COMM_MERGE_FIELDS = {
  'contact.first_name': { label: 'Contact first name', sample: 'Jordan' },
  'contact.name': { label: 'Contact full name', sample: 'Jordan Sample' },
  'contact.email': { label: 'Contact email', sample: 'jordan@sample-firm.example.test' },
  'firm.name': { label: 'Firm name', sample: 'Sample Tax Partners' },
  'sender.name': { label: 'Your name', sample: 'Octavia Sample' },
  'platform.name': { label: 'Firmivra', sample: 'Firmivra' },
} as const;
export type AdminCommMergeField = keyof typeof ADMIN_COMM_MERGE_FIELDS;

// ---------- Contacts ----------

/**
 * Who a conversation is with. FIRM: a firm's owner (the platform keeps no other firm people's
 * contact for the Super Admin); LEAD: a sales contact; TEAM: a Super Admin team member. Name,
 * email and phone are what the thread was started with (snapshots).
 */
export const AdminCommContact = z.object({
  type: CommContactType,
  /** FIRM: the firm. */
  business: z.object({ id: z.uuid(), name: z.string() }).nullable(),
  /** FIRM and TEAM: the person's user id. */
  userId: z.uuid().nullable(),
  /** LEAD: the sales contact. */
  salesContactId: z.uuid().nullable(),
  name: z.string(),
  email: z.string().nullable(),
  phone: z.string().nullable(),
});
export type AdminCommContact = z.infer<typeof AdminCommContact>;

/** GET /admin/communications/contacts: the New Message picker (at most 20). */
export const ListAdminCommContactsQuery = z.strictObject({
  type: CommContactType.optional(),
  search: SearchText.optional(),
});
export type ListAdminCommContactsQuery = z.input<typeof ListAdminCommContactsQuery>;
export const AdminCommContactList = z.object({ items: z.array(AdminCommContact).max(20) });
export type AdminCommContactList = z.infer<typeof AdminCommContactList>;

/** Who to start a thread with: the record, never typed contact details. */
export const AdminCommContactRef = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('FIRM'), businessId: z.uuid() }),
  z.strictObject({ type: z.literal('LEAD'), salesContactId: z.uuid() }),
  z.strictObject({ type: z.literal('TEAM'), userId: z.uuid() }),
]);
export type AdminCommContactRef = z.input<typeof AdminCommContactRef>;

// ---------- Messages ----------

export const AdminCommRecipient = z.object({
  id: z.uuid(),
  kind: CommRecipientKind,
  name: z.string(),
  /** An email address, an E.164 number, or the team member's name for internal and in-app. */
  address: z.string(),
  status: CommDeliveryStatus,
  errorCode: z.string().nullable(),
  sentAt: DateTime.nullable(),
  deliveredAt: DateTime.nullable(),
  failedAt: DateTime.nullable(),
});
export type AdminCommRecipient = z.infer<typeof AdminCommRecipient>;

export const AdminCommMessage = z.object({
  id: AdminCommMessageId,
  conversationId: AdminCommConversationId,
  channel: CommChannel,
  direction: CommDirection,
  status: CommMessageStatus,
  subject: z.string().nullable(),
  body: z.string(),
  template: z.object({ id: AdminCommTemplateId, name: z.string() }).nullable(),
  /** Set while SCHEDULED (and kept after it goes out). */
  scheduledAt: DateTime.nullable(),
  scheduledTimeZone: z.string().nullable(),
  /** The team member who wrote it; null for an inbound message. */
  sender: MemberRef.nullable(),
  /** Inbound: the address it came from. */
  fromAddress: z.string().nullable(),
  sentAt: DateTime.nullable(),
  failedAt: DateTime.nullable(),
  errorCode: z.string().nullable(),
  errorMessage: z.string().nullable(),
  /** A retry names the failed message it repeats (which stays in history). */
  retryOfMessageId: AdminCommMessageId.nullable(),
  /** Set when the message is part of a broadcast. */
  broadcastId: z.uuid().nullable(),
  recipients: z.array(AdminCommRecipient),
  /** Internal notes: the team members mentioned. */
  mentions: z.array(MemberRef),
  createdAt: DateTime,
  updatedAt: DateTime,
});
export type AdminCommMessage = z.infer<typeof AdminCommMessage>;

/** What happens on create: keep a draft, send now, or schedule. */
export const AdminCommSendMode = z.enum(['DRAFT', 'SEND', 'SCHEDULE']);
export type AdminCommSendMode = z.infer<typeof AdminCommSendMode>;

const Emails = z
  .array(z.email('Enter a valid email address').max(254))
  .max(20, 'Use at most 20 addresses');
const Schedule = {
  /** In the future. */
  scheduledAt: DateTime.optional(),
  /** IANA zone the time was chosen in (shown back to the team), e.g. `America/New_York`. */
  scheduledTimeZone: z.string().min(1).max(64).optional(),
};
const contentRules = (
  b: {
    channel?: CommChannel | undefined;
    subject?: string | null | undefined;
    body?: string | undefined;
    cc?: unknown[] | undefined;
    bcc?: unknown[] | undefined;
  },
  ctx: z.RefinementCtx,
) => {
  if (b.channel === 'SMS' && b.body && b.body.length > ADMIN_COMM_SMS_MAX)
    ctx.addIssue({
      code: 'custom',
      path: ['body'],
      message: `A text message is at most ${ADMIN_COMM_SMS_MAX} characters`,
    });
  if (b.channel && b.channel !== 'EMAIL' && ((b.cc?.length ?? 0) > 0 || (b.bcc?.length ?? 0) > 0))
    ctx.addIssue({ code: 'custom', path: ['cc'], message: 'Cc and Bcc are for email only' });
};

/**
 * POST /admin/communications/messages: a new message, in an existing thread (`conversationId`)
 * or a new one with `contact`. EMAIL and SMS go to the contact's address; INTERNAL is a note in
 * the thread (mention team members with `mentionUserIds`). An email needs a subject once it leaves
 * draft. `idempotencyKey`: a new random id per compose, sent again on a retry (sent once).
 */
export const CreateAdminCommMessageRequest = z
  .strictObject({
    conversationId: AdminCommConversationId.optional(),
    contact: AdminCommContactRef.optional(),
    channel: z.enum(['EMAIL', 'SMS', 'INTERNAL']),
    subject: z.string().trim().max(250).optional(),
    body: z.string().trim().min(1, 'Write a message').max(ADMIN_COMM_BODY_MAX),
    templateId: AdminCommTemplateId.optional(),
    cc: Emails.optional(),
    bcc: Emails.optional(),
    mentionUserIds: z.array(z.uuid()).max(20).optional(),
    mode: AdminCommSendMode,
    ...Schedule,
    idempotencyKey: z.uuid(),
  })
  .superRefine((b, ctx) => {
    if (!b.conversationId === !b.contact)
      ctx.addIssue({
        code: 'custom',
        path: ['contact'],
        message: 'Choose a conversation or a contact',
      });
    if (b.channel === 'INTERNAL' && b.mode !== 'SEND')
      ctx.addIssue({ code: 'custom', path: ['mode'], message: 'A note is saved as it is written' });
    if (b.channel === 'EMAIL' && b.mode !== 'DRAFT' && !b.subject)
      ctx.addIssue({ code: 'custom', path: ['subject'], message: 'Add a subject' });
    if (b.mode === 'SCHEDULE' && (!b.scheduledAt || !b.scheduledTimeZone))
      ctx.addIssue({ code: 'custom', path: ['scheduledAt'], message: 'Choose when to send it' });
    contentRules(b, ctx);
  });
export type CreateAdminCommMessageRequest = z.input<typeof CreateAdminCommMessageRequest>;

/** PATCH /admin/communications/messages/:id: a draft or scheduled message only (409 NOT_EDITABLE). */
export const UpdateAdminCommMessageRequest = z
  .strictObject({
    subject: z.string().trim().max(250).nullable().optional(),
    body: z.string().trim().min(1, 'Write a message').max(ADMIN_COMM_BODY_MAX).optional(),
    templateId: AdminCommTemplateId.nullable().optional(),
    cc: Emails.optional(),
    bcc: Emails.optional(),
  })
  .refine((b) => Object.keys(b).length > 0, 'Change at least one thing');
export type UpdateAdminCommMessageRequest = z.input<typeof UpdateAdminCommMessageRequest>;

/** POST .../send and .../retry: the client's key, sent again unchanged on a retry. */
export const AdminCommSendRequest = z.strictObject({ idempotencyKey: z.uuid() });
export type AdminCommSendRequest = z.input<typeof AdminCommSendRequest>;

/** POST .../schedule: a draft or scheduled message, to a time in the future. */
export const ScheduleAdminCommMessageRequest = z.strictObject({
  scheduledAt: DateTime,
  scheduledTimeZone: z.string().min(1).max(64),
});
export type ScheduleAdminCommMessageRequest = z.input<typeof ScheduleAdminCommMessageRequest>;

// ---------- Conversations ----------

/** The list's tabs. INBOX: open threads. SCHEDULED: threads with a message waiting to go out. */
export const AdminCommView = z.enum([
  'INBOX',
  'ASSIGNED_TO_ME',
  'UNASSIGNED',
  'MENTIONS',
  'ALL',
  'SCHEDULED',
]);
export type AdminCommView = z.infer<typeof AdminCommView>;

export const AdminCommConversation = z.object({
  id: AdminCommConversationId,
  contact: AdminCommContact,
  subject: z.string().nullable(),
  status: CommConversationStatus,
  assignedTo: MemberRef.nullable(),
  tags: z.array(z.string()),
  /** The newest message, for the list's preview; null for a thread with drafts only. */
  lastMessage: z
    .object({
      excerpt: z.string(),
      channel: CommChannel,
      direction: CommDirection,
      status: CommMessageStatus,
      at: DateTime,
    })
    .nullable(),
  lastMessageAt: DateTime.nullable(),
  /** A message arrived after the signed-in member's read mark. */
  unread: z.boolean(),
  /** The signed-in member is mentioned in one of its notes. */
  mentionsMe: z.boolean(),
  hasScheduled: z.boolean(),
  hasFailed: z.boolean(),
  createdAt: DateTime,
});
export type AdminCommConversation = z.infer<typeof AdminCommConversation>;

export const AdminCommConversationDetail = AdminCommConversation.extend({
  /** Oldest first, drafts included. */
  messages: z.array(AdminCommMessage),
});
export type AdminCommConversationDetail = z.infer<typeof AdminCommConversationDetail>;

/** GET /admin/communications/conversations. */
export const ListAdminCommConversationsQuery = z.strictObject({
  view: AdminCommView.optional().default('INBOX'),
  channel: CommChannel.optional(),
  contactType: CommContactType.optional(),
  /** Matches the contact's name, email and phone, the subject and the tags. */
  search: SearchText.optional(),
  sort: z.enum(['NEWEST', 'OLDEST', 'UNREAD_FIRST']).optional().default('NEWEST'),
  ...paging,
});
export type ListAdminCommConversationsQuery = z.input<typeof ListAdminCommConversationsQuery>;
export const ListAdminCommConversationsResponse = page(AdminCommConversation);
export type ListAdminCommConversationsResponse = z.infer<typeof ListAdminCommConversationsResponse>;

const Tag = z.string().trim().min(1).max(40);

/** PATCH /admin/communications/conversations/:id: assignment, tags and status. */
export const UpdateAdminCommConversationRequest = z
  .strictObject({
    /** A Super Admin team member, or null to unassign. */
    assignedToUserId: z.uuid().nullable().optional(),
    tags: z.array(Tag).max(20, 'Use at most 20 tags').optional(),
    status: CommConversationStatus.optional(),
  })
  .refine((b) => Object.keys(b).length > 0, 'Change at least one thing');
export type UpdateAdminCommConversationRequest = z.input<typeof UpdateAdminCommConversationRequest>;

/**
 * GET /admin/communications/summary: the cards. `waitingOnReply`: open threads whose newest message
 * is ours (the contact has not answered). `failed`: messages that failed or went out in part and
 * were not retried. `byChannel`: open threads by the channel of their newest message.
 */
export const AdminCommSummary = z.object({
  unread: count,
  open: count,
  waitingOnReply: count,
  scheduled: count,
  failed: count,
  byChannel: z.object({ EMAIL: count, SMS: count, INTERNAL: count, IN_APP: count }),
});
export type AdminCommSummary = z.infer<typeof AdminCommSummary>;

// ---------- Templates ----------

export const AdminCommTemplateCategory = z.object({
  id: AdminCommTemplateCategoryId,
  name: z.string(),
  /** The six shipped categories have one (`sales`, `onboarding`...); they cannot be renamed. */
  systemKey: z.string().nullable(),
  position: z.number().int(),
  isActive: z.boolean(),
  templateCount: count,
});
export type AdminCommTemplateCategory = z.infer<typeof AdminCommTemplateCategory>;
export const AdminCommTemplateCategoryList = z.object({
  items: z.array(AdminCommTemplateCategory),
});
export type AdminCommTemplateCategoryList = z.infer<typeof AdminCommTemplateCategoryList>;

export const CreateAdminCommTemplateCategoryRequest = z.strictObject({
  name: oneLine(60, 'Name the category'),
});
export type CreateAdminCommTemplateCategoryRequest = z.input<
  typeof CreateAdminCommTemplateCategoryRequest
>;
/** Categories are deactivated, never deleted. */
export const UpdateAdminCommTemplateCategoryRequest = z
  .strictObject({
    name: oneLine(60, 'Name the category').optional(),
    position: z.number().int().min(0).max(1000).optional(),
    isActive: z.boolean().optional(),
  })
  .refine((b) => Object.keys(b).length > 0, 'Change at least one thing');
export type UpdateAdminCommTemplateCategoryRequest = z.input<
  typeof UpdateAdminCommTemplateCategoryRequest
>;

export const AdminCommTemplateChannel = z.enum(['EMAIL', 'SMS']);
export type AdminCommTemplateChannel = z.infer<typeof AdminCommTemplateChannel>;

export const AdminCommTemplate = z.object({
  id: AdminCommTemplateId,
  category: z.object({ id: AdminCommTemplateCategoryId, name: z.string() }),
  name: z.string(),
  channel: AdminCommTemplateChannel,
  status: CommTemplateStatus,
  /** Email only. */
  subject: z.string().nullable(),
  body: z.string(),
  /** The merge fields the subject and body use, from `ADMIN_COMM_MERGE_FIELDS`. */
  mergeFields: z.array(z.string()),
  createdBy: MemberRef.nullable(),
  updatedBy: MemberRef.nullable(),
  createdAt: DateTime,
  updatedAt: DateTime,
});
export type AdminCommTemplate = z.infer<typeof AdminCommTemplate>;

/** GET /admin/communications/templates. Archived ones only with `status: 'ARCHIVED'`. */
export const ListAdminCommTemplatesQuery = z.strictObject({
  categoryId: AdminCommTemplateCategoryId.optional(),
  channel: AdminCommTemplateChannel.optional(),
  status: CommTemplateStatus.optional(),
  search: SearchText.optional(),
  sort: z.enum(['UPDATED', 'NAME']).optional().default('UPDATED'),
  ...paging,
});
export type ListAdminCommTemplatesQuery = z.input<typeof ListAdminCommTemplatesQuery>;
export const ListAdminCommTemplatesResponse = page(AdminCommTemplate);
export type ListAdminCommTemplatesResponse = z.infer<typeof ListAdminCommTemplatesResponse>;

const templateRules = (
  b: {
    channel?: string | undefined;
    subject?: string | null | undefined;
    body?: string | undefined;
  },
  ctx: z.RefinementCtx,
) => {
  if (b.channel === 'EMAIL' && !b.subject)
    ctx.addIssue({
      code: 'custom',
      path: ['subject'],
      message: 'An email template needs a subject',
    });
  if (b.channel === 'SMS' && b.subject)
    ctx.addIssue({ code: 'custom', path: ['subject'], message: 'A text template has no subject' });
  if (b.channel === 'SMS' && b.body && b.body.length > ADMIN_COMM_SMS_MAX)
    ctx.addIssue({
      code: 'custom',
      path: ['body'],
      message: `A text message is at most ${ADMIN_COMM_SMS_MAX} characters`,
    });
};

/** POST /admin/communications/templates. The API lists the merge fields the text uses. */
export const CreateAdminCommTemplateRequest = z
  .strictObject({
    categoryId: AdminCommTemplateCategoryId,
    name: oneLine(120, 'Name the template'),
    channel: AdminCommTemplateChannel,
    subject: z.string().trim().max(250).optional(),
    body: z.string().trim().min(1, 'Write the template').max(ADMIN_COMM_BODY_MAX),
    status: z.enum(['ACTIVE', 'INACTIVE']).optional().default('ACTIVE'),
  })
  .superRefine(templateRules);
export type CreateAdminCommTemplateRequest = z.input<typeof CreateAdminCommTemplateRequest>;

/** PATCH /admin/communications/templates/:id. The channel never changes; archive with `.../archive`. */
export const UpdateAdminCommTemplateRequest = z
  .strictObject({
    categoryId: AdminCommTemplateCategoryId.optional(),
    name: oneLine(120, 'Name the template').optional(),
    subject: z.string().trim().max(250).nullable().optional(),
    body: z.string().trim().min(1, 'Write the template').max(ADMIN_COMM_BODY_MAX).optional(),
    status: z.enum(['ACTIVE', 'INACTIVE']).optional(),
  })
  .refine((b) => Object.keys(b).length > 0, 'Change at least one thing');
export type UpdateAdminCommTemplateRequest = z.input<typeof UpdateAdminCommTemplateRequest>;

/**
 * POST .../templates/:id/preview: the subject and body with merge fields filled, from a contact
 * when one is given, else from each field's sample.
 */
export const PreviewAdminCommTemplateRequest = z.strictObject({
  contact: AdminCommContactRef.optional(),
});
export type PreviewAdminCommTemplateRequest = z.input<typeof PreviewAdminCommTemplateRequest>;
export const AdminCommTemplatePreview = z.object({
  subject: z.string().nullable(),
  body: z.string(),
  /** Merge fields that had no value (left empty in the preview). */
  missing: z.array(z.string()),
});
export type AdminCommTemplatePreview = z.infer<typeof AdminCommTemplatePreview>;

/**
 * POST .../templates/:id/test: sends the filled template (samples) to the signed-in member's own
 * email (EMAIL) or to `phone` (SMS). Not stored as a send; audited as a test.
 */
export const TestAdminCommTemplateRequest = z.strictObject({
  phone: z
    .string()
    .regex(/^\+[1-9]\d{7,14}$/, 'Enter the number as +15125550147')
    .optional(),
});
export type TestAdminCommTemplateRequest = z.input<typeof TestAdminCommTemplateRequest>;
export const AdminCommTestSent = z.object({ sentTo: z.string() });
export type AdminCommTestSent = z.infer<typeof AdminCommTestSent>;

// ---------- Errors ----------

export const AdminCommErrorCode = z.enum([
  'NOT_FOUND',
  /** The message is sending or sent: subject, body, template, schedule and recipients are fixed. */
  'NOT_EDITABLE',
  /** Only a draft is deleted. */
  'NOT_DRAFT',
  /** Only a scheduled message is cancelled. */
  'NOT_SCHEDULED',
  /** Only a failed or partly sent message is retried. */
  'NOT_RETRYABLE',
  /** The contact has no address for this channel (no email, or no E.164 phone). */
  'NO_DESTINATION',
  'SCHEDULE_IN_PAST',
  /** The template is for the other channel, inactive, or archived. */
  'TEMPLATE_NOT_USABLE',
  /** A category or template with this name exists. */
  'DUPLICATE_NAME',
  /** The category is inactive: no new templates in it. */
  'CATEGORY_INACTIVE',
  /** The shipped categories keep their names. */
  'SYSTEM_CATEGORY',
  /** The assignee or a mentioned person is not on the Super Admin team. */
  'NOT_A_TEAM_MEMBER',
  /** This idempotency key was used for another message. */
  'IDEMPOTENCY_CONFLICT',
]);
export type AdminCommErrorCode = z.infer<typeof AdminCommErrorCode>;

export const ADMIN_COMM_ERRORS: Readonly<Record<AdminCommErrorCode, string>> = {
  NOT_FOUND: 'This is no longer available. The list is now up to date.',
  NOT_EDITABLE: 'This message is already going out, so it can no longer be changed.',
  NOT_DRAFT: 'Only a draft can be deleted.',
  NOT_SCHEDULED: 'Only a scheduled message can be cancelled.',
  NOT_RETRYABLE: 'Only a message that failed can be sent again.',
  NO_DESTINATION:
    'This contact has no address for that channel. Add one, or choose another channel.',
  SCHEDULE_IN_PAST: 'Choose a time in the future.',
  TEMPLATE_NOT_USABLE:
    'This template cannot be used here. Choose an active template for this channel.',
  DUPLICATE_NAME: 'That name is already used. Choose another.',
  CATEGORY_INACTIVE: 'This category is inactive. Choose another or turn it back on.',
  SYSTEM_CATEGORY: 'The built-in categories keep their names.',
  NOT_A_TEAM_MEMBER: 'Choose someone on the Firmivra team.',
  IDEMPOTENCY_CONFLICT: 'This send was already used for another message. Reload and try again.',
};
