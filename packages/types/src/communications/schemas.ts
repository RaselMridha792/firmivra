import { z } from 'zod';
import { CalendarDate, MemberRef } from '../clients/schemas.js';
import { clearable, SearchText, text } from '../clients/text.js';
import {
  CommunicationChannel,
  CommunicationEventType,
  CommunicationRecipientStatus,
  CommunicationSourceKind,
  CommunicationStatus,
  ConsentStatus,
  SegmentAudience,
  SegmentType,
} from '../db-enums.js';

// Communications (R55 contract, for the Communications screens): the overview and its tabs
// (Overview, Messages, Bulk Campaigns, Announcements, Segments & Lists, Templates, Scheduled, Sent
// History), the New Communication menu, the channel-aware Composer (Email, Text Message,
// Announcement) with autosave, preview, test send and scheduling, Choose Recipients & Segments,
// Review & Send, Communication Details & Results, the segment builder and consent. Designs:
// docs/mockups/firm-workspace/communications/source/ and its developer guide.
//
// One workflow for three channels: the composer shows only what a channel needs. Templates are
// the Templates module's (`api.templates`, kinds EMAIL, SMS and ANNOUNCEMENT-capable): "Use a
// Template" copies a SNAPSHOT into a new draft and never changes the master; the draft keeps the
// template id and version for the audit. Providers and sender identities come from Integrations;
// a disconnected or expired provider blocks a production send and says where to fix it. A send
// moves the campaign out of editing: its content, sender and audience become an immutable
// snapshot; Resend Failed, Duplicate and Follow-Up always make a NEW draft and never change the
// original. Recipient eligibility (consent and suppression, invalid or missing addresses,
// duplicates, company boundaries) is recalculated on the server immediately before every send, and
// an automatic exclusion cannot be overridden. Sending runs in the background and is idempotent
// (`idempotencyKey`): a double click, a retry or a repeated request never sends twice. A test send
// is never a recipient and never counts in results. Messages between staff and one client live in
// the Messages module (`api.messages`), not here. Firm routes under /api/v1/business
// (`@Access('COMMUNICATIONS')`): everyone with the grid's view reads; creating, editing, sending,
// scheduling, cancelling, exporting, resending, segments and consent need Create, Edit or Manage
// (403 FORBIDDEN); Owner and Admin may always; Staff see their own and shared campaigns and only
// clients assigned to them. Responses are plain objects; requests are strict. Audited with ids,
// statuses and field names only, never content, addresses or numbers.

const DateTime = z.iso.datetime({ offset: true });
const Page = { total: z.number().int(), page: z.number().int(), pageSize: z.number().int() };
const Etag = z.string().min(1).max(100);

export const CommunicationId = z.uuid();
export const CommunicationSegmentId = z.uuid();
export const CommunicationAttachmentId = z.uuid();
export const CommunicationSenderId = z.uuid();

const ClientRef = z.object({ id: z.uuid(), name: z.string() });

// ---------- Readiness and senders ----------

/** Where to send a person who cannot use a channel yet. */
export const ChannelBlockRoute = z.enum([
  'INTEGRATIONS',
  'PERMISSIONS',
  'CLIENT_PORTAL',
  'SETTINGS',
]);
export type ChannelBlockRoute = z.infer<typeof ChannelBlockRoute>;

/** Whether the caller can start a communication on a channel now, and if not, why and where to fix it. */
export const ChannelReadiness = z.object({
  channel: CommunicationChannel,
  ready: z.boolean(),
  /** Plain words ("Connect an SMS provider to send text messages"). */
  reason: z.string().nullable(),
  route: ChannelBlockRoute.nullable(),
  /** Verified sender identities the caller may use. */
  senderCount: z.number().int(),
});
export type ChannelReadiness = z.infer<typeof ChannelReadiness>;

/** A verified sender identity (a from address or number) from Integrations. Never a secret. */
export const CommunicationSender = z.object({
  id: CommunicationSenderId,
  channel: CommunicationChannel,
  /** "Firm Name <hello@firm.example>" or "+1 (555) ***-1234". */
  label: z.string(),
  verified: z.boolean(),
  isDefault: z.boolean(),
  /** The provider connection it goes out through, and whether it is healthy. */
  provider: z.string(),
  providerHealthy: z.boolean(),
});
export type CommunicationSender = z.infer<typeof CommunicationSender>;
export const CommunicationSenderList = z.object({ items: z.array(CommunicationSender) });
export type CommunicationSenderList = z.infer<typeof CommunicationSenderList>;

// ---------- Overview and lists ----------

