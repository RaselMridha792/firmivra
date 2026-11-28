import { z } from 'zod';
import { Address, CalendarDate, MemberRef } from '../clients/schemas.js';
import { clearable, SearchText, text } from '../clients/text.js';
import { HttpsUrl } from '../content/schemas.js';
import { UploadContentType } from '../documents/schemas.js';
import {
  EinStatus,
  AdvisoryActionStatus,
  AdvisoryAssigneeKind,
  AdvisoryClientStatus,
  AdvisoryFinancialSource,
  AdvisoryGoalStatus,
  AdvisoryPlanStatus,
  AdvisoryPriority,
  AdvisoryRecommendationStatus,
  AdvisoryServiceRole,
  AdvisoryServiceStatus,
  ClientAccountType,
} from '../db-enums.js';

// Business Advisory & Development (R55 contract, for the Business Advisory screens): the overview
// (KPIs, recent advisory clients, goals and milestones, upcoming meetings, resources, quick
// actions), the Advisory Clients tab, Create / Edit Business Plan (business profile, financial and
// business assessment, goals and strategy, action plan, review and save), Client Advisory Detail /
// Growth Plan (KPIs, business health, plan, financials, goals, recommendations, tasks, meetings,
// documents, portal, activity), goals and milestones, financial analysis, action plans, the
// resource library and the advisory reports. Designs: docs/mockups/firm-workspace/business-advisory/source/ and its guide.
//
// The services an advisory client takes come from the firm's own Services & Pricing catalog (a firm
// enables, renames, prices and adds services without code); regulated specialist needs (legal,
// banking, lending, insurance) are tracked as referral or project steps, never presented as advice
// Firmivra gives. Recommendations, projections and the Business Health Score are advisory tools,
// not guarantees: the score is calculated from a transparent, configurable formula and shows its
// factors and the age of its data. A finalized or sent plan keeps an immutable version snapshot of
// everything it said; later edits never change it. An EIN is never in this contract (only its last
// 4 digits on the client's own record). A manual override of financial figures needs a reason and
// keeps the earlier row. Firm routes under /api/v1/business (`@Access('BUSINESS_ADVISORY')`): Owner
// and Admin reach every advisory client; Staff only the clients assigned to them (any other is
// 404); the grid's capabilities decide the rest (Create/Edit plans, Manage goals, Manage
// recommendations, View financial analysis, Override financial inputs, Manage services, Send plans
// and resources, Advisory Admin). Money is in cents. Responses are plain objects; requests are
// strict. Audited with ids, statuses and field names only, never figures or notes.

const DateTime = z.iso.datetime({ offset: true });
const Page = { total: z.number().int(), page: z.number().int(), pageSize: z.number().int() };
const Cents = z.number().int().min(0).max(100_000_000_000);
const SignedCents = z.number().int().min(-100_000_000_000).max(100_000_000_000);
const Etag = z.string().min(1).max(100);
const Year = z.number().int().min(2000).max(2100);
const QueryYear = z.coerce.number().int().min(2000).max(2100);

export const AdvisoryClientId = z.uuid();
export const AdvisoryWorkstreamId = z.uuid();
export const AdvisoryPlanId = z.uuid();
export const AdvisoryGoalId = z.uuid();
export const AdvisoryMilestoneId = z.uuid();
export const AdvisoryRecommendationId = z.uuid();
export const AdvisoryActionItemId = z.uuid();
export const AdvisoryVersionNumber = z.number().int().min(1);
/** A resource of the approved library (`funding-readiness-checklist`). */
export const AdvisoryResourceKey = z.string().regex(/^[a-z][a-z0-9-]{1,79}$/, 'Use a resource key');

const ClientRef = z.object({
  id: z.uuid(),
  name: z.string(),
  accountType: ClientAccountType,
  email: z.string().nullable(),
  phone: z.string().nullable(),
});
export type AdvisoryPersonClient = z.infer<typeof ClientRef>;

/** The wording shown with every projection and score. */
export const ADVISORY_DISCLAIMER =
  'Recommendations, projections and business-health indicators are advisory tools, not guarantees.';

// ---------- Services (from Services & Pricing) ----------

/** One service an advisory client can take, as the firm's catalog has it. */
export const AdvisoryServiceOption = z.object({
  serviceId: z.uuid(),
  name: z.string(),
  description: z.string().nullable(),
  /** The firm's packages that include it. */
  packages: z.array(z.string()),
  /** A regulated or specialist need tracked as referral or project steps, not as advice. */
  referralOnly: z.boolean(),
  /**
   * A-X14 (Business Advisory Review Two, B35): the primary focus category the service belongs to,
   * the firm's own Services & Pricing category (Business Formation, Business Planning, Branding &
   * Website, Funding Readiness, Growth Strategy, Operations, Staffing, Financial Analysis, ...).
   * Null: no category, shown as General Advisory.
   */
  category: z.object({ id: z.uuid(), name: z.string() }).nullable(),
});
export type AdvisoryServiceOption = z.infer<typeof AdvisoryServiceOption>;
/** A-X14: where a service with no Services & Pricing category is listed. */
export const ADVISORY_GENERAL_FOCUS = 'General Advisory';
export const AdvisoryServiceOptionList = z.object({ items: z.array(AdvisoryServiceOption) });
export type AdvisoryServiceOptionList = z.infer<typeof AdvisoryServiceOptionList>;

/**
 * Business Advisory Review Two A-12, A-13: a service under way. Its files and document requests
 * go to the client's ACTIVE engagement on it, which these statuses start when it is missing.
 */
export const ADVISORY_ENGAGED_STATUSES: readonly AdvisoryServiceStatus[] = [
  'ACCEPTED',
  'IN_PROGRESS',
  'AWAITING_CLIENT',
  'ON_HOLD',
];

/** A service workstream of an advisory client. */
export const AdvisoryWorkstream = z.object({
  id: AdvisoryWorkstreamId,
  serviceId: z.uuid(),
  serviceName: z.string(),
  role: AdvisoryServiceRole,
  status: AdvisoryServiceStatus,
  packageName: z.string().nullable(),
  startedOn: CalendarDate.nullable(),
  completedOn: CalendarDate.nullable(),
  /** Default checklist items the service creates (documents, milestones, tasks): how many are open. */
  openItems: z.number().int(),
});
export type AdvisoryWorkstream = z.infer<typeof AdvisoryWorkstream>;

/**
 * POST /business/advisory/clients/{id}/workstreams/{workstreamId}/engagement (A-12, A-13): the
 * client's ACTIVE engagement on a service under way, started if it had none, for Upload Document
 * and Request Document (the documents API's `serviceId`).
 */
export const AdvisoryWorkstreamEngagement = z.object({
  engagementId: z.uuid(),
  created: z.boolean(),
});
export type AdvisoryWorkstreamEngagement = z.infer<typeof AdvisoryWorkstreamEngagement>;

/**
 * GET /business/advisory/clients/{id}/deliverables (A-X14, Business Advisory Review Two B35): the
 * client's Services & Deliverables tab. Their advisory services In Progress (accepted, under
 * way, waiting on the client or on hold) and Completed, each with its dates, who carries it out
 * (the staff member assigned to the client's engagement on it, else the advisor), the files on
 * that engagement and the engagement to open; and Plans Delivered, the plan versions delivered to
 * the client, read from the versions themselves (nothing is copied).
 */
export const AdvisoryDeliverable = z.object({
  workstreamId: AdvisoryWorkstreamId,
  serviceId: z.uuid(),
  serviceName: z.string(),
  role: AdvisoryServiceRole,
  status: AdvisoryServiceStatus,
  packageName: z.string().nullable(),
  startedOn: CalendarDate.nullable(),
  completedOn: CalendarDate.nullable(),
  staff: MemberRef.nullable(),
  /** The client's newest engagement on the service, to open; null before one starts. */
  engagementId: z.uuid().nullable(),
  /** Files on that engagement, archived ones left out. */
  fileCount: z.number().int(),
});
export type AdvisoryDeliverable = z.infer<typeof AdvisoryDeliverable>;
export const AdvisoryDeliveredPlan = z.object({
  planId: AdvisoryPlanId,
  planName: z.string(),
  versionNo: z.number().int(),
  deliveredAt: DateTime,
  /** "portal", "email" or "download". */
  channel: z.string().nullable(),
  by: MemberRef.nullable(),
});
export type AdvisoryDeliveredPlan = z.infer<typeof AdvisoryDeliveredPlan>;
export const AdvisoryDeliverables = z.object({
  inProgress: z.array(AdvisoryDeliverable),
  completed: z.array(AdvisoryDeliverable),
  plansDelivered: z.array(AdvisoryDeliveredPlan),
});
export type AdvisoryDeliverables = z.infer<typeof AdvisoryDeliverables>;

// ---------- Overview ----------

export const AdvisoryKpi = z.object({
  value: z.number().int(),
  /** Percent change against the comparison period; null when it cannot be told. */
  deltaPercent: z.number().nullable(),
  comparedTo: z.string().nullable(),
});
export type AdvisoryKpi = z.infer<typeof AdvisoryKpi>;

/** The Business Health Score: out of 100, with the factors that made it and how old its data is. */
export const AdvisoryHealth = z.object({
  score: z.number().int().min(0).max(100).nullable(),
  factors: z.array(
    z.object({
      factor: z.string(),
      label: z.string(),
      weight: z.number(),
      /** The factor's own 0 to 100 value, null when its data is missing (it is then left out). */
      value: z.number().nullable(),
      explanation: z.string().nullable(),
    }),
  ),
  computedAt: DateTime.nullable(),
  /** The financial data behind it is older than the firm's freshness setting. */
  stale: z.boolean(),
  formulaVersion: z.string().nullable(),
});
export type AdvisoryHealth = z.infer<typeof AdvisoryHealth>;

