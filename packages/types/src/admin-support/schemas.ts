import { z } from 'zod';
import { SearchText, text } from '../clients/text.js';
import { ScanStatus, SupportTicketSource, SupportTicketStatus } from '../db-enums.js';
import { UPLOAD_LIMITS, UploadContentType } from '../documents/schemas.js';

// Super Admin Support (R0 stage B2, `support_*` tables; contract note
// docs/work/R0-stage-b2-support.md; notes on this contract in docs/work/R60-backend.md).
// Firmivra's support desk for firms: the Support dashboard (tickets, tabs, filters, the New Ticket
// form), Ticket Detail (conversation, internal notes, files, activity) and Support Settings.
// Routes: /api/v1/admin/support/... (the Super Admin site's session only).
// Statuses are the database's five. Escalated and Overdue are flags and tabs, not statuses: an
// escalated ticket has `escalation`, an overdue one has `sla.state` BREACHED.
// Responses are plain objects (a field the API adds later is dropped); requests are strict.

const DateTime = z.iso.datetime({ offset: true });
/** `YYYY-MM-DD`, a day in the support time zone. */
const Day = z.iso.date();
const Id = z.uuid();

export const SupportTicketId = Id;
export const SupportAttachmentId = Id;
export const SupportCategoryId = Id;
export const SupportPriorityId = Id;
export const SupportHolidayId = Id;
export const SupportCannedResponseId = Id;

/** Several values in one query parameter: an array in, `a,b` on the wire, an array out. */
const listOf = <T extends z.ZodType>(item: T) =>
  z
    .preprocess(
      (value) => (typeof value === 'string' ? value.split(',').filter(Boolean) : value),
      z.array(item).max(20),
    )
    .optional();

// ---------- Labels and enums ----------

export const SUPPORT_TICKET_STATUS_LABELS: Readonly<Record<SupportTicketStatus, string>> = {
  OPEN: 'Open',
  IN_PROGRESS: 'In Progress',
  WAITING_ON_CUSTOMER: 'Waiting on Customer',
  RESOLVED: 'Resolved',
  CLOSED: 'Closed',
};
/** Statuses a new ticket may start in. */
export const SUPPORT_NEW_TICKET_STATUSES = ['OPEN', 'IN_PROGRESS', 'WAITING_ON_CUSTOMER'] as const;
export const SupportNewTicketStatus = z.enum(SUPPORT_NEW_TICKET_STATUSES);

export const SUPPORT_TICKET_SOURCE_LABELS: Readonly<Record<SupportTicketSource, string>> = {
  PORTAL: 'Portal',
  EMAIL: 'Email',
  PHONE: 'Phone',
  INTERNAL: 'Internal',
  WEB_FORM: 'Web Form',
};

/**
 * The response clock, worked out on every read (never stored): WITHIN, WARNING (under a quarter of
 * the target left), BREACHED (past due), PAUSED (waiting on the customer), MET (resolved or closed
 * without a breach; one that breached stays BREACHED).
 */
export const SupportSlaState = z.enum(['WITHIN', 'WARNING', 'BREACHED', 'PAUSED', 'MET']);
export type SupportSlaState = z.infer<typeof SupportSlaState>;
export const SUPPORT_SLA_STATE_LABELS: Readonly<Record<SupportSlaState, string>> = {
  WITHIN: 'Within SLA',
  WARNING: 'Warning',
  BREACHED: 'Breached',
  PAUSED: 'Paused',
  MET: 'Met',
};

/** Named colours from the design tokens (no hex in the UI). */
export const SupportPriorityColor = z.enum([
  'red',
  'orange',
  'yellow',
  'green',
  'blue',
  'purple',
  'grey',
]);
export type SupportPriorityColor = z.infer<typeof SupportPriorityColor>;
export const SUPPORT_PRIORITY_COLOR_LABELS: Readonly<Record<SupportPriorityColor, string>> = {
  red: 'Red',
  orange: 'Orange',
  yellow: 'Yellow',
  green: 'Green',
  blue: 'Blue',
  purple: 'Purple',
  grey: 'Grey',
};