/** A row of any campaign list: opens the Composer (draft), the editable detail (scheduled) or the Results (sent). */
export const CommunicationRow = z.object({
  id: CommunicationId,
  channel: CommunicationChannel,
  name: z.string(),
  subject: z.string().nullable(),
  status: CommunicationStatus,
  /** Where a click goes. */
  opens: z.enum(['COMPOSER', 'SCHEDULED_DETAIL', 'RESULTS']),
  audienceSummary: z.string().nullable(),
  finalCount: z.number().int().nullable(),
  scheduledFor: DateTime.nullable(),
  sentAt: DateTime.nullable(),
  createdBy: MemberRef,
  /** Results summary for a sent campaign. */
  deliveredCount: z.number().int().nullable(),
  failedCount: z.number().int().nullable(),
  openRatePercent: z.number().nullable(),
  /** An announcement's publish window and portal visibility. */
  publishStartsAt: DateTime.nullable(),
  publishEndsAt: DateTime.nullable(),
  /** The source of a duplicate, resend or follow-up. */
  sourceId: CommunicationId.nullable(),
  sourceKind: CommunicationSourceKind.nullable(),
  archived: z.boolean(),
  updatedAt: DateTime,
});
export type CommunicationRow = z.infer<typeof CommunicationRow>;

export const CommunicationKpis = z.object({
  drafts: z.number().int(),
  scheduled: z.number().int(),
  sending: z.number().int(),
  /** In the last 30 days. */
  sent: z.number().int(),
  recipientsReached: z.number().int(),
  deliveryRatePercent: z.number().nullable(),
  /** Opens are directional: not every provider reports them, and some clients block them. */
  openRatePercent: z.number().nullable(),
  clickRatePercent: z.number().nullable(),
  failed: z.number().int(),
});
export type CommunicationKpis = z.infer<typeof CommunicationKpis>;

/** GET /business/communications/overview: Frame 1 (the metric cards, recent, scheduled, quick actions). */
export const CommunicationsOverview = z.object({
  kpis: CommunicationKpis,
  channels: z.array(ChannelReadiness),
  recent: z.array(CommunicationRow).max(5),
  scheduled: z.array(CommunicationRow).max(5),
  /** Active communication templates the caller may use (Email, SMS, announcement). */
  templates: z
    .array(
      z.object({
        id: z.uuid(),
        name: z.string(),
        kind: z.string(),
        category: z.string().nullable(),
      }),
    )
    .max(5),
  segments: z.object({ total: z.number().int(), totalMembers: z.number().int() }),
  canCreate: z.boolean(),
  canSend: z.boolean(),
  canExport: z.boolean(),
  canManageSegments: z.boolean(),
});
export type CommunicationsOverview = z.infer<typeof CommunicationsOverview>;

export const CommunicationTab = z.enum([
  'campaigns',
  'announcements',
  'scheduled',
  'sent',
  'drafts',
]);
export type CommunicationTab = z.infer<typeof CommunicationTab>;

/**
 * GET /business/communications: the lists behind the tabs. `scheduled` is ordered by send time,
 * `sent` is SENT, FAILED and CANCELLED with delivery summaries, `drafts` is the caller's own
 * editable drafts (newest first, for Resume Draft), `announcements` is the ANNOUNCEMENT channel.
 * `archived` lists archived ones instead.
 */
export const CommunicationsQuery = z.strictObject({
  tab: CommunicationTab.optional().default('campaigns'),
  channel: CommunicationChannel.optional(),
  status: CommunicationStatus.optional(),
  from: CalendarDate.optional(),
  to: CalendarDate.optional(),
  createdByUserId: z.uuid().optional(),
  search: SearchText.optional(),
  archived: z.union([z.boolean(), z.stringbool()]).optional(),
  sort: z
    .enum(['newest', 'oldest', 'scheduled', 'name', 'performance'])
    .optional()
    .default('newest'),
  page: z.coerce.number().int().min(1).optional().default(1),
  pageSize: z.coerce.number().int().min(1).max(100).optional().default(25),
});
export type CommunicationsQuery = z.input<typeof CommunicationsQuery>;
export const CommunicationPage = z.object({ items: z.array(CommunicationRow).max(100), ...Page });
export type CommunicationPage = z.infer<typeof CommunicationPage>;

// ---------- The composer ----------

export const CommunicationAttachment = z.object({
  id: CommunicationAttachmentId,
  fileName: z.string(),
  contentType: z.string(),
  sizeBytes: z.number().int(),
});
export type CommunicationAttachment = z.infer<typeof CommunicationAttachment>;

/** Whom a campaign goes to: segments, people and people left out, as the sender chose them. */
export const AudienceChip = z.object({
  kind: z.enum(['SEGMENT', 'CLIENT', 'LEAD', 'EXCLUDE_CLIENT', 'EXCLUDE_LEAD']),
  id: z.uuid(),
  label: z.string(),
  /** A segment's current count (recalculated by the server). */
  count: z.number().int().nullable(),
});
export type AudienceChip = z.infer<typeof AudienceChip>;

/** Selected, automatically excluded (cannot be overridden), manually excluded, and the final eligible count. */
export const AudienceSummary = z.object({
  selectedCount: z.number().int(),
  autoExcluded: z.object({
    unsubscribed: z.number().int(),
    invalid: z.number().int(),
    missingChannel: z.number().int(),
    duplicate: z.number().int(),
    ineligible: z.number().int(),
  }),
  manualExcludedCount: z.number().int(),
  finalCount: z.number().int(),
  chips: z.array(AudienceChip),
  /** When the count was calculated: it is recalculated again right before sending. */
  calculatedAt: DateTime,
});
export type AudienceSummary = z.infer<typeof AudienceSummary>;