export const AdvisoryClientRow = z.object({
  id: AdvisoryClientId,
  client: ClientRef,
  businessName: z.string().nullable(),
  industry: z.string().nullable(),
  businessStage: z.string().nullable(),
  primaryService: z.object({ serviceId: z.uuid(), name: z.string() }).nullable(),
  additionalServiceCount: z.number().int(),
  nextMeetingAt: DateTime.nullable(),
  status: AdvisoryClientStatus,
  advisor: MemberRef.nullable(),
  healthScore: z.number().int().nullable(),
  since: CalendarDate.nullable(),
  archived: z.boolean(),
});
export type AdvisoryClientRow = z.infer<typeof AdvisoryClientRow>;

export const AdvisoryGoalRow = z.object({
  id: AdvisoryGoalId,
  advisoryClientId: AdvisoryClientId,
  client: ClientRef,
  title: z.string(),
  area: z.string().nullable(),
  targetDate: CalendarDate.nullable(),
  status: AdvisoryGoalStatus,
  progressPercent: z.number().int(),
  owner: MemberRef.nullable(),
  planId: AdvisoryPlanId.nullable(),
  workstreamId: AdvisoryWorkstreamId.nullable(),
  milestoneCount: z.number().int(),
  milestonesDone: z.number().int(),
  archived: z.boolean(),
  updatedAt: DateTime,
});
export type AdvisoryGoalRow = z.infer<typeof AdvisoryGoalRow>;

export const AdvisoryMeetingRow = z.object({
  /** The appointment in Appointments (tagged Business Advisory). */
  appointmentId: z.uuid(),
  startsAt: DateTime,
  endsAt: DateTime,
  client: ClientRef,
  businessName: z.string().nullable(),
  meetingType: z.string().nullable(),
  /** Join or open: a meeting link or a location. */
  joinUrl: z.string().nullable(),
  location: z.string().nullable(),
  advisor: MemberRef.nullable(),
});
export type AdvisoryMeetingRow = z.infer<typeof AdvisoryMeetingRow>;

/**
 * B28 (Business Advisory review §18): how a resource reaches the client. SECURE_LINK: a link that
 * opens it in their portal after they sign in. PDF: a PDF copy they download from their portal
 * (never an email attachment). A resource offers the formats it has (`formats`).
 */
export const AdvisoryResourceFormat = z.enum(['SECURE_LINK', 'PDF']);
export type AdvisoryResourceFormat = z.infer<typeof AdvisoryResourceFormat>;
export const ADVISORY_RESOURCE_FORMAT_LABELS: Record<AdvisoryResourceFormat, string> = {
  SECURE_LINK: 'Secure Link',
  PDF: 'PDF',
};

export const AdvisoryResource = z.object({
  key: AdvisoryResourceKey,
  title: z.string(),
  /** Formation / EIN, Branding, Website, Banking, Funding, Business Planning, Market Research, Financial Management, Growth / Operations, Education. */
  category: z.string(),
  kind: z.enum(['PDF', 'CHECKLIST', 'GUIDE', 'TEMPLATE', 'VIDEO', 'LINK']),
  /** Only a client-facing resource may be sent outside. */
  clientFacing: z.boolean(),
  url: z.string().nullable(),
  /** B28: the formats it can be sent in (a video or a link: Secure Link only). */
  formats: z.array(AdvisoryResourceFormat),
  /**
   * A-X10 (Q28): BUILT_IN, the approved library (key: its catalog key; the firm may edit its copy,
   * `edited`); FIRM, the firm's own (key: "r-" and its id).
   */
  source: z.enum(['BUILT_IN', 'FIRM']).default('BUILT_IN'),
  /** A-X10: the words sent with it (edited with it). */
  summary: z.string().default(''),
  /** A-X10: a built-in resource the firm has edited. */
  edited: z.boolean().default(false),
  /** A-X10: its uploaded file, if any; offered only once its virus check is READY. */
  file: z.lazy(() => AdvisoryResourceFile.nullable()).default(null),
});
export type AdvisoryResource = z.infer<typeof AdvisoryResource>;

/**
 * A-X10 (Q28): a file uploaded for a resource. CHECKING while the virus scan runs; READY once
 * clean (only then can it be downloaded or sent); BLOCKED when the scan refused it.
 */
export const AdvisoryResourceFile = z.object({
  id: z.uuid(),
  fileName: z.string(),
  contentType: z.string(),
  sizeBytes: z.number().int(),
  status: z.enum(['CHECKING', 'READY', 'BLOCKED']),
});
export type AdvisoryResourceFile = z.infer<typeof AdvisoryResourceFile>;

/** A-X10: a resource file is at most 25 MB (the database's limit). */
export const ADVISORY_RESOURCE_FILE_MAX_BYTES = 25 * 1024 * 1024;

/**
 * A-X10 (Q28): POST /business/advisory/resources (the firm's own) and PUT .../resources/{key} (its
 * own, or its copy of a built-in one). Owner and Admin (or Business Advisory "Manage"). At most one
 * https link or one uploaded file (from POST .../resources/files/confirm); a link or a video needs a
 * link. A file still being checked may be attached; one the scan refused is 409 FILE_BLOCKED.
 */
export const SaveAdvisoryResourceRequest = z
  .strictObject({
    title: text(200, 'one', 'Enter a title'),
    category: text(100, 'one', 'Enter a category'),
    kind: z.enum(['PDF', 'CHECKLIST', 'GUIDE', 'TEMPLATE', 'VIDEO', 'LINK']),
    summary: text(1000, 'many', 'Say what the client gets'),
    clientFacing: z.boolean(),
    url: HttpsUrl.nullable().default(null),
    fileId: z.uuid().nullable().default(null),
  })
  .superRefine((r, ctx) => {
    if (r.url && r.fileId)
      ctx.addIssue({ code: 'custom', path: ['fileId'], message: 'Use a link or a file, not both' });
    if ((r.kind === 'LINK' || r.kind === 'VIDEO') && !r.url)
      ctx.addIssue({ code: 'custom', path: ['url'], message: 'A link or a video needs its link' });
  });
export type SaveAdvisoryResourceRequest = z.input<typeof SaveAdvisoryResourceRequest>;

/**
 * A-X10 (Q28): POST /business/advisory/resources/files: step 1 of an upload (the ticket), then the
 * browser sends the bytes and POST .../resources/files/confirm checks them (size, SHA-256, type)
 * and records the file, CHECKING until its virus scan. At most 25 MB.
 */
export const StartAdvisoryResourceFileRequest = z.strictObject({
  fileName: text(200, 'one', 'Enter a file name'),
  contentType: UploadContentType,
  sizeBytes: z
    .number()
    .int()
    .min(1)
    .max(ADVISORY_RESOURCE_FILE_MAX_BYTES, 'A file is at most 25 MB'),
  /** SHA-256 of the file, hex. */
  sha256: z.string().regex(/^[0-9a-f]{64}$/, 'Use the lower-case hex SHA-256'),
});
export type StartAdvisoryResourceFileRequest = z.input<typeof StartAdvisoryResourceFileRequest>;

/** GET /business/advisory/overview: Frame 1. Counts open the matching filtered lists. */
export const AdvisoryOverview = z.object({
  activeClients: AdvisoryKpi,
  activePlans: AdvisoryKpi,
  upcomingMeetings: AdvisoryKpi,
  /** Growth action plans in progress: plans whose action items are being carried out. */
  actionPlansInProgress: AdvisoryKpi,
  recentClients: z.array(AdvisoryClientRow).max(5),
  goals: z.array(AdvisoryGoalRow).max(5),
  meetings: z.array(AdvisoryMeetingRow).max(5),
  resources: z.array(AdvisoryResource).max(5),
  serviceOptions: z.array(AdvisoryServiceOption),
  disclaimer: z.string(),
  canCreatePlan: z.boolean(),
  canManageGoals: z.boolean(),
  canSend: z.boolean(),
});
export type AdvisoryOverview = z.infer<typeof AdvisoryOverview>;

// ---------- Advisory clients ----------

/** GET .../clients (the Advisory Clients tab). */
export const AdvisoryClientsQuery = z.strictObject({
  search: SearchText.optional(),
  status: AdvisoryClientStatus.optional(),
  advisorUserId: z.uuid().optional(),
  serviceId: z.uuid().optional(),
  businessStage: z.string().max(60).optional(),
  includeArchived: z.union([z.boolean(), z.stringbool()]).optional(),
  sort: z.enum(['name', 'status', 'nextMeeting', 'health']).optional().default('name'),
  direction: z.enum(['asc', 'desc']).optional().default('asc'),
  page: z.coerce.number().int().min(1).optional().default(1),
  pageSize: z.coerce.number().int().min(1).max(100).optional().default(25),
});
export type AdvisoryClientsQuery = z.input<typeof AdvisoryClientsQuery>;
export const AdvisoryClientPage = z.object({ items: z.array(AdvisoryClientRow).max(100), ...Page });
export type AdvisoryClientPage = z.infer<typeof AdvisoryClientPage>;

