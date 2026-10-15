import { z } from 'zod';
import { Email } from '../auth/schemas.js';
import { CalendarDate, MemberRef } from '../clients/schemas.js';
import { clearable, SearchText, text } from '../clients/text.js';
import {
  ClientAccountType,
  LeadActivityKind,
  LeadPriority,
  LeadSource,
  LeadStatus,
} from '../db-enums.js';

// Leads workspace (R43 contract, for Arfan's screens): the Leads page (KPIs, filters, bulk
// actions, the table), Add New Lead, the Lead Profile with its tabs, follow-ups and the
// five-step Convert Lead to Client. Designs: docs/mockups/firm-workspace/leads/source/. Brief:
// docs/work/briefs/leads-contract.md. It works on the same `leads` rows as R11's Begin Online
// inbox (`api.leads`, schemas.ts), which stays as it is; a Begin Online lead shows here with
// source BEGIN_ONLINE. Firm routes under /api/v1/business/leads (`@Access('LEADS')`). Every
// action checks the member's grid (view all or assigned only, create/edit, assign/status,
// bulk/campaigns, convert/delete); nothing is hard-coded per role. Another firm's lead is 404.
// Responses are plain objects; requests are strict.

const DateTime = z.iso.datetime({ offset: true });

export const LeadRecordId = z.uuid();

/**
 * The lead's status in the pipeline: the database's LeadStatus (R37) without DRAFT and EXPIRED
 * (a Begin Online draft the visitor has not sent, which the firm never sees). SUBMITTED is "New
 * Lead", DECLINED is "Not Qualified"; IN_REVIEW stays for Begin Online leads opened before R37.
 * The `stage` fields and filters below hold this value (the leads.status column).
 */
export const LeadPipelineStatus = LeadStatus.exclude(['DRAFT', 'EXPIRED']);
export type LeadPipelineStatus = z.infer<typeof LeadPipelineStatus>;

export const LEAD_STATUS_LABELS: Record<LeadPipelineStatus, string> = {
  SUBMITTED: 'New Lead',
  IN_REVIEW: 'In Review',
  CONTACTED: 'Contacted',
  IN_FOLLOW_UP: 'In Follow-Up',
  APPOINTMENT_SCHEDULED: 'Appointment Scheduled',
  QUALIFIED: 'Qualified',
  CONVERTED: 'Converted',
  DECLINED: 'Not Qualified',
  LOST: 'Lost / No Response',
};

// LeadPriority, LeadSource and LeadActivityKind are the database enums (db-enums.ts, generated
// from the Prisma schema): one source, exported from the package root.

export const ContactChannel = z.enum(['PHONE', 'EMAIL', 'SMS']);
export type ContactChannel = z.infer<typeof ContactChannel>;

/** Next Action types (Call, Email, Appointment, Send Documents, Follow Up, Close Lead). */
export const NextActionType = z.enum([
  'CALL',
  'EMAIL',
  'SMS',
  'APPOINTMENT',
  'SEND_DOCUMENTS',
  'FOLLOW_UP',
  'CLOSE_LEAD',
]);
export type NextActionType = z.infer<typeof NextActionType>;

const NamedRef = z.object({ id: z.uuid(), name: z.string() });

/** A campaign (Communications module, to build): a name only here. */
export const LeadCampaignRef = NamedRef;

export const NextAction = z.object({
  type: NextActionType,
  /** Null for CLOSE_LEAD ("No further action"). */
  dueAt: DateTime.nullable(),
  notes: z.string().nullable(),
  /** Derived: dueAt passed and not completed. Never stored. */
  overdue: z.boolean(),
});
export type NextAction = z.infer<typeof NextAction>;

export const LastContact = z.object({
  at: DateTime,
  channel: z.enum(['CALL', 'EMAIL', 'SMS', 'APPOINTMENT', 'OTHER']),
});
export type LastContact = z.infer<typeof LastContact>;