/** A response target. A business day is the length of an open day in the business hours. */
export const SupportTarget = z.strictObject({
  amount: z
    .number()
    .int('Enter a whole number')
    .min(1, 'Enter a target from 1 to 999')
    .max(999, 'Enter a target from 1 to 999'),
  unit: z.enum(['HOURS', 'BUSINESS_DAYS']),
});
export type SupportTarget = z.infer<typeof SupportTarget>;

export const SupportAgentRole = z.enum(['OWNER', 'LEAD', 'AGENT']);
export type SupportAgentRole = z.infer<typeof SupportAgentRole>;
export const SUPPORT_AGENT_ROLE_LABELS: Readonly<Record<SupportAgentRole, string>> = {
  OWNER: 'Owner / Super Admin',
  LEAD: 'Support Lead',
  AGENT: 'Support Agent',
};

export const SupportPermission = z.enum([
  'VIEW_ALL',
  'VIEW_OWN',
  'ASSIGN',
  'ESCALATE',
  'RESOLVE',
  'CLOSE',
  'MERGE',
  'EDIT_SETTINGS',
  'DELETE',
  'VIEW_INTERNAL_NOTES',
  'MANAGE_CANNED',
]);
export type SupportPermission = z.infer<typeof SupportPermission>;
export const SUPPORT_PERMISSION_LABELS: Readonly<Record<SupportPermission, string>> = {
  VIEW_ALL: 'View all tickets',
  VIEW_OWN: 'View own tickets',
  ASSIGN: 'Assign tickets',
  ESCALATE: 'Escalate',
  RESOLVE: 'Resolve',
  CLOSE: 'Close',
  MERGE: 'Merge',
  EDIT_SETTINGS: 'Edit settings',
  DELETE: 'Delete tickets',
  VIEW_INTERNAL_NOTES: 'View internal notes',
  MANAGE_CANNED: 'Manage canned responses',
};

export const SupportNotificationEvent = z.enum([
  'NEW_TICKET',
  'ASSIGNED',
  'REASSIGNED',
  'REPLY',
  'ESCALATED',
  'SLA_WARNING',
  'SLA_BREACH',
  'RESOLVED',
  'CLOSED',
  'REOPENED',
  'CUSTOMER_RESPONSE',
]);
export type SupportNotificationEvent = z.infer<typeof SupportNotificationEvent>;
export const SUPPORT_NOTIFICATION_EVENT_LABELS: Readonly<Record<SupportNotificationEvent, string>> =
  {
    NEW_TICKET: 'New ticket',
    ASSIGNED: 'Assignment',
    REASSIGNED: 'Reassignment',
    REPLY: 'Support reply',
    ESCALATED: 'Escalation',
    SLA_WARNING: 'SLA warning',
    SLA_BREACH: 'SLA breach',
    RESOLVED: 'Resolved',
    CLOSED: 'Closed',
    REOPENED: 'Reopened',
    CUSTOMER_RESPONSE: 'Customer response',
  };

export const SupportNotificationRecipient = z.enum(['ASSIGNEE', 'LEAD', 'ADMINS', 'CLIENT']);
export type SupportNotificationRecipient = z.infer<typeof SupportNotificationRecipient>;
export const SUPPORT_NOTIFICATION_RECIPIENT_LABELS: Readonly<
  Record<SupportNotificationRecipient, string>
> = {
  ASSIGNEE: 'Assignee',
  LEAD: 'Team Lead',
  ADMINS: 'Admins',
  CLIENT: 'Client',
};
/** The only events the firm's contact may hear about (never notes, SLA or escalation). */
export const SUPPORT_CLIENT_EVENTS: readonly SupportNotificationEvent[] = [
  'NEW_TICKET',
  'REPLY',
  'RESOLVED',
  'CLOSED',
  'REOPENED',
];

export const SupportChannel = z.enum(['IN_APP', 'EMAIL', 'SMS']);
export type SupportChannel = z.infer<typeof SupportChannel>;
export const SUPPORT_CHANNEL_LABELS: Readonly<Record<SupportChannel, string>> = {
  IN_APP: 'In-app',
  EMAIL: 'Email',
  SMS: 'SMS',
};