/**
 * POST .../clients (Add Advisory Client): puts a client of the firm in the program with one
 * Primary Service Focus and any additional services, from Services & Pricing. A client is in the
 * program once (409 ALREADY_ADVISORY_CLIENT). The advisor must be a member of the firm.
 */
export const CreateAdvisoryClientRequest = z.strictObject({
  clientId: z.uuid(),
  primaryServiceId: z.uuid(),
  additionalServiceIds: z.array(z.uuid()).max(30).optional().default([]),
  packageName: clearable(text(200)),
  advisorUserId: z.uuid().nullable().optional(),
  industry: clearable(text(100)),
  businessStage: clearable(text(60)),
  since: CalendarDate.nullable().optional(),
});
export type CreateAdvisoryClientRequest = z.input<typeof CreateAdvisoryClientRequest>;

export const UpdateAdvisoryClientRequest = z
  .strictObject({
    status: AdvisoryClientStatus.optional(),
    advisorUserId: z.uuid().nullable().optional(),
    industry: clearable(text(100)),
    businessStage: clearable(text(60)),
    since: CalendarDate.nullable().optional(),
    etag: Etag,
  })
  .refine(
    (o) => Object.keys(o).filter((k) => k !== 'etag').length > 0,
    'Change at least one field',
  );
export type UpdateAdvisoryClientRequest = z.input<typeof UpdateAdvisoryClientRequest>;

/** An overview figure with its comparison (Frame 3's KPI cards). */
export const AdvisoryMetric = z.object({
  value: z.number().nullable(),
  previous: z.number().nullable(),
  deltaPercent: z.number().nullable(),
  /** The period the figure is for, and where it came from. */
  periodLabel: z.string().nullable(),
  source: AdvisoryFinancialSource.nullable(),
  asOf: CalendarDate.nullable(),
});
export type AdvisoryMetric = z.infer<typeof AdvisoryMetric>;

/** Client Advisory Detail / Growth Plan: the header, KPIs, health and the tabs' counts. Click a KPI to open its detail. */
export const AdvisoryClientDetail = AdvisoryClientRow.extend({
  businessProfile: z.object({
    entityType: z.string().nullable(),
    yearsInBusiness: z.number().int().nullable(),
    address: Address.nullable(),
    website: z.string().nullable(),
    /** The EIN masked to its last 4 digits, only for those who may see it. */
    einMasked: z.string().nullable(),
    /** A-X01: Has EIN, Not Applicable or To Be Applied For, apart from the number; null when not set. */
    einStatus: EinStatus.nullable(),
  }),
  currentPlan: z
    .object({
      id: AdvisoryPlanId,
      name: z.string(),
      status: AdvisoryPlanStatus,
      updatedAt: DateTime,
    })
    .nullable(),
  workstreams: z.array(AdvisoryWorkstream),
  kpis: z.object({
    /** Null without "View financial analysis". */
    annualRevenueCents: AdvisoryMetric.nullable(),
    netProfitCents: AdvisoryMetric.nullable(),
    employees: AdvisoryMetric,
    activeGoals: z.object({
      count: z.number().int(),
      onTrack: z.number().int(),
      atRisk: z.number().int(),
    }),
    openTasks: z.object({ open: z.number().int(), overdue: z.number().int() }),
  }),
  health: AdvisoryHealth,
  counts: z.object({
    plans: z.number().int(),
    goals: z.number().int(),
    recommendations: z.number().int(),
    actionItems: z.number().int(),
    meetings: z.number().int(),
  }),
  /** The client's engagement, whose meetings, notes and documents the tabs read. */
  engagementId: z.uuid().nullable(),
  disclaimer: z.string(),
  canEdit: z.boolean(),
  canViewFinancials: z.boolean(),
  /** Send it back on a change: 409 SAVE_CONFLICT when someone saved after it was loaded. */
  etag: z.string(),
});
export type AdvisoryClientDetail = z.infer<typeof AdvisoryClientDetail>;

/**
 * POST .../clients/{id}/workstreams: adds a service. PATCH .../workstreams/{wid} changes it; making
 * one PRIMARY makes the old primary ADDITIONAL (a client has exactly one). A service is on a
 * client once (409 DUPLICATE_SERVICE). A declined service stays, as DECLINED.
 */
export const AddAdvisoryWorkstreamRequest = z.strictObject({
  serviceId: z.uuid(),
  role: AdvisoryServiceRole.optional().default('ADDITIONAL'),
  status: AdvisoryServiceStatus.optional().default('INTERESTED'),
  packageName: clearable(text(200)),
});
export type AddAdvisoryWorkstreamRequest = z.input<typeof AddAdvisoryWorkstreamRequest>;
export const UpdateAdvisoryWorkstreamRequest = z
  .strictObject({
    role: AdvisoryServiceRole.optional(),
    status: AdvisoryServiceStatus.optional(),
    packageName: clearable(text(200)),
    startedOn: CalendarDate.nullable().optional(),
    completedOn: CalendarDate.nullable().optional(),
  })
  .refine((o) => Object.keys(o).length > 0, 'Change at least one field');
export type UpdateAdvisoryWorkstreamRequest = z.input<typeof UpdateAdvisoryWorkstreamRequest>;

export const AdvisoryActivity = z.object({
  id: z.uuid(),
  /** "Plan finalized", "Goal completed": a short sentence from the audit trail; never figures or notes. */
  message: z.string(),
  action: z.string(),
  actor: MemberRef.nullable(),
  at: DateTime,
});
export type AdvisoryActivity = z.infer<typeof AdvisoryActivity>;
export const AdvisoryActivityPage = z.object({
  items: z.array(AdvisoryActivity).max(100),
  ...Page,
});
export type AdvisoryActivityPage = z.infer<typeof AdvisoryActivityPage>;
export const AdvisoryActivityQuery = z.strictObject({
  page: z.coerce.number().int().min(1).optional().default(1),
  pageSize: z.coerce.number().int().min(1).max(100).optional().default(25),
});
export type AdvisoryActivityQuery = z.input<typeof AdvisoryActivityQuery>;

/** A-NEW2: what an advisory change was about, for the module's View History filter. */
export const AdvisoryHistoryArea = z.enum([
  'CLIENT',
  'SERVICE',
  'PLAN',
  'GOAL',
  'FINANCIAL',
  'RECOMMENDATION',
  'ACTION',
  'RESOURCE',
  'SETTINGS',
]);
export type AdvisoryHistoryArea = z.infer<typeof AdvisoryHistoryArea>;
export const ADVISORY_HISTORY_AREA_LABELS: Record<AdvisoryHistoryArea, string> = {
  CLIENT: 'Advisory clients',
  SERVICE: 'Services',
  PLAN: 'Business plans',
  GOAL: 'Goals & milestones',
  FINANCIAL: 'Financial analysis',
  RECOMMENDATION: 'Recommendations',
  ACTION: 'Action items',
  RESOURCE: 'Resources',
  SETTINGS: 'Advisory settings',
};

/**
 * GET /business/advisory/history (A-NEW2, Business Advisory Review Two): the module's View
 * History, newest first: every advisory change (never a view) across the advisory clients the
 * caller reaches (Staff: the clients assigned to them). Firm-wide changes (Advisory Admin
 * settings) show to Owners and Admins only. Each entry names its area, its client and, for a
 * plan, the plan, so the screen opens that record. Like the client's Activity Log: what happened,
 * never a figure or a note.
 */
export const AdvisoryHistoryEntry = AdvisoryActivity.extend({
  area: AdvisoryHistoryArea.nullable(),
  /** The advisory client it is about; null for a firm-wide change. */
  advisoryClient: z.object({ id: z.uuid(), name: z.string() }).nullable(),
  /** The plan it is about, when it is a plan's change. */
  planId: z.uuid().nullable(),
});
export type AdvisoryHistoryEntry = z.infer<typeof AdvisoryHistoryEntry>;
export const AdvisoryHistoryPage = z.object({
  items: z.array(AdvisoryHistoryEntry).max(100),
  ...Page,
});
export type AdvisoryHistoryPage = z.infer<typeof AdvisoryHistoryPage>;
/**
 * Filters: one advisory client (404 when the caller doesn't reach it), one area, and the time
 * range (instants; the screen sends the start of the first day and the end of the last).
 */
export const AdvisoryHistoryQuery = z.strictObject({
  advisoryClientId: AdvisoryClientId.optional(),
  area: AdvisoryHistoryArea.optional(),
  from: DateTime.optional(),
  to: DateTime.optional(),
  page: z.coerce.number().int().min(1).optional().default(1),
  pageSize: z.coerce.number().int().min(1).max(100).optional().default(25),
});
export type AdvisoryHistoryQuery = z.input<typeof AdvisoryHistoryQuery>;

// ---------- Business plans ----------

/** The firm's goal and strategy areas (Stage 3). */
export const AdvisoryArea = z.enum([
  'REVENUE_GROWTH',
  'PROFITABILITY',
  'FUNDING',
  'EXPANSION',
  'STAFFING',
  'OPERATIONS',
  'MARKETING_SALES',
  'BUSINESS_SETUP',
  'FINANCIAL_MANAGEMENT',
]);
export type AdvisoryArea = z.infer<typeof AdvisoryArea>;

/**
 * Stage 1, Business Profile (`advisory_plans.profile`). The EIN is not here: it stays on the
 * client's own profile, masked. Every field is optional so a draft saves at any point.
 */