/** One row of the Leads table. */
export const LeadRow = z.object({
  id: z.uuid(),
  /** "LD-10024": a per-firm number (new column, to build). */
  number: z.string(),
  firstName: z.string(),
  lastName: z.string(),
  businessName: z.string().nullable(),
  email: z.string(),
  phone: z.string().nullable(),
  /** No photo storage for leads: initials. */
  avatarUrl: z.string().nullable().optional(),
  source: LeadSource,
  /** "Back Taxes Campaign", "Bookkeeping Landing Page". */
  sourceDetail: z.string().nullable(),
  campaign: LeadCampaignRef.nullable(),
  services: z.array(NamedRef),
  priority: LeadPriority,
  stage: LeadPipelineStatus,
  lastContact: LastContact.nullable(),
  nextAction: NextAction.nullable(),
  assignedTo: MemberRef.nullable(),
  preferredContact: z.array(ContactChannel),
  tags: z.array(z.string()),
  createdAt: DateTime,
});
export type LeadRow = z.infer<typeof LeadRow>;

/** A query flag: true or false, also as the strings a query string carries. */
const QueryBool = z.union([z.boolean(), z.enum(['true', 'false']).transform((v) => v === 'true')]);

const Page = z.coerce.number().int().min(1).max(10_000).optional().default(1);

/**
 * GET /business/leads/pipeline: search matches name, email, phone, source, campaign and notes.
 * Newest first unless sorted. `stage` "overdue" lists leads with an overdue next action.
 */
export const LeadPipelineQuery = z.strictObject({
  search: SearchText.optional(),
  source: LeadSource.optional(),
  serviceId: z.uuid().optional(),
  stage: LeadPipelineStatus.optional(),
  overdue: QueryBool.optional(),
  assignedUserId: z.uuid().optional(),
  from: CalendarDate.optional(),
  to: CalendarDate.optional(),
  /** More Filters. */
  priority: LeadPriority.optional(),
  campaignId: z.uuid().optional(),
  tag: z.string().max(40).optional(),
  page: Page,
  pageSize: z.coerce.number().int().min(1).max(100).optional().default(8),
});
export type LeadPipelineQuery = z.input<typeof LeadPipelineQuery>;

export const LeadPipelinePage = z.object({
  items: z.array(LeadRow).max(100),
  total: z.number().int(),
  page: z.number().int(),
  pageSize: z.number().int(),
});
export type LeadPipelinePage = z.infer<typeof LeadPipelinePage>;

const CountWithPrevious = z.object({
  value: z.number().int(),
  /** Last month's figure, for "↑ 12% vs last month"; null when not comparable. */
  previous: z.number().int().nullable(),
});

/** GET /business/leads/pipeline/summary: the six cards (a card's click filters the table). */
export const LeadPipelineSummary = z.object({
  total: CountWithPrevious,
  new: CountWithPrevious,
  inFollowUp: CountWithPrevious,
  converted: CountWithPrevious,
  notQualified: CountWithPrevious,
  overdueFollowUps: CountWithPrevious,
});
export type LeadPipelineSummary = z.infer<typeof LeadPipelineSummary>;

/** GET /business/leads/options: the filter and form dropdowns in one call. */
export const LeadOptions = z.object({
  services: z.array(NamedRef),
  staff: z.array(MemberRef),
  /** Optional until campaigns exist (Communications module). */
  campaigns: z.array(LeadCampaignRef).optional(),
  /** Tags already used at the firm. */
  tags: z.array(z.string()),
});
export type LeadOptions = z.infer<typeof LeadOptions>;

// ---------- Add / edit a lead ----------

const NextActionInput = z.strictObject({
  type: NextActionType,
  dueAt: DateTime.nullable().optional(),
  notes: clearable(text(500, 'many')),
});