/** The support time zones the settings offer. */
export const SUPPORT_TIME_ZONES = [
  { value: 'America/New_York', label: 'Eastern Time', short: 'ET' },
  { value: 'America/Chicago', label: 'Central Time', short: 'CT' },
  { value: 'America/Denver', label: 'Mountain Time', short: 'MT' },
  { value: 'America/Los_Angeles', label: 'Pacific Time', short: 'PT' },
] as const;
export const SupportTimeZone = z.enum(
  SUPPORT_TIME_ZONES.map((zone) => zone.value) as [string, ...string[]],
  'Choose a time zone',
);

export const SupportTicketTab = z.enum([
  'ALL',
  'UNASSIGNED',
  'MINE',
  'HIGH_PRIORITY',
  'OVERDUE',
  'WAITING',
  'ESCALATED',
  'CLOSED',
]);
export type SupportTicketTab = z.infer<typeof SupportTicketTab>;

/** Files on tickets: the documents' five checked types, at most 10 MB, at most 10 at a time. */
export const SUPPORT_ATTACHMENT_LIMITS = {
  maxBytes: UPLOAD_LIMITS.maxBytes,
  maxFiles: 10,
  typeNames: UPLOAD_LIMITS.typeNames,
  types: UPLOAD_LIMITS.types,
} as const;

// ---------- The team and the firms ----------

/** A Super Admin team member who can take tickets. */
export const SupportAgent = z.object({
  /** The member's user id. */
  id: Id,
  name: z.string(),
  email: z.string(),
  role: SupportAgentRole,
  /** Deactivated members keep their name on history but get no new tickets. */
  active: z.boolean(),
  /** Round robin skips members who are away. */
  available: z.boolean(),
});
export type SupportAgent = z.infer<typeof SupportAgent>;

/** A firm's person a ticket can be about (the firm's active owners). */
export const SupportFirmContact = z.object({
  /** The person's user id. */
  id: Id,
  name: z.string(),
  email: z.string(),
  /** '' when none is on file. */
  phone: z.string(),
  primary: z.boolean(),
});
export type SupportFirmContact = z.infer<typeof SupportFirmContact>;

export const SupportFirm = z.object({
  id: Id,
  name: z.string(),
  contacts: z.array(SupportFirmContact),
});
export type SupportFirm = z.infer<typeof SupportFirm>;

/** The pickers: every firm with its contacts, and the team. */
export const SupportDirectory = z.object({
  firms: z.array(SupportFirm),
  agents: z.array(SupportAgent),
});
export type SupportDirectory = z.infer<typeof SupportDirectory>;

/** The signed-in member and what Support lets them do. */
export const SupportMe = z.object({
  agent: SupportAgent,
  permissions: z.array(SupportPermission),
});
export type SupportMe = z.infer<typeof SupportMe>;

// ---------- Settings ----------

export const SupportCategory = z.object({
  id: Id,
  name: z.string(),
  /** '' when none. */
  description: z.string(),
  active: z.boolean(),
});
export type SupportCategory = z.infer<typeof SupportCategory>;

export const SupportPriority = z.object({
  id: Id,
  name: z.string(),
  description: z.string(),
  color: SupportPriorityColor,
  target: SupportTarget,
  active: z.boolean(),
  /** 1 is the most urgent: the order of lists, sorting and the High Priority tab. */
  rank: z.number().int(),
});
export type SupportPriority = z.infer<typeof SupportPriority>;

const Clock = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:MM, 24-hour');

export const SupportDayHours = z.strictObject({
  /** 0 is Sunday. */
  day: z.number().int().min(0).max(6),
  open: z.boolean(),
  /** `HH:MM`, 24-hour. */
  start: Clock,
  end: Clock,
});
export type SupportDayHours = z.infer<typeof SupportDayHours>;

export const SupportHoliday = z.object({ id: Id, date: Day, name: z.string() });
export type SupportHoliday = z.infer<typeof SupportHoliday>;