/** The composer's content and settings: a draft, or the frozen snapshot of a sent campaign. */
export const CommunicationDetail = CommunicationRow.extend({
  /** Email only; announcements use `subject` as their title. */
  previewText: z.string().nullable(),
  body: z.string(),
  sender: CommunicationSender.nullable(),
  replyTo: z.string().nullable(),
  template: z
    .object({ id: z.uuid(), name: z.string(), version: z.number().int().nullable() })
    .nullable(),
  attachments: z.array(CommunicationAttachment),
  /** Merge fields used, and which no field provides. */
  mergeFields: z.object({ used: z.array(z.string()), unknown: z.array(z.string()) }),
  /** SMS: its length and parts. */
  sms: z.object({ characters: z.number().int(), parts: z.number().int() }).nullable(),
  audience: AudienceSummary.nullable(),
  timezone: z.string(),
  visibility: z.string().nullable(),
  startedAt: DateTime.nullable(),
  cancelledAt: DateTime.nullable(),
  /** Editable: DRAFT, or SCHEDULED before its lock time. A sent one is a snapshot. */
  editable: z.boolean(),
  /** A scheduled send locks at this time (a few minutes before it goes out). */
  lockedAt: DateTime.nullable(),
  /** The last autosave, for the status line. */
  savedAt: DateTime,
  canSend: z.boolean(),
  createdAt: DateTime,
  /** Send it back on every save: 409 SAVE_CONFLICT when another tab or person saved after it was loaded. */
  etag: z.string(),
});
export type CommunicationDetail = z.infer<typeof CommunicationDetail>;

/**
 * POST /business/communications: starts a DRAFT (the New Communication menu). `templateId` copies
 * that template's snapshot (its kind must fit the channel: 409 TEMPLATE_NOT_ALLOWED). Opening the
 * menu alone creates nothing. 409 CHANNEL_UNAVAILABLE when the channel is not ready for the caller.
 */
export const CreateCommunicationRequest = z.strictObject({
  channel: CommunicationChannel,
  name: clearable(text(200)),
  templateId: z.uuid().optional(),
});
export type CreateCommunicationRequest = z.input<typeof CreateCommunicationRequest>;

/**
 * PATCH .../communications/{id} (autosave and Save Draft): the fields sent change; only a draft or
 * a scheduled campaign before its lock time. `etag` guards a concurrent save. Changing `channel`
 * with content the new channel cannot hold (a subject on an SMS, rich text, attachments) needs
 * `confirmStripContent: true` (409 CONTENT_WOULD_BE_LOST otherwise). Email fields on another
 * channel are refused (400). `senderId` must be a verified sender of the channel.
 */
export const UpdateCommunicationRequest = z
  .strictObject({
    channel: CommunicationChannel.optional(),
    confirmStripContent: z.boolean().optional(),
    name: text(200).optional(),
    senderId: CommunicationSenderId.nullable().optional(),
    replyTo: clearable(z.email().max(254)),
    subject: clearable(text(300)),
    previewText: clearable(text(200)),
    body: z.string().max(100_000).optional(),
    /** Announcements: when the portal shows it, until when, and where. */
    publishStartsAt: DateTime.nullable().optional(),
    publishEndsAt: DateTime.nullable().optional(),
    visibility: clearable(text(60)),
    etag: Etag,
  })
  .refine(
    (o) => Object.keys(o).filter((k) => k !== 'etag' && k !== 'confirmStripContent').length > 0,
    'Change at least one field',
  );
export type UpdateCommunicationRequest = z.input<typeof UpdateCommunicationRequest>;

/** POST .../{id}/use-template: loads a template's snapshot into this draft (never changes the master). */
export const UseTemplateRequest = z.strictObject({ templateId: z.uuid(), etag: Etag });
export type UseTemplateRequest = z.input<typeof UseTemplateRequest>;

/** POST .../{id}/save-as-template: makes a NEW template from the content (never changes an existing one). */
export const SaveAsTemplateRequest = z.strictObject({
  name: text(200),
  categoryId: z.uuid().nullable().optional(),
});
export type SaveAsTemplateRequest = z.input<typeof SaveAsTemplateRequest>;

/** POST .../{id}/preview: the message rendered with sample data, or one client's (nothing is sent or recorded). */
export const PreviewCommunicationRequest = z.strictObject({
  clientId: z.uuid().optional(),
  leadId: z.uuid().optional(),
});
export type PreviewCommunicationRequest = z.input<typeof PreviewCommunicationRequest>;

/**
 * POST .../{id}/test-send: a non-production test to the caller's own address or number (the
 * caller's email for EMAIL, a number they own for SMS; 400 TEST_SEND_REFUSED for another). It is
 * marked as a test, is never a recipient, and never counts in results or client history.
 */