/** POST /business/leads: Add New Lead. 409 POSSIBLE_DUPLICATE (same email or phone) unless allowed. */
export const CreateLeadRequest = z.strictObject({
  firstName: text(60),
  lastName: text(60),
  businessName: clearable(text(160)),
  email: Email,
  phone: clearable(text(40)),
  source: LeadSource,
  sourceDetail: clearable(text(120)),
  campaignId: z.uuid().nullable().optional(),
  serviceIds: z.array(z.uuid()).max(10).default([]),
  preferredContact: z.array(ContactChannel).max(3).default([]),
  assignedUserId: z.uuid().nullable().optional(),
  priority: LeadPriority.default('WARM'),
  stage: LeadPipelineStatus.exclude(['CONVERTED']).default('SUBMITTED'),
  nextAction: NextActionInput.optional(),
  /** Create even though a lead with this email or phone exists (the screen asked first). */
  allowDuplicate: z.boolean().optional(),
});
export type CreateLeadRequest = z.input<typeof CreateLeadRequest>;

/** PATCH /business/leads/{id}: Edit (Contact Information, Lead Details, tags, assignment). */
export const UpdateLeadRequest = z
  .strictObject({
    firstName: text(60),
    lastName: text(60),
    businessName: clearable(text(160)),
    email: Email,
    phone: clearable(text(40)),
    address: clearable(text(300, 'many')),
    dateOfBirth: CalendarDate.nullable(),
    bestTimeToContact: clearable(text(80)),
    source: LeadSource,
    sourceDetail: clearable(text(120)),
    campaignId: z.uuid().nullable(),
    serviceIds: z.array(z.uuid()).max(10),
    preferredContact: z.array(ContactChannel).max(3),
    assignedUserId: z.uuid().nullable(),
    priority: LeadPriority,
    stage: LeadPipelineStatus.exclude(['CONVERTED']),
    tags: z.array(text(40)).max(20),
  })
  .partial()
  /** From the profile; a newer one on the server is 409 SAVE_CONFLICT. */
  .extend({ version: z.string().min(1).max(100).optional() })
  .refine((b) => Object.keys(b).some((k) => k !== 'version'), 'Change something first');
export type UpdateLeadRequest = z.input<typeof UpdateLeadRequest>;

/** PUT /business/leads/{id}/follow-up: the Next Action / Follow-Up card (Save Follow-Up). */
export const SetFollowUpRequest = NextActionInput;
export type SetFollowUpRequest = z.input<typeof SetFollowUpRequest>;

/** POST /business/leads/{id}/follow-up/complete: logs it and clears or replaces the next one. */
export const CompleteFollowUpRequest = z.strictObject({
  outcome: clearable(text(500, 'many')),
  next: NextActionInput.optional(),
});
export type CompleteFollowUpRequest = z.input<typeof CompleteFollowUpRequest>;

/** Bulk actions bar. Only the selected leads the member may change are changed. */
export const LeadBulkRequest = z.discriminatedUnion('action', [
  z.strictObject({
    action: z.literal('ASSIGN'),
    ids: z.array(z.uuid()).min(1).max(200),
    assignedUserId: z.uuid().nullable(),
  }),
  z.strictObject({
    action: z.literal('STAGE'),
    ids: z.array(z.uuid()).min(1).max(200),
    stage: LeadPipelineStatus.exclude(['CONVERTED']),
  }),
  z.strictObject({
    action: z.literal('CAMPAIGN'),
    ids: z.array(z.uuid()).min(1).max(200),
    campaignId: z.uuid(),
  }),
  z.strictObject({
    action: z.literal('TAGS'),
    ids: z.array(z.uuid()).min(1).max(200),
    add: z.array(text(40)).min(1).max(10),
  }),
  /** Archive: leads are never deleted from history; a converted lead cannot be archived. */
  z.strictObject({ action: z.literal('ARCHIVE'), ids: z.array(z.uuid()).min(1).max(200) }),
]);
export type LeadBulkRequest = z.input<typeof LeadBulkRequest>;