/** BUSINESS counts only open hours (holidays closed); CALENDAR counts every hour. */
export const SupportClock = z.enum(['BUSINESS', 'CALENDAR']);
export type SupportClock = z.infer<typeof SupportClock>;

export const SupportBusinessHours = z.object({
  timeZone: z.string(),
  days: z.array(SupportDayHours),
  holidays: z.array(SupportHoliday),
  clock: SupportClock,
});
export type SupportBusinessHours = z.infer<typeof SupportBusinessHours>;

export const SupportAssignmentRules = z.strictObject({
  /** New tickets without an assignee wait in the Support Team queue. */
  defaultQueue: z.boolean(),
  roundRobin: z.boolean(),
  /** Reassign (round robin) when the assignee has not taken the ticket in time. */
  reassign: z.boolean(),
  reassignAfterHours: z
    .number()
    .int('Enter whole hours')
    .min(1, 'Reassign after 1 to 72 hours')
    .max(72, 'Reassign after 1 to 72 hours'),
});
export type SupportAssignmentRules = z.infer<typeof SupportAssignmentRules>;

export const SupportEscalationRules = z.strictObject({
  slaBreach: z.strictObject({ enabled: z.boolean(), notify: z.enum(['LEAD', 'ADMINS']) }),
  highPriority: z.strictObject({
    enabled: z.boolean(),
    priorityId: Id,
    target: SupportTarget,
  }),
  critical: z.strictObject({
    enabled: z.boolean(),
    priorityId: Id,
    channels: z.array(SupportChannel).max(3),
  }),
});
export type SupportEscalationRules = z.infer<typeof SupportEscalationRules>;

export const SupportCannedResponse = z.object({
  id: Id,
  title: z.string(),
  body: z.string(),
  categoryId: Id.nullable(),
  active: z.boolean(),
  /** The author's name. */
  createdBy: z.string(),
  updatedAt: DateTime,
});
export type SupportCannedResponse = z.infer<typeof SupportCannedResponse>;

export const SupportNotificationRule = z.strictObject({
  event: SupportNotificationEvent,
  recipients: z.array(SupportNotificationRecipient).max(4),
});
export type SupportNotificationRule = z.infer<typeof SupportNotificationRule>;

export const SupportNotificationSettings = z.strictObject({
  channels: z.array(SupportChannel).max(3),
  rules: z.array(SupportNotificationRule).max(20),
});
export type SupportNotificationSettings = z.infer<typeof SupportNotificationSettings>;

/** What each role may do. The Owner always keeps EDIT_SETTINGS (422 OWNER_KEEPS_SETTINGS). */
export const SupportPermissionGrid = z.strictObject({
  OWNER: z.array(SupportPermission).max(11),
  LEAD: z.array(SupportPermission).max(11),
  AGENT: z.array(SupportPermission).max(11),
});
export type SupportPermissionGrid = z.infer<typeof SupportPermissionGrid>;

export const SupportSettings = z.object({
  categories: z.array(SupportCategory),
  priorities: z.array(SupportPriority),
  businessHours: SupportBusinessHours,
  assignment: SupportAssignmentRules,
  escalation: SupportEscalationRules,
  cannedResponses: z.array(SupportCannedResponse),
  notifications: SupportNotificationSettings,
  permissions: SupportPermissionGrid,
});
export type SupportSettings = z.infer<typeof SupportSettings>;

// ---------- Tickets ----------

export const SupportTicketSla = z.object({
  state: SupportSlaState,
  /** When the next support response is due; null when none is due. */
  dueAt: DateTime.nullable(),
  /** Minutes until `dueAt`; negative once it has passed. */
  minutesLeft: z.number().int().nullable(),
});
export type SupportTicketSla = z.infer<typeof SupportTicketSla>;

/** Who wrote a message: the firm's side (CLIENT) or Firmivra's team (SUPPORT). */
export const SupportAuthorRole = z.enum(['CLIENT', 'SUPPORT']);
export type SupportAuthorRole = z.infer<typeof SupportAuthorRole>;