export const TestSendCommunicationRequest = z.strictObject({
  toEmail: z.email().max(254).optional(),
  toPhone: z
    .string()
    .regex(/^\+[1-9]\d{6,14}$/, 'Use the international format, +15551234567')
    .optional(),
});
export type TestSendCommunicationRequest = z.input<typeof TestSendCommunicationRequest>;

/** Announcement locations the portal offers (data from the firm's portal settings). */
/**
 * POST .../{id}/attachments/uploads: the same facts and limits as a template attachment (PDF, JPG,
 * PNG, Word or Excel, up to 10 MB, with the SHA-256); the answer is the documents' UploadTicket and
 * the file is confirmed with `POST .../attachments/uploads/confirm`. Email and announcements only.
 */
export { StartTemplateAttachmentRequest as StartCommunicationAttachmentRequest } from '../templates/schemas.js';

export const AnnouncementLocationList = z.object({
  items: z.array(z.object({ key: z.string(), label: z.string() })),
});
export type AnnouncementLocationList = z.infer<typeof AnnouncementLocationList>;

// ---------- Recipients ----------

export const AudienceView = z.enum([
  'CONTACTS',
  'SEGMENTS',
  'SERVICES',
  'STATUSES',
  'LEADS',
  'LISTS',
]);
export type AudienceView = z.infer<typeof AudienceView>;

/**
 * GET /business/communications/audience/candidates (Choose Recipients): what the active filter
 * shows, for the channel of the draft in `communicationId`. Searches only the firm's contacts the
 * caller may see. Changing the view never clears a selection (the screen keeps it).
 */
export const AudienceCandidatesQuery = z.strictObject({
  communicationId: CommunicationId,
  view: AudienceView.optional().default('CONTACTS'),
  search: SearchText.optional(),
  serviceId: z.uuid().optional(),
  status: z.string().max(60).optional(),
  page: z.coerce.number().int().min(1).optional().default(1),
  pageSize: z.coerce.number().int().min(1).max(100).optional().default(25),
});
export type AudienceCandidatesQuery = z.input<typeof AudienceCandidatesQuery>;

/** A segment, list, service group, status group, or one person; with only the useful contact status, masked. */
export const AudienceCandidate = z.object({
  kind: z.enum(['SEGMENT', 'CLIENT', 'LEAD']),
  id: z.uuid(),
  label: z.string(),
  /** A masked address or number, or a group's description. */
  secondary: z.string().nullable(),
  /** A group's current member count (recalculated now). */
  count: z.number().int().nullable(),
  /** Automatically ineligible for this channel (suppressed, invalid or missing address): cannot be selected. */
  eligible: z.boolean(),
  ineligibleReason: z.enum(['UNSUBSCRIBED', 'INVALID', 'MISSING_CHANNEL', 'NO_CONSENT']).nullable(),
});
export type AudienceCandidate = z.infer<typeof AudienceCandidate>;
export const AudienceCandidatePage = z.object({
  items: z.array(AudienceCandidate).max(100),
  ...Page,
});
export type AudienceCandidatePage = z.infer<typeof AudienceCandidatePage>;

/**
 * POST .../audience/select-all: the ids of every ELIGIBLE record in the current filtered scope (an
 * ineligible one is never included), at most 1,000; `truncated` says there are more: save a
 * segment or list instead (the screen offers it).
 */
export const SelectAllAudienceRequest = AudienceCandidatesQuery.omit({
  page: true,
  pageSize: true,
});
export type SelectAllAudienceRequest = z.input<typeof SelectAllAudienceRequest>;
export const SelectAllAudienceResult = z.object({
  clientIds: z.array(z.uuid()),
  leadIds: z.array(z.uuid()),
  segmentIds: z.array(z.uuid()),
  truncated: z.boolean(),
});
export type SelectAllAudienceResult = z.infer<typeof SelectAllAudienceResult>;

/**
 * PUT .../communications/{id}/audience (Apply / Done): replaces the audience: segments, individuals
 * and people left out by hand. A person in two places counts once. The answer is the recalculated
 * summary. Only a draft or a scheduled campaign before its lock time.
 */
export const SetAudienceRequest = z.strictObject({
  segmentIds: z.array(CommunicationSegmentId).max(100).optional().default([]),
  clientIds: z.array(z.uuid()).max(5_000).optional().default([]),
  leadIds: z.array(z.uuid()).max(5_000).optional().default([]),
  excludeClientIds: z.array(z.uuid()).max(5_000).optional().default([]),
  excludeLeadIds: z.array(z.uuid()).max(5_000).optional().default([]),
  etag: Etag,
});
export type SetAudienceRequest = z.input<typeof SetAudienceRequest>;

// ---------- Review and send ----------