export const AdvisoryPlanProfile = z.strictObject({
  businessName: clearable(text(200)),
  entityType: clearable(text(60)),
  industry: clearable(text(100)),
  yearsInBusiness: z.number().int().min(0).max(200).nullable().optional(),
  businessStage: clearable(text(60)),
  productsServices: clearable(text(2_000, 'many')),
  address: z
    .strictObject({
      line1: clearable(text(200)),
      line2: clearable(text(200)),
      city: clearable(text(100)),
      state: clearable(text(60)),
      postalCode: clearable(text(20)),
    })
    .optional(),
  primaryContact: z
    .strictObject({
      name: clearable(text(200)),
      email: clearable(z.email().max(254)),
      phone: clearable(text(40)),
    })
    .optional(),
  website: clearable(z.url().max(300)),
  employeeCount: z.number().int().min(0).max(1_000_000).nullable().optional(),
  hiringPlans: clearable(text(1_000, 'many')),
  keyTeamMembers: z
    .array(z.strictObject({ name: text(200), role: clearable(text(100)) }))
    .max(30)
    .optional(),
  /** Additional Information: how the client found the firm ("Existing Client", "Referral"). */
  referralSource: clearable(text(100)),
  /** Additional Information: anything else about the business the plan should keep. */
  notes: clearable(text(2_000, 'many')),
});
export type AdvisoryPlanProfile = z.input<typeof AdvisoryPlanProfile>;

/**
 * Stage 2, the qualitative part of the Financial & Business Assessment
 * (`advisory_plans.assessment`); the numbers are financial snapshots with their source and date.
 */
export const AdvisoryPlanAssessment = z.strictObject({
  funding: z
    .strictObject({
      amountNeededCents: Cents.nullable().optional(),
      purpose: clearable(text(1_000, 'many')),
      timing: clearable(text(200)),
      readiness: clearable(text(1_000, 'many')),
    })
    .optional(),
  sales: z
    .strictObject({
      customers: clearable(text(1_000, 'many')),
      salesTrend: clearable(text(1_000, 'many')),
      targetMarket: clearable(text(1_000, 'many')),
      competitors: clearable(text(1_000, 'many')),
      differentiation: clearable(text(1_000, 'many')),
    })
    .optional(),
  operations: z
    .strictObject({
      /** B14: How the Business Operates, optional, first in Operations. */
      howItOperates: clearable(text(1_000, 'many')),
      systemsChallenges: clearable(text(1_000, 'many')),
      staffing: clearable(text(1_000, 'many')),
      efficiencyOpportunities: clearable(text(1_000, 'many')),
    })
    .optional(),
  strengths: z.array(text(300)).max(30).optional(),
  /** Shown as the plan's weaknesses (internal limitations or gaps). */
  challenges: z.array(text(300)).max(30).optional(),
  /** B14: the SWOT's optional external parts. */
  opportunities: z.array(text(300)).max(30).optional(),
  threats: z.array(text(300)).max(30).optional(),
  /** Where the financial figures came from. */
  dataSource: AdvisoryFinancialSource.optional(),
});
export type AdvisoryPlanAssessment = z.input<typeof AdvisoryPlanAssessment>;

/**
 * Stage 3, Goals & Strategy (`advisory_plans.strategy`): the areas the plan works on. B13
 * (Octavia's §3): a plan names its focus explicitly, one or more areas or `noFocusArea` (None /
 * Not Applicable), never both.
 */
export const AdvisoryPlanStrategy = z
  .strictObject({
    summary: clearable(text(3_000, 'many')),
    noFocusArea: z.boolean().optional(),
    areas: z
      .array(
        z.strictObject({
          area: AdvisoryArea,
          objective: text(500, 'many'),
          notes: clearable(text(2_000, 'many')),
        }),
      )
      .max(20)
      .refine((a) => new Set(a.map((x) => x.area)).size === a.length, 'Use each area once')
      .optional(),
  })
  .refine((s) => !(s.noFocusArea && s.areas?.length), {
    message: 'Choose focus areas or None / Not Applicable, not both',
    path: ['noFocusArea'],
  });
export type AdvisoryPlanStrategy = z.input<typeof AdvisoryPlanStrategy>;

export const AdvisoryFinancialRow = z.object({
  id: z.uuid(),
  advisoryClientId: AdvisoryClientId,
  planId: AdvisoryPlanId.nullable(),
  periodStart: CalendarDate,
  periodEnd: CalendarDate,
  revenueCents: z.number().int().nullable(),
  expensesCents: z.number().int().nullable(),
  netProfitCents: z.number().int().nullable(),
  /** Net profit over revenue, in percent; null when revenue is 0 or missing. */
  marginPercent: z.number().nullable(),
  cashFlowCents: z.number().int().nullable(),
  debtCents: z.number().int().nullable(),
  budgetRevenueCents: z.number().int().nullable(),
  budgetExpensesCents: z.number().int().nullable(),
  headcount: z.number().int().nullable(),
  source: AdvisoryFinancialSource,
  asOf: CalendarDate,
  /** A person replaced figures from a source (with a reason); the earlier row stays. */
  overridden: z.boolean(),
  overrideReason: z.string().nullable(),
  overriddenBy: MemberRef.nullable(),
  /** Older than the firm's freshness setting: prompt to review. */
  stale: z.boolean(),
  createdAt: DateTime,
});
export type AdvisoryFinancialRow = z.infer<typeof AdvisoryFinancialRow>;

export const AdvisoryPlanRow = z.object({
  id: AdvisoryPlanId,
  advisoryClientId: AdvisoryClientId,
  client: ClientRef,
  name: z.string(),
  targetYear: z.number().int(),
  planType: z.string().nullable(),
  status: AdvisoryPlanStatus,
  advisor: MemberRef.nullable(),
  /** The wizard step the author is on, 1 to 5. */
  step: z.number().int().min(1).max(5),
  currentVersion: z.number().int(),
  finalizedAt: DateTime.nullable(),
  sentAt: DateTime.nullable(),
  /**
   * B10: the client's approval in the portal of the version sent for approval (who, when, which
   * version); null until they approve, and again after Modify Plan (a revision asks again).
   */
  clientApproval: z
    .object({
      version: z.number().int().min(1),
      approvedAt: DateTime,
      /** The client login's name. */
      approvedBy: z.string().nullable(),
    })
    .nullable(),
  /**
   * B10 (the lead's decision B): the client has an active portal login, so Finalize waits for
   * their approval (409 CLIENT_APPROVAL_REQUIRED until `clientApproval` is set; Send for Client
   * Approval instead). Without a login, Finalize works as before.
   */
  clientApprovalRequired: z.boolean(),
  archived: z.boolean(),
  updatedAt: DateTime,
});
export type AdvisoryPlanRow = z.infer<typeof AdvisoryPlanRow>;

export const AdvisoryRecommendationRow = z.object({
  id: AdvisoryRecommendationId,
  advisoryClientId: AdvisoryClientId,
  planId: AdvisoryPlanId.nullable(),
  goalId: AdvisoryGoalId.nullable(),
  title: z.string(),
  category: z.string().nullable(),
  rationale: z.string().nullable(),
  /** The words shown ("+15% Profit"), and the amount when it is money. */
  impactLabel: z.string().nullable(),
  impactCents: z.number().int().nullable(),
  status: AdvisoryRecommendationStatus,
  clientVisible: z.boolean(),
  decidedAt: DateTime.nullable(),
  createdBy: MemberRef.nullable(),
  updatedAt: DateTime,
});
export type AdvisoryRecommendationRow = z.infer<typeof AdvisoryRecommendationRow>;

export const AdvisoryActionItemRow = z.object({
  id: AdvisoryActionItemId,
  advisoryClientId: AdvisoryClientId,
  client: ClientRef,
  planId: AdvisoryPlanId.nullable(),
  goalId: AdvisoryGoalId.nullable(),
  milestoneId: AdvisoryMilestoneId.nullable(),
  title: z.string(),
  details: z.string().nullable(),
  assigneeKind: AdvisoryAssigneeKind,
  assignee: MemberRef.nullable(),
  dueOn: CalendarDate.nullable(),
  priority: AdvisoryPriority,
  status: AdvisoryActionStatus,
  /** A past due date on an open item. */
  overdue: z.boolean(),
  clientVisible: z.boolean(),
  completedAt: DateTime.nullable(),
  updatedAt: DateTime,
});
export type AdvisoryActionItemRow = z.infer<typeof AdvisoryActionItemRow>;

export const AdvisoryMilestone = z.object({
  id: AdvisoryMilestoneId,
  goalId: AdvisoryGoalId,
  title: z.string(),
  targetDate: CalendarDate.nullable(),
  status: AdvisoryGoalStatus,
  progressPercent: z.number().int(),
  owner: MemberRef.nullable(),
  sortOrder: z.number().int(),
  completedAt: DateTime.nullable(),
});
export type AdvisoryMilestone = z.infer<typeof AdvisoryMilestone>;

export const AdvisoryPlanDetail = AdvisoryPlanRow.extend({
  profile: AdvisoryPlanProfile,
  assessment: AdvisoryPlanAssessment,
  strategy: AdvisoryPlanStrategy,
  /** Stage 2's numbers: null without "View financial analysis". */
  financials: z.array(AdvisoryFinancialRow).nullable(),
  goals: z.array(AdvisoryGoalRow),
  recommendations: z.array(AdvisoryRecommendationRow),
  actionItems: z.array(AdvisoryActionItemRow),
  workstreams: z.array(AdvisoryWorkstream),
  /** The newest source figure's date: shown with the plan, with a prompt when stale. */
  sourceDataAsOf: CalendarDate.nullable(),
  staleFinancials: z.boolean(),
  disclaimer: z.string(),
  canEdit: z.boolean(),
  canOverride: z.boolean(),
  canSend: z.boolean(),
  createdAt: DateTime,
  /** Send it back on a change: 409 SAVE_CONFLICT when someone saved after it was loaded. */
  etag: z.string(),
});
export type AdvisoryPlanDetail = z.infer<typeof AdvisoryPlanDetail>;