export const LeadBulkResult = z.object({
  changed: z.number().int(),
  /** Not permitted, converted, or not found. */
  skipped: z.number().int(),
});
export type LeadBulkResult = z.infer<typeof LeadBulkResult>;

/**
 * Send Email / Send SMS (one lead or the bulk bar): the message is sent through Communications
 * (to build) and logged on each lead. SMS needs the firm's SMS sender.
 */
export const LeadMessageRequest = z.strictObject({
  ids: z.array(z.uuid()).min(1).max(200),
  channel: z.enum(['EMAIL', 'SMS']),
  subject: clearable(text(200)),
  body: text(5000, 'many'),
});
export type LeadMessageRequest = z.input<typeof LeadMessageRequest>;

// ---------- Activity, notes, profile ----------

/** One Recent Activity / Activity / Communications row. */
export const LeadActivity = z.object({
  id: z.uuid(),
  at: DateTime,
  kind: LeadActivityKind,
  /** "Lead created from Facebook Ad", "Email sent: Welcome to LVP". */
  label: z.string(),
  /** Null for System. */
  by: MemberRef.nullable(),
});
export type LeadActivity = z.infer<typeof LeadActivity>;

/** GET /business/leads/{id}/activity; `kind` "communications" = CALL, EMAIL_SENT, SMS_SENT. */
export const LeadActivityQuery = z.strictObject({
  kind: z.enum(['all', 'communications']).optional().default('all'),
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional().default(25),
});
export type LeadActivityQuery = z.input<typeof LeadActivityQuery>;

export const LeadActivityPage = z.object({
  items: z.array(LeadActivity).max(100),
  nextCursor: z.string().nullable(),
});
export type LeadActivityPage = z.infer<typeof LeadActivityPage>;

/** Log Activity: a manual call, meeting, note or follow-up. */
export const LogLeadActivityRequest = z.strictObject({
  kind: LeadActivityKind.extract(['CALL', 'EMAIL_SENT', 'SMS_SENT', 'MEETING', 'FOLLOW_UP']),
  at: DateTime.optional(),
  summary: text(1000, 'many'),
});
export type LogLeadActivityRequest = z.input<typeof LogLeadActivityRequest>;

export const LeadNote = z.object({
  id: z.uuid(),
  text: z.string(),
  by: MemberRef.nullable(),
  at: DateTime,
});
export type LeadNote = z.infer<typeof LeadNote>;
export const LeadNoteList = z.object({ items: z.array(LeadNote) });
export const AddLeadNoteRequest = z.strictObject({ text: text(2000, 'many') });
export type AddLeadNoteRequest = z.input<typeof AddLeadNoteRequest>;

export const LeadTask = z.object({
  id: z.uuid(),
  title: z.string(),
  dueOn: CalendarDate.nullable(),
  priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT']),
  done: z.boolean(),
});
export type LeadTask = z.infer<typeof LeadTask>;

export const LeadAppointment = z.object({
  id: z.uuid(),
  startsAt: DateTime,
  endsAt: DateTime,
  type: z.string().nullable(),
  staff: MemberRef,
  status: z.string(),
});
export type LeadAppointment = z.infer<typeof LeadAppointment>;

/** Documents & Forms tab: Begin Online uploads and intake forms sent to the lead. */
export const LeadDocumentsAndForms = z.object({
  documents: z.array(
    z.object({ id: z.uuid(), fileName: z.string(), uploadedAt: DateTime, scanStatus: z.string() }),
  ),
  forms: z.array(
    z.object({ id: z.uuid(), name: z.string(), status: z.string(), sentAt: DateTime.nullable() }),
  ),
});
export type LeadDocumentsAndForms = z.infer<typeof LeadDocumentsAndForms>;