export const SendCheck = z.object({
  code: z.enum([
    'CHANNEL_UNAVAILABLE',
    'PROVIDER_UNHEALTHY',
    'SENDER_NOT_VERIFIED',
    'NO_RECIPIENTS',
    'MISSING_SUBJECT',
    'EMPTY_BODY',
    'UNRESOLVED_FIELDS',
    'UNKNOWN_FIELDS',
    'SCHEDULE_IN_PAST',
    'CONSENT_CHECKED',
    'AUDIENCE_CHANGED',
    'ATTACHMENT_NOT_READY',
    'ANNOUNCEMENT_WINDOW_INVALID',
    'PORTAL_DISABLED',
  ]),
  severity: z.enum(['BLOCK', 'WARN', 'OK']),
  message: z.string(),
});
export type SendCheck = z.infer<typeof SendCheck>;

/** GET .../{id}/review: everything the Review & Send step shows, revalidated now. */
export const CommunicationReview = z.object({
  channel: CommunicationChannel,
  audience: AudienceSummary,
  sender: CommunicationSender.nullable(),
  subject: z.string().nullable(),
  /** The message as the first recipient would get it (sample data when none). */
  preview: z.object({
    subject: z.string().nullable(),
    body: z.string(),
    unresolved: z.array(z.string()),
  }),
  timing: z.object({
    mode: z.enum(['NOW', 'SCHEDULED']),
    scheduledFor: DateTime.nullable(),
    timezone: z.string(),
  }),
  integration: z.object({
    provider: z.string().nullable(),
    healthy: z.boolean(),
    route: ChannelBlockRoute.nullable(),
  }),
  checks: z.array(SendCheck),
  /** No check blocks sending. */
  canSend: z.boolean(),
});
export type CommunicationReview = z.infer<typeof CommunicationReview>;

/**
 * POST .../{id}/send (Send Now) and POST .../{id}/schedule (Schedule for Later): the explicit
 * confirmation. `idempotencyKey` (made by the screen once per attempt) makes a double click or a
 * retry a no-op that answers the same campaign. The server revalidates the sender, the provider,
 * the content and the audience and recalculates the final count; the sent snapshot keeps it. 409
 * NOT_READY with the checks, AUDIENCE_CHANGED when the final count moved (confirm the new count
 * with `expectedFinalCount`), CHANNEL_UNAVAILABLE. An announcement's send publishes it at its
 * publish start.
 */
export const SendCommunicationRequest = z.strictObject({
  idempotencyKey: z.uuid(),
  expectedFinalCount: z.number().int().min(0).optional(),
  etag: Etag,
});
export type SendCommunicationRequest = z.input<typeof SendCommunicationRequest>;
export const ScheduleCommunicationRequest = z.strictObject({
  idempotencyKey: z.uuid(),
  /** A future instant; the screen picks date and time in the firm's time zone (shown with the zone). */
  scheduledFor: DateTime,
  expectedFinalCount: z.number().int().min(0).optional(),
  etag: Etag,
});
export type ScheduleCommunicationRequest = z.input<typeof ScheduleCommunicationRequest>;

/** POST .../{id}/reschedule (a scheduled campaign before its lock time): 409 LOCKED after it. */
export const RescheduleCommunicationRequest = z.strictObject({
  scheduledFor: DateTime,
  etag: Etag,
});
export type RescheduleCommunicationRequest = z.input<typeof RescheduleCommunicationRequest>;

/** POST .../{id}/cancel (scheduled, or sending: what is not yet sent stops; what went out stays). */
export const CancelCommunicationRequest = z.strictObject({ reason: clearable(text(500, 'many')) });
export type CancelCommunicationRequest = z.input<typeof CancelCommunicationRequest>;

// ---------- Results ----------

export const ResultMetric = z.object({
  count: z.number().int(),
  /** Of the total recipients; null when the provider does not report it. */
  ratePercent: z.number().nullable(),
});
export type ResultMetric = z.infer<typeof ResultMetric>;

/**
 * GET .../{id}/results: Communication Details & Results. Metrics come from normalized provider
 * events: Total Recipients (accepted for production processing), Delivered (the provider confirmed
 * it), Opened and Clicked (directional, where the provider supports them), Failed (hard failure
 * after provider processing), Pending (accepted, no final event yet) and Unsubscribed.
 */
export const CommunicationResults = z.object({
  communication: CommunicationDetail,
  metrics: z.object({
    totalRecipients: z.number().int(),
    delivered: ResultMetric,
    opened: ResultMetric,
    clicked: ResultMetric,
    failed: ResultMetric,
    pending: ResultMetric,
    unsubscribed: ResultMetric,
  }),
  /** The provider reports opens and clicks for this channel (false: the cards say so). */
  supports: z.object({ opens: z.boolean(), clicks: z.boolean() }),
  funnel: z.array(
    z.object({
      stage: z.enum(['SENT', 'DELIVERED', 'OPENED', 'CLICKED']),
      count: z.number().int(),
    }),
  ),
  /** Engagement by day in the firm's time zone. */
  trend: z.array(
    z.object({
      date: CalendarDate,
      delivered: z.number().int(),
      opened: z.number().int(),
      clicked: z.number().int(),
    }),
  ),
  /** Reasons recipients were not sent to or failed, with counts. */
  failureReasons: z.array(
    z.object({ code: z.string(), label: z.string(), count: z.number().int() }),
  ),
  canExport: z.boolean(),
  canResendFailed: z.boolean(),
});
export type CommunicationResults = z.infer<typeof CommunicationResults>;