export const AdvisoryPlansQuery = z.strictObject({
  advisoryClientId: AdvisoryClientId.optional(),
  status: AdvisoryPlanStatus.optional(),
  targetYear: QueryYear.optional(),
  planType: z.string().max(60).optional(),
  advisorUserId: z.uuid().optional(),
  search: SearchText.optional(),
  includeArchived: z.union([z.boolean(), z.stringbool()]).optional(),
  page: z.coerce.number().int().min(1).optional().default(1),
  pageSize: z.coerce.number().int().min(1).max(100).optional().default(25),
});
export type AdvisoryPlansQuery = z.input<typeof AdvisoryPlansQuery>;
export const AdvisoryPlanPage = z.object({ items: z.array(AdvisoryPlanRow).max(100), ...Page });
export type AdvisoryPlanPage = z.infer<typeof AdvisoryPlanPage>;

/** POST .../plans: stage 1 saves a DRAFT; nothing is sent. The client must be one the caller reaches. */
export const CreateAdvisoryPlanRequest = z.strictObject({
  advisoryClientId: AdvisoryClientId,
  name: text(200),
  targetYear: Year,
  planType: clearable(text(60)),
  profile: AdvisoryPlanProfile.optional(),
});
export type CreateAdvisoryPlanRequest = z.input<typeof CreateAdvisoryPlanRequest>;

/**
 * PATCH .../plans/{id}: the fields of any stage; only what is sent changes. The three documents
 * (`profile`, `assessment`, `strategy`) are merged at their top-level keys: a key sent replaces
 * that part, a key not sent stays. `step` records the wizard step. `etag` guards a concurrent
 * save. A change of status follows POST .../status.
 */
export const UpdateAdvisoryPlanRequest = z
  .strictObject({
    name: text(200).optional(),
    targetYear: Year.optional(),
    planType: clearable(text(60)),
    step: z.number().int().min(1).max(5).optional(),
    profile: AdvisoryPlanProfile.optional(),
    assessment: AdvisoryPlanAssessment.optional(),
    strategy: AdvisoryPlanStrategy.optional(),
    etag: Etag,
  })
  .refine(
    (o) => Object.keys(o).filter((k) => k !== 'etag').length > 0,
    'Change at least one field',
  );
export type UpdateAdvisoryPlanRequest = z.input<typeof UpdateAdvisoryPlanRequest>;

/**
 * POST .../plans/{id}/status: DRAFT, IN_REVIEW, IN_PROGRESS and COMPLETED are set here; FINALIZED
 * and SENT only by finalize and send; AWAITING_CLIENT_APPROVAL only by request-approval (B10);
 * ARCHIVED by archive. DRAFT from FINALIZED, SENT or AWAITING_CLIENT_APPROVAL is Modify Plan: the
 * next revision, with the client's approval cleared. 409 INVALID_STATUS when the move does not fit.
 */
export const SetAdvisoryPlanStatusRequest = z.strictObject({
  status: z.enum(['DRAFT', 'IN_REVIEW', 'IN_PROGRESS', 'COMPLETED']),
  etag: Etag,
});
export type SetAdvisoryPlanStatusRequest = z.input<typeof SetAdvisoryPlanStatusRequest>;

/**
 * POST .../plans/{id}/finalize (Stage 5; B10: for a client with an active portal login, only once
 * the client approved the plan, else 409 CLIENT_APPROVAL_REQUIRED): keeps an immutable version
 * (profile, assessment, strategy, goals, recommendations, service workstreams, financial
 * assumptions and the source data date). 409 PLAN_NOT_READY with what is missing (a required
 * part, a stale or missing figure). POST .../send delivers the client-facing version by the
 * channel (`PORTAL`, `EMAIL`, `DOWNLOAD`) and records who, when and how; only client-visible
 * recommendations and action items are in it, and it needs "Send plans" (403 FORBIDDEN).
 */
export const FinalizeAdvisoryPlanRequest = z.strictObject({ etag: Etag });
export type FinalizeAdvisoryPlanRequest = z.input<typeof FinalizeAdvisoryPlanRequest>;
export const SendAdvisoryPlanRequest = z.strictObject({
  channel: z.enum(['PORTAL', 'EMAIL', 'DOWNLOAD']),
  version: AdvisoryVersionNumber.optional(),
  message: clearable(text(2_000, 'many')),
});
export type SendAdvisoryPlanRequest = z.input<typeof SendAdvisoryPlanRequest>;

/**
 * POST .../plans/{id}/send-preview (A-X13, Business Advisory Review Two: the recipient and the
 * channel shown before a send): what Send would deliver and to whom, and every check that would
 * refuse it. Takes what Send takes; nothing is sent and nothing is audited. "Send plans" is
 * needed, as for Send (403).
 */
export const AdvisoryPlanSendPreview = z.object({
  channel: SendAdvisoryPlanRequest.shape.channel,
  /** The version Send would deliver, or null while none is finalized. */
  version: AdvisoryVersionNumber.nullable(),
  /** Who it goes to: the client, and their portal login's email (null without an active login). */
  to: z.object({ name: z.string(), email: z.string().nullable() }),
  subject: z.string(),
  body: z.string(),
  /** False while any problem below refuses it: Send answers 409 with the first one's code. */
  eligible: z.boolean(),
  problems: z.array(
    z.object({
      code: z.enum(['PLAN_ARCHIVED', 'CLIENT_ARCHIVED', 'INVALID_STATUS', 'PLAN_NOT_READY']),
      message: z.string(),
    }),
  ),
  /** What never refuses it but is worth knowing (no portal login yet; a download reaches no one). */
  notes: z.array(z.string()),
});
export type AdvisoryPlanSendPreview = z.infer<typeof AdvisoryPlanSendPreview>;

/**
 * POST .../plans/{id}/request-approval (B10, Business Advisory review §16: staff review, then the
 * client's approval BEFORE finalization). Only a plan in staff review (IN_REVIEW), ready as
 * finalize requires (409 PLAN_NOT_READY), for a client with an active portal login (409
 * NO_PORTAL_LOGIN). Keeps the version the client is asked to approve (delivered to the portal),
 * moves the plan to AWAITING_CLIENT_APPROVAL (locked) and sends the client a portal message with
 * the link. The client's Approve finalizes exactly that version; Modify Plan (DRAFT) withdraws it.
 * Needs "Send plans" (403 FORBIDDEN). Audited.
 */
export const RequestAdvisoryPlanApprovalRequest = z.strictObject({
  etag: Etag,
  message: clearable(text(2_000, 'many')),
});
export type RequestAdvisoryPlanApprovalRequest = z.input<typeof RequestAdvisoryPlanApprovalRequest>;

export const AdvisoryVersionRow = z.object({
  versionNo: z.number().int(),
  sourceDataAsOf: CalendarDate.nullable(),
  createdBy: MemberRef.nullable(),
  createdAt: DateTime,
  deliveredAt: DateTime.nullable(),
  deliveredChannel: z.string().nullable(),
  deliveredBy: MemberRef.nullable(),
});
export type AdvisoryVersionRow = z.infer<typeof AdvisoryVersionRow>;
export const AdvisoryVersionList = z.object({ items: z.array(AdvisoryVersionRow) });
export type AdvisoryVersionList = z.infer<typeof AdvisoryVersionList>;

/** One snapshot, as it was kept: later edits never change it. */
export const AdvisoryVersionDetail = AdvisoryVersionRow.extend({
  planName: z.string(),
  targetYear: z.number().int(),
  profile: AdvisoryPlanProfile,
  assessment: AdvisoryPlanAssessment,
  strategy: AdvisoryPlanStrategy,
  goals: z.array(
    z.object({
      title: z.string(),
      area: z.string().nullable(),
      targetDate: CalendarDate.nullable(),
      status: AdvisoryGoalStatus,
    }),
  ),
  recommendations: z.array(
    z.object({
      title: z.string(),
      rationale: z.string().nullable(),
      impactLabel: z.string().nullable(),
      status: AdvisoryRecommendationStatus,
    }),
  ),
  workstreams: z.array(
    z.object({ serviceName: z.string(), status: AdvisoryServiceStatus, role: AdvisoryServiceRole }),
  ),
  /** The figures and assumptions used; null without "View financial analysis". */
  financials: z.array(AdvisoryFinancialRow).nullable(),
  disclaimer: z.string(),
});
export type AdvisoryVersionDetail = z.infer<typeof AdvisoryVersionDetail>;

// ---------- Financial analysis ----------

/**
 * POST .../clients/{id}/financials (Stage 2 and the Financials tab): a snapshot of the period, in
 * cents, with its source and as-of date. Net profit is revenue minus expenses when both are given
 * (409 INCONSISTENT_FIGURES when a given net profit differs). Rows are never edited: a correction
 * is a new row. Replacing figures that came from a source (bookkeeping, payroll, bank) is an
 * override: `override.reason` is required, the person and reason are kept, and the earlier row
 * stays (403 OVERRIDE_NOT_ALLOWED without the permission). Needs "View financial analysis".
 * A-X09 (B27): `corrects` makes it a correction of one of the client's rows: the same period (400
 * otherwise; another client's or firm's row is 404) and a reason, kept on the new row and audited
 * with the figures before and after. The earlier row stays and shows with Show corrections.
 */