/** A row of the ticket list. */
export const SupportTicket = z.object({
  id: Id,
  /** Shown as #1001; platform-wide, given by the database. */
  number: z.number().int(),
  subject: z.string(),
  status: SupportTicketStatus,
  source: SupportTicketSource,
  priority: z.object({
    id: Id,
    name: z.string(),
    color: SupportPriorityColor,
    rank: z.number().int(),
    active: z.boolean(),
  }),
  category: z.object({ id: Id, name: z.string(), active: z.boolean() }),
  firm: z.object({ id: Id, name: z.string() }),
  /** Name and email only for a contact the Super Admin may see (the firm's owners). */
  contact: z.object({ id: Id, name: z.string(), email: z.string(), phone: z.string() }),
  assignee: z.object({ id: Id, name: z.string(), active: z.boolean() }).nullable(),
  createdBy: z.object({ name: z.string(), role: SupportAuthorRole }),
  createdAt: DateTime,
  /** Last activity. */
  updatedAt: DateTime,
  firstResponseAt: DateTime.nullable(),
  resolvedAt: DateTime.nullable(),
  closedAt: DateTime.nullable(),
  sla: SupportTicketSla,
  /** Set once escalated (by a person or a rule); stays after the ticket moves on. */
  escalation: z.object({ reason: z.string(), at: DateTime, by: z.string() }).nullable(),
  mergedInto: z.object({ id: Id, number: z.number().int() }).nullable(),
  counts: z.object({
    messages: z.number().int(),
    attachments: z.number().int(),
    notes: z.number().int(),
  }),
  /** Send it back with a change; a stale one is 409 CONFLICT. */
  version: z.number().int(),
});
export type SupportTicket = z.infer<typeof SupportTicket>;

export const SupportTicketMessage = z.object({
  id: Id,
  author: z.object({ name: z.string(), role: SupportAuthorRole }),
  body: z.string(),
  at: DateTime,
  attachments: z.array(z.object({ id: Id, name: z.string() })),
  /** False for a support reply kept in the conversation without delivering it. */
  sentToClient: z.boolean(),
  /** The number of the ticket merged into this one that the message came from. */
  mergedFrom: z.number().int().nullable(),
});
export type SupportTicketMessage = z.infer<typeof SupportTicketMessage>;

export const SupportTicketNote = z.object({
  id: Id,
  author: z.string(),
  body: z.string(),
  at: DateTime,
  mergedFrom: z.number().int().nullable(),
});
export type SupportTicketNote = z.infer<typeof SupportTicketNote>;

export const SupportTicketAttachment = z.object({
  id: Id,
  name: z.string(),
  type: z.string(),
  size: z.number().int(),
  uploadedBy: z.string(),
  at: DateTime,
  mergedFrom: z.number().int().nullable(),
  /** Download only when CLEAN (409 SCAN_PENDING or FILE_BLOCKED otherwise). */
  scanStatus: ScanStatus,
});
export type SupportTicketAttachment = z.infer<typeof SupportTicketAttachment>;

export const SupportActivityType = z.enum([
  'CREATED',
  'ASSIGNED',
  'REASSIGNED',
  'UNASSIGNED',
  'STATUS_CHANGED',
  'PRIORITY_CHANGED',
  'CATEGORY_CHANGED',
  'FIRM_CHANGED',
  'MESSAGE',
  'CLIENT_REPLY',
  'NOTE',
  'ATTACHMENT',
  'ESCALATED',
  'SLA_WARNING',
  'SLA_BREACHED',
  'RESOLVED',
  'REOPENED',
  'CLOSED',
  'MERGED',
  'NOTIFICATION',
  'AUTOMATION',
]);
export type SupportActivityType = z.infer<typeof SupportActivityType>;

export const SupportTicketActivity = z.object({
  id: Id,
  type: SupportActivityType,
  at: DateTime,
  /** A person's name, or "System" for automation. */
  actor: z.string(),
  from: z.string().nullable(),
  to: z.string().nullable(),
  note: z.string().nullable(),
});
export type SupportTicketActivity = z.infer<typeof SupportTicketActivity>;

