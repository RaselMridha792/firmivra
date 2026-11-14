import { z } from 'zod';
import { Email } from '../auth/schemas.js';
import { CalendarDate, MemberRef } from '../clients/schemas.js';
import { clearable, SearchText, text } from '../clients/text.js';
import {
  ClientAccountType,
  LeadActionType,
  LeadActivityKind,
  LeadContactKind,
  LeadPriority,
  LeadSource,
  LeadStatus,
} from '../db-enums.js';
import { UPLOAD_FILE_FACTS, uploadNameFitsType } from '../documents/schemas.js';
import { EMAIL_HTML_MAX } from './email.js';

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

/**
 * Next Action types (Call, Email, SMS, Appointment, Send Documents, Follow Up, Close Lead): the
 * database's LeadActionType under the name the screens use. One source; the root exports both.
 */
export const NextActionType = LeadActionType;
export type NextActionType = z.infer<typeof NextActionType>;

const NamedRef = z.object({ id: z.uuid(), name: z.string() });

/**
 * A campaign: a Communications email or text campaign (L7). A lead is in it when it is in the
 * campaign's audience (Add to Campaign, Add New Lead); joining sends nothing. The row shows the
 * campaign the lead joined last; removing a lead is done in Communications, Recipients.
 */
export const LeadCampaignRef = NamedRef;

export const NextAction = z.object({
  type: NextActionType,
  /** Always set (leads_next_action); for CLOSE_LEAD, when the lead was closed. */
  dueAt: DateTime,
  notes: z.string().nullable(),
  /** Derived: dueAt passed and not completed; never for CLOSE_LEAD. Never stored. */
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
  /**
   * Archived Leads (More Filters, L10): only the archived leads, which every other view leaves
   * out. The other filters still apply.
   */
  archived: QueryBool.optional(),
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

// Leads R2 11 (Octavia, Nov 8): the three required fields say what is missing, in her words.
const FirstName = text(60, 'one', 'First name is required');
const LastName = text(60, 'one', 'Last name is required');
/** Lower-cased like every email; blank and malformed are told apart. */
const LeadEmail = z
  .string()
  .trim()
  .min(1, 'Email is required')
  .toLowerCase()
  .pipe(z.email('Enter a valid email address').max(254, 'Use at most 254 characters'));

/**
 * Leads R2 9: one of a lead's other phones and emails, with an optional label ("Work", "Mobile").
 * The lead's own Email and Phone stay its primary ones; these are listed beside them.
 */
export const LeadContactPointInput = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('EMAIL'), value: LeadEmail, label: clearable(text(40)) }),
  z.strictObject({
    kind: z.literal('PHONE'),
    value: text(40, 'one', 'Phone number is required'),
    label: clearable(text(40)),
  }),
]);
export type LeadContactPointInput = z.input<typeof LeadContactPointInput>;

/** The whole list, in order; each phone or email once (letter case ignored). */
const OtherContacts = z
  .array(LeadContactPointInput)
  .max(10, 'Add at most 10 other phones and emails')
  .superRefine((list, ctx) => {
    const seen = new Set<string>();
    list.forEach((c, i) => {
      const key = `${c.kind}:${c.value.toLowerCase()}`;
      if (seen.has(key)) {
        ctx.addIssue({
          code: 'custom',
          path: [i, 'value'],
          message: `This ${c.kind === 'EMAIL' ? 'email' : 'phone number'} is already listed`,
        });
      }
      seen.add(key);
    });
  });

/** A lead's other phone or email, as the profile shows it. */
export const LeadContactPoint = z.object({
  kind: LeadContactKind,
  value: z.string(),
  label: z.string().nullable(),
});
export type LeadContactPoint = z.infer<typeof LeadContactPoint>;

const NextActionInput = z.strictObject({
  type: NextActionType,
  /** Required with every type, as the database requires it (CLOSE_LEAD: now). */
  dueAt: DateTime,
  notes: clearable(text(500, 'many')),
});

/** POST /business/leads: Add New Lead. 409 POSSIBLE_DUPLICATE (same email or phone) unless allowed. */
export const CreateLeadRequest = z.strictObject({
  firstName: FirstName,
  lastName: LastName,
  businessName: clearable(text(160)),
  email: LeadEmail,
  phone: clearable(text(40)),
  /** R2 9: other phones and emails beside the primary ones. */
  otherContacts: OtherContacts.default([]),
  source: LeadSource,
  sourceDetail: clearable(text(120)),
  campaignId: z.uuid().nullable().optional(),
  serviceIds: z.array(z.uuid()).max(10).default([]),
  preferredContact: z.array(ContactChannel).max(3).default([]),
  assignedUserId: z.uuid().nullable().optional(),
  priority: LeadPriority.default('WARM'),
  stage: LeadPipelineStatus.exclude(['CONVERTED']).default('SUBMITTED'),
  nextAction: NextActionInput.optional(),
  /** L8 "+ Add Follow-Up": more steps, each its own action, date and time, and notes. */
  followUps: z.array(NextActionInput).max(10).optional(),
  /** Create even though a lead with this email or phone exists (the screen asked first). */
  allowDuplicate: z.boolean().optional(),
});
export type CreateLeadRequest = z.input<typeof CreateLeadRequest>;