export const CommunicationRecipient = z.object({
  id: z.uuid(),
  client: ClientRef.nullable(),
  leadId: z.uuid().nullable(),
  leadName: z.string().nullable(),
  /** Masked: "j***@example.com" or "***-***-1234". */
  addressMask: z.string(),
  status: CommunicationRecipientStatus,
  failureCode: z.string().nullable(),
  failureLabel: z.string().nullable(),
  sentAt: DateTime.nullable(),
  deliveredAt: DateTime.nullable(),
  openCount: z.number().int(),
  clickCount: z.number().int(),
  unsubscribedAt: DateTime.nullable(),
});
export type CommunicationRecipient = z.infer<typeof CommunicationRecipient>;

export const CommunicationRecipientsQuery = z.strictObject({
  status: CommunicationRecipientStatus.optional(),
  engagement: z.enum(['opened', 'not_opened', 'clicked', 'not_clicked']).optional(),
  search: SearchText.optional(),
  page: z.coerce.number().int().min(1).optional().default(1),
  pageSize: z.coerce.number().int().min(1).max(100).optional().default(25),
});
export type CommunicationRecipientsQuery = z.input<typeof CommunicationRecipientsQuery>;
export const CommunicationRecipientPage = z.object({
  items: z.array(CommunicationRecipient).max(100),
  ...Page,
});
export type CommunicationRecipientPage = z.infer<typeof CommunicationRecipientPage>;

export const CommunicationActivity = z.object({
  id: z.uuid(),
  type: CommunicationEventType,
  /** A readable line ("Delivered to 142 recipients"), from the normalized event; never content. */
  message: z.string(),
  detailCode: z.string().nullable(),
  occurredAt: DateTime,
  /** A system step (queued, started, paused) or a provider event. */
  source: z.enum(['SYSTEM', 'PROVIDER', 'STAFF']),
});
export type CommunicationActivity = z.infer<typeof CommunicationActivity>;
export const CommunicationActivityQuery = z.strictObject({
  type: CommunicationEventType.optional(),
  page: z.coerce.number().int().min(1).optional().default(1),
  pageSize: z.coerce.number().int().min(1).max(100).optional().default(50),
});
export type CommunicationActivityQuery = z.input<typeof CommunicationActivityQuery>;
export const CommunicationActivityPage = z.object({
  items: z.array(CommunicationActivity).max(100),
  ...Page,
});
export type CommunicationActivityPage = z.infer<typeof CommunicationActivityPage>;

/**
 * POST .../{id}/export (Export Results): CSV of the recipients and their status, masked addresses
 * only, with the filters of the recipients tab. Needs the Export capability (403) and is audited.
 */
export const ExportCommunicationRequest = z.strictObject({
  filter: CommunicationRecipientsQuery.omit({ page: true, pageSize: true }).optional(),
});
export type ExportCommunicationRequest = z.input<typeof ExportCommunicationRequest>;
export const CommunicationExport = z.object({
  url: z.string(),
  expiresAt: DateTime,
  fileName: z.string(),
  rowCount: z.number().int(),
});
export type CommunicationExport = z.infer<typeof CommunicationExport>;

/**
 * POST .../{id}/follow-up: a NEW draft aimed at people from a result group of this campaign
 * (those who opened, did not open, clicked, did not click, or failed), re-checked for consent and
 * eligibility. POST .../{id}/resend-failed: a NEW draft for the eligible FAILED recipients.
 * POST .../{id}/duplicate: a NEW draft from the snapshot. The original never changes.
 */
export const FollowUpRequest = z.strictObject({
  group: z.enum(['OPENED', 'NOT_OPENED', 'CLICKED', 'NOT_CLICKED', 'FAILED']),
});
export type FollowUpRequest = z.input<typeof FollowUpRequest>;

// ---------- Segments and lists ----------

export const SegmentField = z.object({
  field: z.string().regex(/^[a-z][a-zA-Z0-9_.]{0,79}$/),
  label: z.string(),
  type: z.enum(['TEXT', 'NUMBER', 'DATE', 'STATUS', 'LIST', 'BOOLEAN']),
  audience: SegmentAudience,
  options: z.array(z.object({ value: z.string(), label: z.string() })),
  operators: z.array(
    z.enum([
      'IS',
      'IS_NOT',
      'IS_ANY_OF',
      'IS_NONE_OF',
      'CONTAINS',
      'BEFORE',
      'AFTER',
      'BETWEEN',
      'GREATER_THAN',
      'LESS_THAN',
      'EXISTS',
      'NOT_EXISTS',
    ]),
  ),
});
export type SegmentField = z.infer<typeof SegmentField>;
/** GET .../segments/fields: the criteria fields the caller may use (status, service, tags, state, appointments, invoices, tax year, last contact, custom fields). */
export const SegmentFieldList = z.object({ items: z.array(SegmentField) });
export type SegmentFieldList = z.infer<typeof SegmentFieldList>;