/** Ticket Detail: newest activity first; the conversation oldest first. */
export const SupportTicketDetail = SupportTicket.extend({
  description: z.string(),
  messages: z.array(SupportTicketMessage),
  /** Empty without the "View internal notes" permission. */
  notes: z.array(SupportTicketNote),
  attachments: z.array(SupportTicketAttachment),
  activity: z.array(SupportTicketActivity),
});
export type SupportTicketDetail = z.infer<typeof SupportTicketDetail>;

/** A list filter: none set = everything the member may see. */
export const SupportTicketsQuery = z.strictObject({
  tab: SupportTicketTab.optional(),
  search: SearchText.optional(),
  statuses: listOf(SupportTicketStatus),
  priorityIds: listOf(Id),
  categoryIds: listOf(Id),
  firmId: Id.optional(),
  /** A member's user id, or UNASSIGNED. */
  assigneeId: z.union([Id, z.literal('UNASSIGNED')]).optional(),
  source: SupportTicketSource.optional(),
  createdFrom: Day.optional(),
  createdTo: Day.optional(),
  activityFrom: Day.optional(),
  activityTo: Day.optional(),
  sla: SupportSlaState.optional(),
  escalated: z.enum(['YES', 'NO']).optional(),
  /** A summary card's set: Open Tickets (Open and In Progress), or Resolved (30 days). */
  set: z.enum(['OPEN', 'RESOLVED_30']).optional(),
  page: z.coerce.number().int().min(1).optional(),
  pageSize: z.coerce.number().int().min(1).max(100).optional(),
});
export type SupportTicketsQuery = z.input<typeof SupportTicketsQuery>;

/** Newest activity first; 10 a page by default. */
export const SupportTicketPage = z.object({
  items: z.array(SupportTicket),
  total: z.number().int(),
  page: z.number().int(),
  pageSize: z.number().int(),
});
export type SupportTicketPage = z.infer<typeof SupportTicketPage>;

const Trend = z.number().int().nullable();

/** The summary cards and the tab counts, over every ticket the member may see. */
export const SupportSummary = z.object({
  total: z.number().int(),
  /** Open and In Progress. */
  open: z.number().int(),
  /** Active and past the response target. */
  overdue: z.number().int(),
  waiting: z.number().int(),
  resolved30: z.number().int(),
  /** Percent change against 30 days before; null when there is nothing to compare with. */
  trends: z.object({
    total: Trend,
    open: Trend,
    overdue: Trend,
    waiting: Trend,
    resolved30: Trend,
  }),
  tabs: z.object({
    ALL: z.number().int(),
    UNASSIGNED: z.number().int(),
    MINE: z.number().int(),
    HIGH_PRIORITY: z.number().int(),
    OVERDUE: z.number().int(),
    WAITING: z.number().int(),
    ESCALATED: z.number().int(),
    CLOSED: z.number().int(),
  }),
});
export type SupportSummary = z.infer<typeof SupportSummary>;

// ---------- Files ----------

/**
 * Step 1 of a file: where to PUT it (an `UploadTicket`, under the firm's own prefix). Then give
 * `uploadToken` to the action that adds it (a new ticket, a reply, a note or Add Files); the API
 * checks the stored file there. A token is good for 15 minutes and for that firm only.
 */
export const CreateSupportUploadRequest = z.strictObject({
  /** The ticket's firm (the New Ticket form's firm). */
  firmId: Id,
  fileName: text(200),
  contentType: UploadContentType,
  sizeBytes: z.number().int().positive().max(SUPPORT_ATTACHMENT_LIMITS.maxBytes, 'Max size: 10 MB'),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
});
export type CreateSupportUploadRequest = z.input<typeof CreateSupportUploadRequest>;

const UploadTokens = z
  .array(z.string().min(1).max(8192))
  .max(SUPPORT_ATTACHMENT_LIMITS.maxFiles, 'Attach at most 10 files at a time');