/** GET /business/leads/{id}/profile: the Lead Profile header and Overview tab in one call. */
export const LeadProfile = LeadRow.extend({
  address: z.string().nullable(),
  dateOfBirth: CalendarDate.nullable(),
  bestTimeToContact: z.string().nullable(),
  /**
   * Lead Score (85, High Intent). No scoring rule is defined yet: optional, left out until the
   * firm's scoring (Automations or a later module) supplies it.
   */
  score: z.object({ value: z.number().int().min(0).max(100), label: z.string() }).optional(),
  recentActivity: z.array(LeadActivity).max(10),
  upcomingAppointments: z.array(LeadAppointment),
  openTasks: z.array(LeadTask),
  /** Set once CONVERTED. */
  client: NamedRef.nullable(),
  /** R11's Begin Online intake, when the lead came from there (open with api.leads.get). */
  beginOnline: z.boolean(),
  archivedAt: DateTime.nullable(),
  version: z.string(),
});
export type LeadProfile = z.infer<typeof LeadProfile>;

// ---------- Convert Lead to Client (five steps) ----------

/** What to Carry Over. */
export const CarryOver = z.strictObject({
  contactInfo: z.boolean().default(true),
  notes: z.boolean().default(true),
  communications: z.boolean().default(true),
  appointments: z.boolean().default(true),
  tasks: z.boolean().default(true),
  documents: z.boolean().default(true),
  intakeForms: z.boolean().default(true),
  tags: z.boolean().default(true),
  attribution: z.boolean().default(true),
});
export type CarryOver = z.input<typeof CarryOver>;

/**
 * POST /business/leads/{id}/convert-to-client: the whole flow in one call after Review &
 * Confirm. Creates the client (or uses `clientId`), one ACTIVE engagement per service, carries
 * the chosen history over and keeps the lead as CONVERTED, linked to the client. Retry-safe.
 */
export const ConvertLeadToClientRequest = z.strictObject({
  idempotencyKey: z.uuid(),
  /** An existing client instead of a new one (409 DUPLICATE_EMAIL suggests it). */
  clientId: z.uuid().optional(),
  accountType: ClientAccountType.default('INDIVIDUAL'),
  fullName: text(120),
  businessName: clearable(text(160)),
  email: Email,
  phone: text(40),
  address: clearable(text(300, 'many')),
  /** Services to Activate: at least one. */
  serviceIds: z.array(z.uuid()).min(1, 'Choose at least one service').max(10),
  primaryStaffUserId: z.uuid(),
  additionalStaffUserIds: z.array(z.uuid()).max(10).default([]),
  carryOver: CarryOver.prefault({}),
  /** Client Portal Access: send the invitation now, or later by hand. */
  sendPortalInvite: z.boolean().default(true),
});
export type ConvertLeadToClientRequest = z.input<typeof ConvertLeadToClientRequest>;

/** The Complete step. */
export const ConvertLeadToClientResult = z.object({
  clientId: z.uuid(),
  engagementIds: z.array(z.uuid()),
  inviteSent: z.boolean(),
  carried: z.object({
    notes: z.number().int(),
    communications: z.number().int(),
    appointments: z.number().int(),
    tasks: z.number().int(),
    documents: z.number().int(),
    intakeForms: z.number().int(),
  }),
});
export type ConvertLeadToClientResult = z.infer<typeof ConvertLeadToClientResult>;

export const LeadPipelineErrorCode = z.enum([
  /** 409: a lead or client with this email or phone exists; resend with allowDuplicate. */
  'POSSIBLE_DUPLICATE',
  /** 409: a client with this email exists; convert into it with clientId. */
  'DUPLICATE_EMAIL',
  /** 409: the lead is already converted. */
  'ALREADY_CONVERTED',
  /** 409: someone saved this lead after it was loaded. */
  'SAVE_CONFLICT',
  /** 400: SMS while the firm has no SMS sender or the lead has no phone. */
  'SMS_UNAVAILABLE',
]);
export type LeadPipelineErrorCode = z.infer<typeof LeadPipelineErrorCode>;