const SegmentCondition = z.strictObject({
  field: z.string().regex(/^[a-z][a-zA-Z0-9_.]{0,79}$/),
  op: z.enum([
    'IS',
    'IS_NOT',
    'IS_ANY_OF',
    'IS_NONE_OF',
    'CONTAINS',
    'BEFORE',
    'AFTER',
    'BETWEEN',
    'GREATER_THAN',
    'LESS_THAN',
    'EXISTS',
    'NOT_EXISTS',
  ]),
  value: z
    .union([
      z.string().max(200),
      z.number(),
      z.boolean(),
      z.array(z.string().max(200)).max(100),
      z.strictObject({
        from: z.union([z.string().max(40), z.number()]),
        to: z.union([z.string().max(40), z.number()]),
      }),
    ])
    .optional(),
});

/** AND or OR of conditions, with up to 5 inner groups of their own logic (one level). */
export const SegmentCriteria = z.strictObject({
  logic: z.enum(['AND', 'OR']).optional().default('AND'),
  conditions: z.array(SegmentCondition).max(20).optional().default([]),
  groups: z
    .array(
      z.strictObject({
        logic: z.enum(['AND', 'OR']),
        conditions: z.array(SegmentCondition).min(1).max(20),
      }),
    )
    .max(5)
    .optional()
    .default([]),
});
export type SegmentCriteria = z.input<typeof SegmentCriteria>;

export const SegmentRow = z.object({
  id: CommunicationSegmentId,
  name: z.string(),
  description: z.string().nullable(),
  type: SegmentType,
  audience: SegmentAudience,
  /** "Active clients in GA with a tax return in progress". */
  criteriaSummary: z.string().nullable(),
  memberCount: z.number().int(),
  lastRefreshedAt: DateTime.nullable(),
  /** Scheduled communications that use it (it cannot be removed while they do). */
  usedBy: z.number().int(),
  owner: MemberRef,
  archived: z.boolean(),
  updatedAt: DateTime,
});
export type SegmentRow = z.infer<typeof SegmentRow>;
export const SegmentDetail = SegmentRow.extend({
  criteria: SegmentCriteria.nullable(),
  etag: z.string(),
});
export type SegmentDetail = z.infer<typeof SegmentDetail>;

export const SegmentsQuery = z.strictObject({
  type: SegmentType.optional(),
  audience: SegmentAudience.optional(),
  search: SearchText.optional(),
  archived: z.union([z.boolean(), z.stringbool()]).optional(),
  page: z.coerce.number().int().min(1).optional().default(1),
  pageSize: z.coerce.number().int().min(1).max(100).optional().default(25),
});
export type SegmentsQuery = z.input<typeof SegmentsQuery>;
export const SegmentPage = z.object({ items: z.array(SegmentRow).max(100), ...Page });
export type SegmentPage = z.infer<typeof SegmentPage>;

/**
 * POST .../segments: a DYNAMIC segment (`criteria`, counted each time) or a STATIC list (saved
 * `clientIds` and `leadIds`). The criteria fields must be ones the catalog offers for the audience
 * (400 INVALID_CRITERIA). Names are unique among live segments ignoring case (409 DUPLICATE_NAME).
 */
export const CreateSegmentRequest = z
  .strictObject({
    name: text(200),
    description: clearable(text(1_000, 'many')),
    type: SegmentType,
    audience: SegmentAudience.optional().default('CLIENTS'),
    criteria: SegmentCriteria.optional(),
    clientIds: z.array(z.uuid()).max(5_000).optional().default([]),
    leadIds: z.array(z.uuid()).max(5_000).optional().default([]),
  })
  .refine(
    (s) => s.type !== 'DYNAMIC' || s.criteria !== undefined,
    'A dynamic segment needs its criteria',
  )
  .refine(
    (s) => s.type !== 'STATIC' || s.criteria === undefined,
    'A list has members, not criteria',
  );
export type CreateSegmentRequest = z.input<typeof CreateSegmentRequest>;
export const UpdateSegmentRequest = z
  .strictObject({
    name: text(200).optional(),
    description: clearable(text(1_000, 'many')),
    audience: SegmentAudience.optional(),
    criteria: SegmentCriteria.optional(),
    etag: Etag,
  })
  .refine(
    (o) => Object.keys(o).filter((k) => k !== 'etag').length > 0,
    'Change at least one field',
  );
export type UpdateSegmentRequest = z.input<typeof UpdateSegmentRequest>;

/** POST .../segments/preview: the live matching count and a sample for criteria not saved yet; nothing is saved. */
export const PreviewSegmentRequest = z.strictObject({
  audience: SegmentAudience.optional().default('CLIENTS'),
  criteria: SegmentCriteria,
  channel: CommunicationChannel.optional(),
  sample: z.number().int().min(0).max(25).optional().default(10),
});
export type PreviewSegmentRequest = z.input<typeof PreviewSegmentRequest>;
export const SegmentPreview = z.object({
  count: z.number().int(),
  /** Of those, how many could receive the channel (not suppressed, with an address). */
  eligibleCount: z.number().int().nullable(),
  sample: z.array(
    z.object({
      kind: z.enum(['CLIENT', 'LEAD']),
      id: z.uuid(),
      label: z.string(),
      secondary: z.string().nullable(),
    }),
  ),
  criteriaSummary: z.string(),
  calculatedAt: DateTime,
});
export type SegmentPreview = z.infer<typeof SegmentPreview>;