/** A short-lived signed link (View / Download). */
export const SupportAttachmentLink = z.object({ url: z.string(), expiresAt: DateTime });
export type SupportAttachmentLink = z.infer<typeof SupportAttachmentLink>;

// ---------- Ticket changes ----------

const Version = z.number().int().min(1);
/** An agent's user id; QUEUE leaves it in the Support Team queue; AUTO lets round robin pick. */
export const SupportAssignTo = z.union([Id, z.literal('QUEUE'), z.literal('AUTO')], {
  error: 'Select a team member',
});
export type SupportAssignTo = z.infer<typeof SupportAssignTo>;
const LongText = (empty: string) => text(5000, 'many', empty);

export const CreateSupportTicketRequest = z.strictObject({
  /** One per form opening: a double click or a retry never makes two tickets. */
  requestId: Id,
  firmId: Id,
  contactId: Id,
  subject: text(150, 'one', 'Enter a subject.'),
  categoryId: Id,
  priorityId: Id,
  assignTo: SupportAssignTo,
  status: SupportNewTicketStatus,
  source: SupportTicketSource,
  description: LongText('Describe the issue.'),
  uploadTokens: UploadTokens.default([]),
  /** Optional; '' for none. */
  internalNote: z.string().trim().max(5000, 'This note is too long.').default(''),
  notifyAssignee: z.boolean().default(true),
});
export type CreateSupportTicketRequest = z.input<typeof CreateSupportTicketRequest>;

/** Status, priority or category from the header and the Ticket Information card. */
export const UpdateSupportTicketRequest = z
  .strictObject({
    version: Version,
    status: SupportTicketStatus.optional(),
    priorityId: Id.optional(),
    categoryId: Id.optional(),
  })
  .refine((b) => b.status || b.priorityId || b.categoryId, 'Change something first');
export type UpdateSupportTicketRequest = z.input<typeof UpdateSupportTicketRequest>;

export const AssignSupportTicketRequest = z.strictObject({
  version: Version,
  assignTo: SupportAssignTo,
  notify: z.boolean().default(true),
});
export type AssignSupportTicketRequest = z.input<typeof AssignSupportTicketRequest>;

export const EscalateSupportTicketRequest = z.strictObject({
  version: Version,
  reason: text(500, 'many', 'Give a reason for the escalation'),
});
export type EscalateSupportTicketRequest = z.input<typeof EscalateSupportTicketRequest>;

/** Merge `sourceId` into this ticket: the source closes and its thread shows here. */
export const MergeSupportTicketRequest = z.strictObject({ version: Version, sourceId: Id });
export type MergeSupportTicketRequest = z.input<typeof MergeSupportTicketRequest>;

/** A reply to the client, or an internal note (never shown to the client). */
export const ReplySupportTicketRequest = z.strictObject({
  mode: z.enum(['REPLY', 'NOTE']),
  body: LongText('Write a message first'),
  /** REPLY only: false keeps it in the conversation without delivering it. */
  sendToClient: z.boolean().default(true),
  uploadTokens: UploadTokens.default([]),
});
export type ReplySupportTicketRequest = z.input<typeof ReplySupportTicketRequest>;

export const AddSupportAttachmentsRequest = z.strictObject({
  uploadTokens: UploadTokens.min(1, 'Choose a file'),
});
export type AddSupportAttachmentsRequest = z.input<typeof AddSupportAttachmentsRequest>;

export const DeleteSupportTicketQuery = z.strictObject({ version: z.coerce.number().int().min(1) });
export type DeleteSupportTicketQuery = z.input<typeof DeleteSupportTicketQuery>;

export const SupportOk = z.object({ ok: z.literal(true) });
export type SupportOk = z.infer<typeof SupportOk>;

// ---------- Settings changes ----------

const Description = z.string().trim().max(200, 'Use at most 200 characters').default('');

export const SaveSupportCategoryRequest = z.strictObject({
  name: text(80, 'one', 'Enter a category name'),
  description: Description,
});
export type SaveSupportCategoryRequest = z.input<typeof SaveSupportCategoryRequest>;