export const CreateAdvisoryFinancialRequest = z
  .strictObject({
    planId: AdvisoryPlanId.nullable().optional(),
    periodStart: CalendarDate,
    periodEnd: CalendarDate,
    revenueCents: Cents.nullable().optional(),
    expensesCents: Cents.nullable().optional(),
    netProfitCents: SignedCents.nullable().optional(),
    cashFlowCents: SignedCents.nullable().optional(),
    debtCents: Cents.nullable().optional(),
    budgetRevenueCents: Cents.nullable().optional(),
    budgetExpensesCents: Cents.nullable().optional(),
    headcount: z.number().int().min(0).max(1_000_000).nullable().optional(),
    source: AdvisoryFinancialSource.optional().default('MANUAL'),
    asOf: CalendarDate,
    override: z.strictObject({ reason: text(500, 'many') }).optional(),
    corrects: z.strictObject({ snapshotId: z.uuid(), reason: text(500, 'many') }).optional(),
  })
  .refine((o) => o.periodStart <= o.periodEnd, 'The period must start on or before it ends')
  .refine(
    (o) =>
      [
        o.revenueCents,
        o.expensesCents,
        o.netProfitCents,
        o.cashFlowCents,
        o.debtCents,
        o.headcount,
      ].some((v) => v != null),
    'Enter at least one figure',
  );
export type CreateAdvisoryFinancialRequest = z.input<typeof CreateAdvisoryFinancialRequest>;

/** GET .../financials (the Financial Analysis tab): the latest snapshot per client and period, with trends. */
export const AdvisoryFinancialsQuery = z.strictObject({
  advisoryClientId: AdvisoryClientId.optional(),
  planId: AdvisoryPlanId.optional(),
  source: AdvisoryFinancialSource.optional(),
  from: CalendarDate.optional(),
  to: CalendarDate.optional(),
  includeSuperseded: z.union([z.boolean(), z.stringbool()]).optional(),
  page: z.coerce.number().int().min(1).optional().default(1),
  pageSize: z.coerce.number().int().min(1).max(100).optional().default(25),
});
export type AdvisoryFinancialsQuery = z.input<typeof AdvisoryFinancialsQuery>;
export const AdvisoryFinancialPage = z.object({
  items: z.array(AdvisoryFinancialRow.extend({ client: ClientRef })).max(100),
  /** Totals over the filtered rows, only for the meaningful columns; budget vs actual when budgets exist. */
  summary: z.object({
    revenueCents: z.number().int().nullable(),
    expensesCents: z.number().int().nullable(),
    netProfitCents: z.number().int().nullable(),
    budgetRevenueCents: z.number().int().nullable(),
    budgetVarianceCents: z.number().int().nullable(),
  }),
  ...Page,
});
export type AdvisoryFinancialPage = z.infer<typeof AdvisoryFinancialPage>;

// ---------- Goals and milestones ----------

export const AdvisoryGoalDetail = AdvisoryGoalRow.extend({
  description: z.string().nullable(),
  milestones: z.array(AdvisoryMilestone),
  recommendationIds: z.array(AdvisoryRecommendationId),
  actionItemIds: z.array(AdvisoryActionItemId),
  completedAt: DateTime.nullable(),
  /** Send it back on a change: 409 SAVE_CONFLICT. */
  etag: z.string(),
});
export type AdvisoryGoalDetail = z.infer<typeof AdvisoryGoalDetail>;

export const AdvisoryGoalsQuery = z.strictObject({
  advisoryClientId: AdvisoryClientId.optional(),
  planId: AdvisoryPlanId.optional(),
  status: AdvisoryGoalStatus.optional(),
  area: z.string().max(60).optional(),
  ownerUserId: z.uuid().optional(),
  dueBefore: CalendarDate.optional(),
  search: SearchText.optional(),
  includeArchived: z.union([z.boolean(), z.stringbool()]).optional(),
  /** B25 (Octavia, Oct 25): Active (the default), Archived only, or All. Wins over includeArchived. */
  view: z.enum(['active', 'archived', 'all']).optional(),
  sort: z
    .enum(['targetDate', 'title', 'status', 'progress', 'updated'])
    .optional()
    .default('targetDate'),
  direction: z.enum(['asc', 'desc']).optional().default('asc'),
  page: z.coerce.number().int().min(1).optional().default(1),
  pageSize: z.coerce.number().int().min(1).max(100).optional().default(25),
});
export type AdvisoryGoalsQuery = z.input<typeof AdvisoryGoalsQuery>;
export const AdvisoryGoalPage = z.object({ items: z.array(AdvisoryGoalRow).max(100), ...Page });
export type AdvisoryGoalPage = z.infer<typeof AdvisoryGoalPage>;

/** POST .../goals (Add Business Goal). The plan and the workstream, when given, are the client's own. */
export const CreateAdvisoryGoalRequest = z.strictObject({
  advisoryClientId: AdvisoryClientId,
  planId: AdvisoryPlanId.nullable().optional(),
  workstreamId: AdvisoryWorkstreamId.nullable().optional(),
  title: text(300),
  description: clearable(text(2_000, 'many')),
  area: clearable(text(60)),
  targetDate: CalendarDate.nullable().optional(),
  ownerUserId: z.uuid().nullable().optional(),
  status: AdvisoryGoalStatus.optional().default('NOT_STARTED'),
  progressPercent: z.number().int().min(0).max(100).optional().default(0),
  milestones: z
    .array(
      z.strictObject({
        title: text(300),
        targetDate: CalendarDate.nullable().optional(),
        ownerUserId: z.uuid().nullable().optional(),
      }),
    )
    .max(30)
    .optional()
    .default([]),
});
export type CreateAdvisoryGoalRequest = z.input<typeof CreateAdvisoryGoalRequest>;

/**
 * PATCH .../goals/{id}: the fields sent change. COMPLETED sets progress to 100 and the completion
 * time; progress under 100 on a COMPLETED goal, or a past target date on an open one, is shown as
 * OVERDUE when read. `etag` guards a concurrent save.
 */
export const UpdateAdvisoryGoalRequest = z
  .strictObject({
    planId: AdvisoryPlanId.nullable().optional(),
    workstreamId: AdvisoryWorkstreamId.nullable().optional(),
    title: text(300).optional(),
    description: clearable(text(2_000, 'many')),
    area: clearable(text(60)),
    targetDate: CalendarDate.nullable().optional(),
    ownerUserId: z.uuid().nullable().optional(),
    status: AdvisoryGoalStatus.optional(),
    progressPercent: z.number().int().min(0).max(100).optional(),
    etag: Etag,
  })
  .refine(
    (o) => Object.keys(o).filter((k) => k !== 'etag').length > 0,
    'Change at least one field',
  );
export type UpdateAdvisoryGoalRequest = z.input<typeof UpdateAdvisoryGoalRequest>;

/** POST .../goals/{id}/milestones, PATCH .../milestones/{id}, PUT .../goals/{id}/milestones/order. */
export const CreateAdvisoryMilestoneRequest = z.strictObject({
  title: text(300),
  targetDate: CalendarDate.nullable().optional(),
  ownerUserId: z.uuid().nullable().optional(),
  status: AdvisoryGoalStatus.optional().default('NOT_STARTED'),
  progressPercent: z.number().int().min(0).max(100).optional().default(0),
});
export type CreateAdvisoryMilestoneRequest = z.input<typeof CreateAdvisoryMilestoneRequest>;
export const UpdateAdvisoryMilestoneRequest = z
  .strictObject({
    title: text(300).optional(),
    targetDate: CalendarDate.nullable().optional(),
    ownerUserId: z.uuid().nullable().optional(),
    status: AdvisoryGoalStatus.optional(),
    progressPercent: z.number().int().min(0).max(100).optional(),
  })
  .refine((o) => Object.keys(o).length > 0, 'Change at least one field');
export type UpdateAdvisoryMilestoneRequest = z.input<typeof UpdateAdvisoryMilestoneRequest>;
export const ReorderAdvisoryMilestonesRequest = z.strictObject({
  ids: z.array(AdvisoryMilestoneId).min(1).max(100),
});
export type ReorderAdvisoryMilestonesRequest = z.input<typeof ReorderAdvisoryMilestonesRequest>;

// ---------- Recommendations and action items (Action Plans) ----------

export const AdvisoryRecommendationsQuery = z.strictObject({
  advisoryClientId: AdvisoryClientId.optional(),
  planId: AdvisoryPlanId.optional(),
  goalId: AdvisoryGoalId.optional(),
  status: AdvisoryRecommendationStatus.optional(),
  clientVisible: z.union([z.boolean(), z.stringbool()]).optional(),
  search: SearchText.optional(),
  page: z.coerce.number().int().min(1).optional().default(1),
  pageSize: z.coerce.number().int().min(1).max(100).optional().default(25),
});
export type AdvisoryRecommendationsQuery = z.input<typeof AdvisoryRecommendationsQuery>;
export const AdvisoryRecommendationPage = z.object({
  items: z.array(AdvisoryRecommendationRow).max(100),
  ...Page,
});
export type AdvisoryRecommendationPage = z.infer<typeof AdvisoryRecommendationPage>;