/** GET .../segments/{id}/members (Preview Members): the current members, masked. */
export const SegmentMembersQuery = z.strictObject({
  search: SearchText.optional(),
  page: z.coerce.number().int().min(1).optional().default(1),
  pageSize: z.coerce.number().int().min(1).max(100).optional().default(25),
});
export type SegmentMembersQuery = z.input<typeof SegmentMembersQuery>;
export const SegmentMemberPage = z.object({
  items: z
    .array(
      z.object({
        kind: z.enum(['CLIENT', 'LEAD']),
        id: z.uuid(),
        label: z.string(),
        secondary: z.string().nullable(),
      }),
    )
    .max(100),
  ...Page,
});
export type SegmentMemberPage = z.infer<typeof SegmentMemberPage>;

/** PUT .../segments/{id}/members: a STATIC list's members, replaced (up to 5,000 people). */
export const SetSegmentMembersRequest = z.strictObject({
  clientIds: z.array(z.uuid()).max(5_000).optional().default([]),
  leadIds: z.array(z.uuid()).max(5_000).optional().default([]),
  etag: Etag,
});
export type SetSegmentMembersRequest = z.input<typeof SetSegmentMembersRequest>;

// ---------- Consent and suppression ----------

/**
 * PUT /business/communications/consent: staff record a contact's standing on a channel (an opt-out
 * a client told them about, a restored opt-in with its source). It takes effect on the next
 * eligibility check. An unsubscribe link and an SMS STOP reply do the same through the public
 * routes. Audited with ids. 404 for a contact the caller does not reach.
 */
export const SetConsentRequest = z
  .strictObject({
    clientId: z.uuid().optional(),
    leadId: z.uuid().optional(),
    channel: z.enum(['EMAIL', 'SMS']),
    status: ConsentStatus,
    reason: clearable(text(500, 'many')),
  })
  .refine(
    (c) => (c.clientId === undefined) !== (c.leadId === undefined),
    'Name a client or a lead',
  );
export type SetConsentRequest = z.input<typeof SetConsentRequest>;
export const ConsentQuery = z.strictObject({
  clientId: z.uuid().optional(),
  leadId: z.uuid().optional(),
});
export type ConsentQuery = z.input<typeof ConsentQuery>;
export const ConsentView = z.object({
  items: z.array(
    z.object({
      channel: z.enum(['EMAIL', 'SMS']),
      status: ConsentStatus,
      /** "portal", "unsubscribe_link", "reply_stop", "staff", "provider". */
      source: z.string(),
      changedBy: MemberRef.nullable(),
      updatedAt: DateTime,
    }),
  ),
});
export type ConsentView = z.infer<typeof ConsentView>;

// ---------- Errors ----------

export const CommunicationErrorCode = z.enum([
  /** 409: the channel is not ready for the caller (no provider, no verified sender, no permission, portal off). */
  'CHANNEL_UNAVAILABLE',
  /** 409: someone saved after it was loaded. */
  'SAVE_CONFLICT',
  /** 409: the campaign is no longer editable (sent, sending, cancelled, or scheduled past its lock). */
  'NOT_EDITABLE',
  /** 409: the campaign is past its lock time and cannot be rescheduled or edited. */
  'LOCKED',
  /** 409: sending or scheduling is blocked; the checks name why. */
  'NOT_READY',
  /** 409: the final eligible count changed since it was shown; confirm the new count. */
  'AUDIENCE_CHANGED',
  /** 409: changing the channel would drop content the new channel cannot hold. */
  'CONTENT_WOULD_BE_LOST',
  /** 409: the template is of a kind that does not fit the channel, or is not active. */
  'TEMPLATE_NOT_ALLOWED',
  /** 400: the test destination is not the caller's own. */
  'TEST_SEND_REFUSED',
  /** 400: a criteria field or operator the catalog does not offer for the audience. */
  'INVALID_CRITERIA',
  /** 409: a segment or list with this name exists. */
  'DUPLICATE_NAME',
  /** 409: a scheduled communication uses the segment: archive it after, or replace it. */
  'SEGMENT_IN_USE',
  /** 409: the schedule time is not in the future. */
  'SCHEDULE_IN_PAST',
  /** 409: a failed-recipient resend or follow-up has nobody eligible. */
  'NO_ELIGIBLE_RECIPIENTS',
  /** 409: the campaign has not finished sending: results are partial. */
  'STILL_SENDING',
  /** 403: export needs the Export capability. */
  'EXPORT_NOT_ALLOWED',
]);
export type CommunicationErrorCode = z.infer<typeof CommunicationErrorCode>;