export const SaveSupportPriorityRequest = z.strictObject({
  name: text(60, 'one', 'Enter a priority name'),
  description: Description,
  color: SupportPriorityColor,
  target: SupportTarget,
});
export type SaveSupportPriorityRequest = z.input<typeof SaveSupportPriorityRequest>;

export const SetSupportActiveRequest = z.strictObject({ active: z.boolean() });
export type SetSupportActiveRequest = z.input<typeof SetSupportActiveRequest>;

/** All seven days, at least one open, each closing after it opens. */
export const SaveSupportBusinessHoursRequest = z.strictObject({
  timeZone: SupportTimeZone,
  days: z.array(SupportDayHours).length(7, 'Set all seven days'),
  clock: SupportClock,
});
export type SaveSupportBusinessHoursRequest = z.input<typeof SaveSupportBusinessHoursRequest>;

export const AddSupportHolidayRequest = z.strictObject({
  date: Day,
  name: text(80, 'one', 'Enter a holiday name'),
});
export type AddSupportHolidayRequest = z.input<typeof AddSupportHolidayRequest>;

export const SaveSupportCannedResponseRequest = z.strictObject({
  title: text(80, 'one', 'Enter a title'),
  body: LongText('Write the message'),
  categoryId: Id.nullable().default(null),
});
export type SaveSupportCannedResponseRequest = z.input<typeof SaveSupportCannedResponseRequest>;

// ---------- Errors ----------

export const SupportErrorCode = z.enum([
  'NOT_FOUND',
  'CONFLICT',
  'FORBIDDEN',
  'DUPLICATE_NAME',
  'AGENT_INACTIVE',
  'CONTACT_NOT_IN_FIRM',
  'INACTIVE_CHOICE',
  'TICKET_CLOSED',
  'ALREADY_MERGED',
  'LAST_ACTIVE_PRIORITY',
  'OWNER_KEEPS_SETTINGS',
  'NO_SUPPORT_LEAD',
  'NOT_SUPPORTED_YET',
  'UPLOAD_EXPIRED',
  'UPLOAD_MISMATCH',
  'FILE_HAS_MACROS',
  'FILE_PASSWORD_PROTECTED',
  'SCAN_PENDING',
  'FILE_BLOCKED',
]);
export type SupportErrorCode = z.infer<typeof SupportErrorCode>;

/** Messages for `errorMessage(error, SUPPORT_ERRORS)`. */
export const SUPPORT_ERRORS: Readonly<Record<SupportErrorCode, string>> = {
  NOT_FOUND: 'This ticket or item is no longer available. Refresh to see the latest.',
  CONFLICT: 'Someone changed this ticket since you opened it. Refresh and try again.',
  FORBIDDEN: 'Your support role does not allow this.',
  DUPLICATE_NAME: 'That name is already in use.',
  AGENT_INACTIVE: 'This team member cannot take new tickets.',
  CONTACT_NOT_IN_FIRM: 'Select a contact from this firm.',
  INACTIVE_CHOICE: 'That category or priority is no longer active. Choose another.',
  TICKET_CLOSED: 'Reopen the ticket first.',
  ALREADY_MERGED: 'That ticket was already merged.',
  LAST_ACTIVE_PRIORITY: 'Keep at least one active priority.',
  OWNER_KEEPS_SETTINGS: 'The Owner must keep the right to edit settings.',
  NO_SUPPORT_LEAD: 'There is no active Support Lead to notify. Notify the admins instead.',
  NOT_SUPPORTED_YET: 'This option cannot be saved yet.',
  UPLOAD_EXPIRED: 'The upload took too long. Attach the file again.',
  UPLOAD_MISMATCH: 'The file did not upload correctly. Attach it again.',
  FILE_HAS_MACROS: 'Files with macros cannot be attached.',
  FILE_PASSWORD_PROTECTED: 'Password-protected files cannot be attached.',
  SCAN_PENDING: 'The file is still being checked for viruses. Try again in a minute.',
  FILE_BLOCKED: 'This file was blocked by the virus check.',
};