/** Needs "Manage recommendations". Only a client-visible one reaches the portal or a sent plan. */
export const CreateAdvisoryRecommendationRequest = z.strictObject({
  advisoryClientId: AdvisoryClientId,
  planId: AdvisoryPlanId.nullable().optional(),
  goalId: AdvisoryGoalId.nullable().optional(),
  title: text(300),
  category: clearable(text(60)),
  rationale: clearable(text(3_000, 'many')),
  impactLabel: clearable(text(100)),
  impactCents: SignedCents.nullable().optional(),
  clientVisible: z.boolean().optional().default(false),
});
export type CreateAdvisoryRecommendationRequest = z.input<
  typeof CreateAdvisoryRecommendationRequest
>;
export const UpdateAdvisoryRecommendationRequest = z
  .strictObject({
    planId: AdvisoryPlanId.nullable().optional(),
    goalId: AdvisoryGoalId.nullable().optional(),
    title: text(300).optional(),
    category: clearable(text(60)),
    rationale: clearable(text(3_000, 'many')),
    impactLabel: clearable(text(100)),
    impactCents: SignedCents.nullable().optional(),
    status: AdvisoryRecommendationStatus.optional(),
    clientVisible: z.boolean().optional(),
  })
  .refine((o) => Object.keys(o).length > 0, 'Change at least one field');
export type UpdateAdvisoryRecommendationRequest = z.input<
  typeof UpdateAdvisoryRecommendationRequest
>;

export const AdvisoryActionItemsQuery = z.strictObject({
  advisoryClientId: AdvisoryClientId.optional(),
  planId: AdvisoryPlanId.optional(),
  goalId: AdvisoryGoalId.optional(),
  status: AdvisoryActionStatus.optional(),
  assigneeKind: AdvisoryAssigneeKind.optional(),
  assigneeUserId: z.uuid().optional(),
  overdue: z.union([z.boolean(), z.stringbool()]).optional(),
  dueBefore: CalendarDate.optional(),
  search: SearchText.optional(),
  page: z.coerce.number().int().min(1).optional().default(1),
  pageSize: z.coerce.number().int().min(1).max(100).optional().default(25),
});
export type AdvisoryActionItemsQuery = z.input<typeof AdvisoryActionItemsQuery>;
export const AdvisoryActionItemPage = z.object({
  items: z.array(AdvisoryActionItemRow).max(100),
  ...Page,
});
export type AdvisoryActionItemPage = z.infer<typeof AdvisoryActionItemPage>;

/** `assigneeUserId` goes with STAFF only (a member of the firm, 409 NOT_A_MEMBER otherwise). */
export const CreateAdvisoryActionItemRequest = z
  .strictObject({
    advisoryClientId: AdvisoryClientId,
    planId: AdvisoryPlanId.nullable().optional(),
    goalId: AdvisoryGoalId.nullable().optional(),
    milestoneId: AdvisoryMilestoneId.nullable().optional(),
    title: text(300),
    details: clearable(text(2_000, 'many')),
    assigneeKind: AdvisoryAssigneeKind.optional().default('STAFF'),
    assigneeUserId: z.uuid().nullable().optional(),
    dueOn: CalendarDate.nullable().optional(),
    priority: AdvisoryPriority.optional().default('NORMAL'),
    clientVisible: z.boolean().optional().default(false),
  })
  .refine(
    (o) => o.assigneeKind === 'STAFF' || o.assigneeUserId == null,
    'Only a staff action item names a person',
  );
export type CreateAdvisoryActionItemRequest = z.input<typeof CreateAdvisoryActionItemRequest>;
export const UpdateAdvisoryActionItemRequest = z
  .strictObject({
    planId: AdvisoryPlanId.nullable().optional(),
    goalId: AdvisoryGoalId.nullable().optional(),
    milestoneId: AdvisoryMilestoneId.nullable().optional(),
    title: text(300).optional(),
    details: clearable(text(2_000, 'many')),
    assigneeKind: AdvisoryAssigneeKind.optional(),
    assigneeUserId: z.uuid().nullable().optional(),
    dueOn: CalendarDate.nullable().optional(),
    priority: AdvisoryPriority.optional(),
    status: AdvisoryActionStatus.optional(),
    clientVisible: z.boolean().optional(),
  })
  .refine((o) => Object.keys(o).length > 0, 'Change at least one field');
export type UpdateAdvisoryActionItemRequest = z.input<typeof UpdateAdvisoryActionItemRequest>;

/**
 * GET .../action-items/{id}/notes (A-X11, Business Advisory Review Two B30): the item's progress
 * notes, newest first: what was done, the item's status then, who wrote it and when. The firm's
 * only (never in the portal); kept, never edited or deleted.
 */
export const AdvisoryActionNote = z.object({
  id: z.uuid(),
  body: z.string(),
  status: AdvisoryActionStatus,
  author: MemberRef.nullable(),
  at: DateTime,
});
export type AdvisoryActionNote = z.infer<typeof AdvisoryActionNote>;
export const AdvisoryActionNoteList = z.object({ items: z.array(AdvisoryActionNote).max(200) });
export type AdvisoryActionNoteList = z.infer<typeof AdvisoryActionNoteList>;
/**
 * POST .../action-items/{id}/notes: a progress note and, optionally, the item's new status with
 * it (the note then records the new one). Needs "Manage goals and tasks". 409 ITEM_CHANGED when
 * the item's status changed while the note was written.
 */
export const AddAdvisoryActionNoteRequest = z.strictObject({
  body: text(2_000, 'many'),
  status: AdvisoryActionStatus.optional(),
});
export type AddAdvisoryActionNoteRequest = z.input<typeof AddAdvisoryActionNoteRequest>;

// ---------- Meetings, resources, settings ----------

/** GET .../meetings: advisory appointments (Appointments tagged Business Advisory), read-only here; scheduling is in Appointments. */
export const AdvisoryMeetingsQuery = z.strictObject({
  advisoryClientId: AdvisoryClientId.optional(),
  when: z.enum(['upcoming', 'past', 'all']).optional().default('upcoming'),
  page: z.coerce.number().int().min(1).optional().default(1),
  pageSize: z.coerce.number().int().min(1).max(100).optional().default(25),
});
export type AdvisoryMeetingsQuery = z.input<typeof AdvisoryMeetingsQuery>;
export const AdvisoryMeetingPage = z.object({
  items: z.array(AdvisoryMeetingRow).max(100),
  ...Page,
});
export type AdvisoryMeetingPage = z.infer<typeof AdvisoryMeetingPage>;

export const AdvisoryResourcesQuery = z.strictObject({
  search: SearchText.optional(),
  category: z.string().max(60).optional(),
  clientFacing: z.union([z.boolean(), z.stringbool()]).optional(),
});
export type AdvisoryResourcesQuery = z.input<typeof AdvisoryResourcesQuery>;
export const AdvisoryResourceList = z.object({ items: z.array(AdvisoryResource) });
export type AdvisoryResourceList = z.infer<typeof AdvisoryResourceList>;

/**
 * POST .../resources/{key}/send: only a client-facing resource, to a client the caller reaches.
 * Needs "Send plans and resources". B28: `format` (default SECURE_LINK) must be one the resource
 * offers (409 FORMAT_NOT_AVAILABLE), and the client needs an active portal login, since both
 * formats open in the portal after sign-in (409 NO_PORTAL_LOGIN). PORTAL_MESSAGE: a portal message
 * and the usual "you have a message" email; EMAIL: the same message with its text in the email
 * (where the platform allows message text in email). POST .../preview answers what would be sent
 * and whether it can be, without sending.
 */
export const SendAdvisoryResourceRequest = z.strictObject({
  advisoryClientId: AdvisoryClientId,
  channel: z.enum(['PORTAL_MESSAGE', 'EMAIL']),
  format: AdvisoryResourceFormat.optional(),
  message: clearable(text(2_000, 'many')),
});
export type SendAdvisoryResourceRequest = z.input<typeof SendAdvisoryResourceRequest>;

/** POST .../resources/{key}/preview (B28): what the client would receive, and the checks. */
export const AdvisoryResourcePreview = z.object({
  channel: z.enum(['PORTAL_MESSAGE', 'EMAIL']),
  format: AdvisoryResourceFormat,
  /** Who it goes to: the client, and the email address of their portal login (null without one). */
  to: z.object({ name: z.string(), email: z.string().nullable() }),
  subject: z.string(),
  body: z.string(),
  /** False while any check below refuses it: Send answers 409 with the first one's code. */
  eligible: z.boolean(),
  problems: z.array(
    z.object({
      code: z.enum([
        'CLIENT_ARCHIVED',
        'RESOURCE_NOT_CLIENT_FACING',
        'FORMAT_NOT_AVAILABLE',
        'NO_PORTAL_LOGIN',
        // A-X10: the resource's file is still being checked for viruses, or failed the check.
        'FILE_NOT_READY',
      ]),
      message: z.string(),
    }),
  ),
});
export type AdvisoryResourcePreview = z.infer<typeof AdvisoryResourcePreview>;

/**
 * GET and PUT .../settings (Advisory Admin): how the Business Health Score is calculated (factor
 * weights summing to 100, so the score is explainable and configurable) and when financial
 * figures count as stale. Changing the formula changes new calculations only; each score keeps the
 * factors it was made from.
 */