/** PATCH /business/leads/{id}: Edit (Contact Information, Lead Details, tags, assignment). */
export const UpdateLeadRequest = z
  .strictObject({
    firstName: FirstName,
    lastName: LastName,
    businessName: clearable(text(160)),
    email: LeadEmail,
    phone: clearable(text(40)),
    address: clearable(text(300, 'many')),
    /** R2 8: from 1900 to today. */
    dateOfBirth: CalendarDate.nullable(),
    /** R2 9: the whole list of other phones and emails (it replaces the stored one). */
    otherContacts: OtherContacts,
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

/** L8 POST /business/leads/{id}/follow-ups: one more step (409 LEAD_CLOSED on a closed lead). */
export const AddLeadFollowUpRequest = NextActionInput;
export type AddLeadFollowUpRequest = z.input<typeof AddLeadFollowUpRequest>;

/** L8 PATCH /business/leads/{id}/follow-ups/{followUpId}: an unfinished step (409 FOLLOW_UP_DONE). */
export const UpdateLeadFollowUpRequest = NextActionInput.partial().refine(
  (b) => Object.keys(b).length > 0,
  'Change something first',
);
export type UpdateLeadFollowUpRequest = z.input<typeof UpdateLeadFollowUpRequest>;

/** L8 POST /business/leads/{id}/follow-ups/{followUpId}/complete: done, with its outcome. */
export const CompleteLeadFollowUpRequest = z.strictObject({
  outcome: clearable(text(500, 'many')),
});
export type CompleteLeadFollowUpRequest = z.input<typeof CompleteLeadFollowUpRequest>;

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
  /**
   * Restore from Archived Leads (L10): the grid's Delete, as Archive. The lead comes back with
   * the status, details and history it had; a lead that is not archived is skipped.
   */
  z.strictObject({ action: z.literal('RESTORE'), ids: z.array(z.uuid()).min(1).max(200) }),
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
 *
 * An email may also carry `html` (leads/email.ts): the formatted message, with `body` the same
 * message as plain text (at most 5000 characters). The API cleans the HTML to the composer's
 * rules and sends both parts; without `html` the email is `body` as today.
 */
export const LeadMessageRequest = z
  .strictObject({
    ids: z.array(z.uuid()).min(1).max(200),
    channel: z.enum(['EMAIL', 'SMS']),
    subject: clearable(text(200)),
    body: text(5000, 'many'),
    html: z.string().trim().min(1).max(EMAIL_HTML_MAX).optional(),
  })
  .refine((m) => m.html === undefined || m.channel === 'EMAIL', {
    path: ['html'],
    message: 'Only an email can be formatted',
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

/** lead_activities.summary holds up to this many characters (R47, lead_activities_text). */
export const LEAD_ACTIVITY_SUMMARY_MAX = 1000;

/** Log Activity: a manual call, meeting, note or follow-up. */
export const LogLeadActivityRequest = z.strictObject({
  kind: LeadActivityKind.extract(['CALL', 'EMAIL_SENT', 'SMS_SENT', 'MEETING', 'FOLLOW_UP']),
  at: DateTime.optional(),
  summary: text(LEAD_ACTIVITY_SUMMARY_MAX, 'many'),
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

const LeadTaskPriority = z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT']);
export const LeadTask = z.object({
  id: z.uuid(),
  title: z.string(),
  dueOn: CalendarDate.nullable(),
  priority: LeadTaskPriority,
  done: z.boolean(),
  /** R2 2: who it is assigned to, when someone is. */
  assignedTo: MemberRef.nullable().optional(),
});
export type LeadTask = z.infer<typeof LeadTask>;

/**
 * Leads R2 2: POST /business/leads/{id}/tasks, Create Task opened from the lead (its Tasks tab and
 * Overview). The task is the lead's (tasks.lead_id): it shows on the lead, not in the Tasks
 * module's lists, which are clients' work. Staff assign it to themselves.
 */
export const CreateLeadTaskRequest = z.strictObject({
  title: text(200, 'one', 'Enter the task name'),
  details: clearable(text(5_000, 'many')),
  dueOn: CalendarDate,
  /** The Tasks module's priorities (tasks.priority). */
  priority: z.enum(['LOW', 'MEDIUM', 'HIGH']).default('MEDIUM'),
  assignedUserId: z.uuid().nullable().optional(),
});
export type CreateLeadTaskRequest = z.input<typeof CreateLeadTaskRequest>;

/** PATCH /business/leads/{id}/tasks/{taskId}: done, or open again. */
export const UpdateLeadTaskRequest = z.strictObject({ done: z.boolean() });
export type UpdateLeadTaskRequest = z.input<typeof UpdateLeadTaskRequest>;

export const LeadAppointment = z.object({
  id: z.uuid(),
  startsAt: DateTime,
  endsAt: DateTime,
  type: z.string().nullable(),
  staff: MemberRef,
  status: z.string(),
});
export type LeadAppointment = z.infer<typeof LeadAppointment>;

/**
 * One file of a lead: the lead's own (Begin Online) or one staff added (Leads R2 4, `addedBy`).
 * At conversion each becomes a document of the new client: the lead's own as the client's, a staff
 * file firm-only (INTERNAL), to be shared on purpose.
 */
export const LeadDocument = z.object({
  id: z.uuid(),
  fileName: z.string(),
  uploadedAt: DateTime,
  scanStatus: z.string(),
  /** The member who added it; null for the lead's own file. */
  addedBy: MemberRef.nullable().optional(),
});
export type LeadDocument = z.infer<typeof LeadDocument>;

/**
 * Leads R2 4: POST /business/leads/{id}/files, a ticket to add a file to an open lead (not a
 * draft, an expired, converted or archived one): R5's upload steps and file rules. Then the browser
 * sends the file and confirms (`.../files/confirm`).
 */
export const CreateLeadFileRequest = z
  .strictObject(UPLOAD_FILE_FACTS)
  .superRefine(uploadNameFitsType);
export type CreateLeadFileRequest = z.input<typeof CreateLeadFileRequest>;

/** Documents & Forms tab: the lead's files and the intake forms sent to it. */
export const LeadDocumentsAndForms = z.object({
  documents: z.array(LeadDocument),
  forms: z.array(
    z.object({ id: z.uuid(), name: z.string(), status: z.string(), sentAt: DateTime.nullable() }),
  ),
});
export type LeadDocumentsAndForms = z.infer<typeof LeadDocumentsAndForms>;

/**
 * L8: one follow-up step of a lead. The lead's Next Action is its next unfinished step; a finished
 * one keeps its outcome.
 */
export const LeadFollowUp = z.object({
  id: z.uuid(),
  type: NextActionType,
  dueAt: DateTime,
  notes: z.string().nullable(),
  doneAt: DateTime.nullable(),
  outcome: z.string().nullable(),
});
export type LeadFollowUp = z.infer<typeof LeadFollowUp>;

/** GET /business/leads/{id}/profile: the Lead Profile header and Overview tab in one call. */
export const LeadProfile = LeadRow.extend({
  address: z.string().nullable(),
  dateOfBirth: CalendarDate.nullable(),
  /** R2 9: other phones and emails, in the order saved. */
  otherContacts: z.array(LeadContactPoint),
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
  /**
   * Other leads and clients with this lead's email (any case) or phone, at most five each, among
   * the ones the member reaches; its own client is left out. Begin Online can make a second lead
   * for the same person: the screen warns and links, nothing is merged (Rasel, Oct 24).
   */
  duplicates: z.object({ leads: z.array(NamedRef), clients: z.array(NamedRef) }),
  /** L8: every follow-up step, unfinished first by date, then the finished ones, newest first. */
  followUps: z.array(LeadFollowUp),
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

/**
 * POST /business/leads/bulk-convert: Convert to Client from the bulk bar (her written spec, L12).
 * Each selected lead goes through the same conversion with what its own record holds: the client
 * type from its business name, its contact details, its services of interest, and its assigned
 * staff member (or `primaryStaffUserId` for all; Staff are always their own), with all of its
 * history carried over. A lead the record cannot convert alone (no phone, no service, a client
 * already has its email) is skipped with the reason, to convert on its own. Retry-safe.
 */
export const BulkConvertLeadsRequest = z.strictObject({
  idempotencyKey: z.uuid(),
  ids: z.array(z.uuid()).min(1).max(25),
  primaryStaffUserId: z.uuid().optional(),
  sendPortalInvite: z.boolean(),
});
export type BulkConvertLeadsRequest = z.input<typeof BulkConvertLeadsRequest>;

export const BulkConvertLeadsResult = z.object({
  converted: z.array(z.object({ leadId: z.uuid(), name: z.string(), clientId: z.uuid() })),
  skipped: z.array(z.object({ leadId: z.uuid(), name: z.string(), reason: z.string() })),
});
export type BulkConvertLeadsResult = z.infer<typeof BulkConvertLeadsResult>;

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