export const AdvisorySettingsView = z.object({
  healthFormula: z.array(
    z.object({
      factor: z.string(),
      label: z.string(),
      weight: z.number().int(),
      explanation: z.string(),
    }),
  ),
  /** The factors the API can compute; a formula uses only these. */
  availableFactors: z.array(
    z.object({ factor: z.string(), label: z.string(), explanation: z.string() }),
  ),
  staleFinancialsDays: z.number().int(),
  defaultAdvisor: MemberRef.nullable(),
  updatedAt: DateTime.nullable(),
});
export type AdvisorySettingsView = z.infer<typeof AdvisorySettingsView>;
export const SaveAdvisorySettingsRequest = z
  .strictObject({
    healthFormula: z
      .array(
        z.strictObject({
          factor: z.string().regex(/^[a-z][a-z0-9_]{1,59}$/),
          weight: z.number().int().min(0).max(100),
        }),
      )
      .min(1)
      .max(20)
      .refine((f) => f.reduce((n, x) => n + x.weight, 0) === 100, 'The weights add up to 100')
      .refine((f) => new Set(f.map((x) => x.factor)).size === f.length, 'Use each factor once')
      .optional(),
    staleFinancialsDays: z.number().int().min(7).max(730).optional(),
    defaultAdvisorUserId: z.uuid().nullable().optional(),
  })
  .refine((o) => Object.keys(o).length > 0, 'Change at least one field');
export type SaveAdvisorySettingsRequest = z.input<typeof SaveAdvisorySettingsRequest>;

/**
 * A-X02 (Business Advisory Review Two, B16): the industries a firm starts with, until it saves its
 * own list. "Other" is not one of them: the forms always add it, with Specify.
 */
export const ADVISORY_INDUSTRY_DEFAULTS: readonly string[] = [
  'Construction',
  'Retail',
  'Professional Services',
  'Healthcare',
  'Food & Beverage',
  'Transportation',
  'Beauty & Wellness',
  'Automotive',
  'Real Estate',
  'Technology',
  'Manufacturing',
  'Hospitality',
];

/**
 * GET .../industries (A-X02): the firm's industry choices for an advisory client and a plan, in
 * its order, archived ones included (marked). The built-in list (ids null) until the firm saves
 * its own. A client or plan keeps the text it was saved with: renaming or archiving one here never
 * rewrites it.
 */
export const AdvisoryIndustry = z.object({
  /** Null for a built-in one the firm has not saved yet. */
  id: z.uuid().nullable(),
  name: z.string(),
  archived: z.boolean(),
});
export type AdvisoryIndustry = z.infer<typeof AdvisoryIndustry>;
export const AdvisoryIndustryList = z.object({
  items: z.array(AdvisoryIndustry).max(200),
  /** False while the firm uses the built-in list. */
  custom: z.boolean(),
  /** Advisory Admin: may change the list. */
  canManage: z.boolean(),
});
export type AdvisoryIndustryList = z.infer<typeof AdvisoryIndustryList>;
/**
 * PUT .../industries (Advisory Admin): the whole list in its order. An item with `id` is one of
 * the firm's (404 otherwise), renamed, archived or restored; one without is added. A saved one
 * left out is archived, never deleted. Live names once each, ignoring case (409
 * DUPLICATE_INDUSTRY on a race); "Other" is always offered and is not saved.
 */
export const SaveAdvisoryIndustriesRequest = z.strictObject({
  items: z
    .array(
      z.strictObject({
        id: z.uuid().optional(),
        name: text(80),
        archived: z.boolean().optional().default(false),
      }),
    )
    .min(1, 'Keep at least one industry')
    .max(100)
    .superRefine((items, ctx) => {
      const seen = new Set<string>();
      items.forEach((item, i) => {
        const key = item.name.trim().toLowerCase();
        if (key === 'other')
          ctx.addIssue({
            code: 'custom',
            path: [i, 'name'],
            message: 'Other is always offered, with Specify',
          });
        else if (!item.archived && seen.has(key))
          ctx.addIssue({
            code: 'custom',
            path: [i, 'name'],
            message: 'This industry is already in the list',
          });
        if (!item.archived) seen.add(key);
      });
    }),
});
export type SaveAdvisoryIndustriesRequest = z.input<typeof SaveAdvisoryIndustriesRequest>;

// ---------- Reports ----------

/**
 * GET .../reports (the Reports tab, guide §8): live counts over the advisory clients the caller
 * reaches (Staff: their own), optionally for one advisor. Clients, plans, goals and
 * recommendations by status; the services in use; action items and meetings; each advisor's
 * workload; and, with "View financial analysis", the yearly trend of the current (not superseded)
 * figures for the last three full calendar years, by period end (null without it). Archived clients and their records are left
 * out. A read: not audited. Saved and scheduled reports stay in the Reports module.
 */
export const AdvisoryReportsQuery = z.strictObject({ advisorUserId: z.uuid().optional() });
export type AdvisoryReportsQuery = z.input<typeof AdvisoryReportsQuery>;
const Tally = z.number().int().min(0);
const byStatus = <S extends z.ZodType>(status: S) =>
  z.array(z.object({ status, count: Tally })).max(20);
export const AdvisoryReports = z.object({
  generatedAt: DateTime,
  clients: z.object({ total: Tally, byStatus: byStatus(AdvisoryClientStatus) }),
  plans: z.object({
    total: Tally,
    byStatus: byStatus(AdvisoryPlanStatus),
    /** Versions delivered to clients since January 1 (the firm's calendar year). */
    sentThisYear: Tally,
  }),
  /** Each service an advisory client takes, from Services & Pricing. */
  services: z
    .array(
      z.object({
        serviceId: z.uuid(),
        name: z.string(),
        primary: Tally,
        additional: Tally,
        inProgress: Tally,
        completed: Tally,
      }),
    )
    .max(200),
  goals: z.object({
    total: Tally,
    byStatus: byStatus(AdvisoryGoalStatus),
    /** The average progress of open goals; null with none. */
    averageProgress: z.number().int().min(0).max(100).nullable(),
  }),
  recommendations: z.object({
    total: Tally,
    byStatus: byStatus(AdvisoryRecommendationStatus),
    /** The estimated impact of implemented ones, where given; null with none. */
    implementedImpactCents: z.number().int().nullable(),
  }),
  actionItems: z.object({
    open: Tally,
    overdue: Tally,
    doneLast30Days: Tally,
    byAssignee: z.array(z.object({ kind: AdvisoryAssigneeKind, open: Tally })).max(5),
  }),
  meetings: z.object({ upcoming30Days: Tally, past90Days: Tally }),
  /** Null without "View financial analysis"; oldest year first; a year without figures has nulls. */
  financialTrend: z
    .array(
      z.object({
        year: z.number().int(),
        clients: Tally,
        revenueCents: z.number().int().nullable(),
        expensesCents: z.number().int().nullable(),
        netProfitCents: z.number().int().nullable(),
      }),
    )
    .max(3)
    .nullable(),
  /** One row per advisor (null: clients with no advisor), most clients first. */
  advisorWorkload: z
    .array(
      z.object({
        advisor: MemberRef.nullable(),
        clients: Tally,
        activePlans: Tally,
        openGoals: Tally,
        openActionItems: Tally,
        upcomingMeetings: Tally,
      }),
    )
    .max(200),
  canViewFinancials: z.boolean(),
  disclaimer: z.string(),
});
export type AdvisoryReports = z.infer<typeof AdvisoryReports>;

// ---------- Errors ----------

export const AdvisoryErrorCode = z.enum([
  /** 409: the client is in the advisory program already. */
  'ALREADY_ADVISORY_CLIENT',
  /** 409: the service is on the client already. */
  'DUPLICATE_SERVICE',
  /** 409: someone saved after it was loaded. */
  'SAVE_CONFLICT',
  /** 409: the status change does not fit the current status. */
  'INVALID_STATUS',
  /** 409: the plan cannot be finalized or sent yet; the details name what is missing. */
  'PLAN_NOT_READY',
  /** 409: the plan is archived. */
  'PLAN_ARCHIVED',
  /** 409 (B9): a finalized or sent plan is locked; Modify Plan (status DRAFT) starts a revision. */
  'PLAN_LOCKED',
  /** 409: a given net profit differs from revenue minus expenses. */
  'INCONSISTENT_FIGURES',
  /** 403: overriding figures that came from a source needs the permission. */
  'OVERRIDE_NOT_ALLOWED',
  /** 403: the financial figures are restricted (View financial analysis). */
  'FINANCIALS_RESTRICTED',
  /** 409: the person is not an active member of the firm. */
  'NOT_A_MEMBER',
  /** 409: the resource is not client-facing and cannot be sent. */
  'RESOURCE_NOT_CLIENT_FACING',
  /** 409 (A-X10): a built-in resource is edited, never archived. */
  'RESOURCE_BUILT_IN',
  /** 409 (A-X10): the resource is archived. */
  'RESOURCE_ARCHIVED',
  /** 409 (A-X10): the resource's file is not ready (still checked, or blocked). */
  'FILE_NOT_READY',
  /** 409 (A-X10): the file is already on another resource. */
  'FILE_IN_USE',
  /** 409: the plan, goal or workstream is not this client's. */
  'NOT_THIS_CLIENT',
  /** 409 (B10, B28): the client has no active portal login, so the portal cannot reach them. */
  'NO_PORTAL_LOGIN',
  /** 409 (B28): the resource is not offered in that format. */
  'FORMAT_NOT_AVAILABLE',
  /**
   * 409 (B10, the lead's decision B): the client has a portal login, so they approve the plan
   * before it is finalized; send it for approval.
   */
  'CLIENT_APPROVAL_REQUIRED',
]);
export type AdvisoryErrorCode = z.infer<typeof AdvisoryErrorCode>;
