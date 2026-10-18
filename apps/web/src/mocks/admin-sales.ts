import { ApiRequestError } from '@firmivra/types';
import { mockDelay, mocked, mockedEmpty } from '../lib/mock';
import {
  seedSales,
  type SalesStore,
  type StoredOpportunity,
  type StoredStage,
} from './admin-sales-seed';

/**
 * Mock for the Super Admin Sales & Pipeline module (S04): the Sales Center, the pipeline board and
 * list, the pipeline builder and the opportunity record. There is no API or contract yet, so the
 * types and the client live here (module switch `adminSales`). One store holds every opportunity,
 * so the cards, the list, the KPIs, the analytics and the activity feeds always agree (the docx's
 * core rule). Every change writes an activity entry with its actor, as the audit trail would.
 * Outside mock mode every call fails like an unreachable API. NEXT_PUBLIC_API_MOCK_EMPTY=adminSales
 * starts with the default pipeline and no records. Synthetic data only.
 */

const MODULE = 'adminSales';
/** No Super Admin sales API yet: outside mock mode every call fails like an unreachable API. */
async function ready() {
  await mockDelay();
  if (!mocked(MODULE)) throw new TypeError('Failed to fetch');
}

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const uuid = (block: string, n: number) =>
  `0199d1a0-${block}-7000-8000-${String(n).padStart(12, '0')}`;
const copy = <T>(value: T): T => structuredClone(value);
const notFound = () => new ApiRequestError(404, 'NOT_FOUND', "We couldn't find that sales record.");

/* ------------------------------------------------------------------------------------------ */
/* Plans and prices: Firm Vera pricing and plan structure (value checked).                      */
/* ------------------------------------------------------------------------------------------ */

export type PlanId =
  'SOLO_CORE' | 'SOLO_PRO' | 'SOLO_ELITE' | 'TEAM_PRO' | 'BUSINESS' | 'ENTERPRISE';
export const PLAN_IDS: readonly PlanId[] = [
  'SOLO_CORE',
  'SOLO_PRO',
  'SOLO_ELITE',
  'TEAM_PRO',
  'BUSINESS',
  'ENTERPRISE',
];

const PRICING = {
  SOLO_CORE: { name: 'Solo Core', base: 6_900, users: 1, maxUsers: 1, perUser: 0, perLocation: 0 },
  SOLO_PRO: { name: 'Solo Pro', base: 9_900, users: 1, maxUsers: 1, perUser: 0, perLocation: 0 },
  SOLO_ELITE: {
    name: 'Solo Elite',
    base: 14_900,
    users: 1,
    maxUsers: 1,
    perUser: 0,
    perLocation: 0,
  },
  TEAM_PRO: {
    name: 'Team Pro',
    base: 19_900,
    users: 3,
    maxUsers: 10,
    perUser: 2_900,
    perLocation: 0,
  },
  BUSINESS: {
    name: 'Business',
    base: 49_900,
    users: 10,
    maxUsers: 20,
    perUser: 2_500,
    perLocation: 0,
  },
  ENTERPRISE: {
    name: 'Enterprise',
    base: 79_900,
    users: 20,
    maxUsers: 20,
    perUser: 0,
    perLocation: 14_900,
  },
} as const;

export const planName = (plan: PlanId) => PRICING[plan].name;
/** Extra users a plan can add: Team Pro users 4–10, Business users 11–20; none on the others. */
export const maxExtraUsers = (plan: PlanId) => PRICING[plan].maxUsers - PRICING[plan].users;
/** Enterprise only: locations after the three included (+$149 each). */
export const allowsExtraLocations = (plan: PlanId) => PRICING[plan].perLocation > 0;

/** The monthly price of a plan with its add-ons (extra users and locations), in cents. */
export function monthlyCents(plan: PlanId, extraUsers: number, extraLocations: number) {
  const price = PRICING[plan];
  return price.base + extraUsers * price.perUser + extraLocations * price.perLocation;
}

export interface SalesPlan {
  id: PlanId;
  name: string;
  /** The line under the name on the plan card. */
  tagline: string;
  /** ORGANIZE, AUTOMATE, GROW, COLLABORATE, GOVERN, SCALE. */
  outcome: string;
  whyUpgrade: string;
  priceCents: number;
  /** Enterprise "starts at". */
  priceFrom: boolean;
  capacity: string;
  expansion: string;
  locations: string;
  bestFit: string;
  /** The three ticks on the card. */
  highlights: [string, string, string];
  features: string[];
  upgradeTrigger: string;
  /** Enterprise has no self-serve trial: the card's button is Contact Sales. */
  trial: boolean;
}

function planCatalog(): SalesPlan[] {
  return [
    {
      id: 'SOLO_CORE',
      name: 'Solo Core',
      tagline: 'Perfect for solo practitioners',
      outcome: 'Organize',
      whyUpgrade: 'Put clients, work, documents and billing in one system.',
      priceCents: PRICING.SOLO_CORE.base,
      priceFrom: false,
      capacity: '1 user',
      expansion: '—',
      locations: '1 firm account',
      bestFit: 'Solo professional establishing a system',
      highlights: ['1 user', 'CRM, calendar and portal', 'Invoicing and payments'],
      features: [
        'CRM and client records',
        'Basic client pipeline',
        'Calendar and appointments',
        'Tasks, reminders and follow-ups',
        'Client portal',
        'Document storage and management',
        'Email communication',
        'Templates',
        'Basic reporting',
        'Invoicing and payments',
      ],
      upgradeTrigger:
        'Move to Solo Pro when manual follow-up, repetitive work and disconnected processes take too much time.',
      trial: true,
    },
    {
      id: 'SOLO_PRO',
      name: 'Solo Pro',
      tagline: 'For growing solo firms',
      outcome: 'Automate',
      whyUpgrade: 'Reduce manual follow-up and move work faster.',
      priceCents: PRICING.SOLO_PRO.base,
      priceFrom: false,
      capacity: '1 user',
      expansion: '—',
      locations: '1 firm account',
      bestFit: 'Solo professional ready to automate',
      highlights: ['1 user', 'Automations and e-sign', 'SMS and integrations'],
      features: [
        'Everything in Solo Core',
        'Automations and workflow tools',
        'Proposals and e-signatures',
        'Advanced pipeline tools',
        'SMS/texting',
        'Deeper reporting',
        'Integrations',
      ],
      upgradeTrigger:
        'Move to Solo Elite for stronger growth tools, advanced automation, AI and a branded client experience.',
      trial: true,
    },
    {
      id: 'SOLO_ELITE',
      name: 'Solo Elite',
      tagline: 'For established solo firms',
      outcome: 'Grow',
      whyUpgrade: 'Add advanced automation, AI, branding and growth tools.',
      priceCents: PRICING.SOLO_ELITE.base,
      priceFrom: false,
      capacity: '1 user',
      expansion: '—',
      locations: '1 firm account',
      bestFit: 'Solo professional wanting the full growth toolkit',
      highlights: ['1 user', 'AI and advanced analytics', 'Branding, priority support'],
      features: [
        'Everything in Solo Pro',
        'Advanced automation',
        'Advanced analytics',
        'Custom workflows',
        'AI features',
        'Marketing tools',
        'Custom firm branding',
        'Priority support',
        'Higher usage limits',
      ],
      upgradeTrigger:
        'Move to Team Pro when more than one person needs to work inside the same firm account.',
      trial: true,
    },
    {
      id: 'TEAM_PRO',
      name: 'Team Pro',
      tagline: 'For small teams',
      outcome: 'Collaborate',
      whyUpgrade: 'Turn the full solo system into a shared team workspace.',
      priceCents: PRICING.TEAM_PRO.base,
      priceFrom: false,
      capacity: '3 included; up to 10',
      expansion: 'Users 4–10: +$29/user/mo',
      locations: 'Single-firm team',
      bestFit: 'Small team that needs shared work and permissions',
      highlights: ['3 users, up to 10', 'Shared workspace', 'Roles and permissions'],
      features: [
        'Everything in Solo Elite',
        'Shared firm workspace',
        'Multiple staff accounts',
        'Shared client access and shared client pipeline',
        'Role-based access and permissions',
        'Client, task and work assignment across staff',
        'Team workflows and collaboration',
        'Shared calendar and appointments',
        'Firm-level document management',
        'Email and SMS communication',
        'Templates, proposals and e-signatures',
        'Automations and workflows',
        'Invoicing and payments',
        'Reports and basic firm analytics',
        'Integrations',
        'Firm branding',
      ],
      upgradeTrigger:
        'Move to Business when the owner needs departments, approvals, performance and standardized processes.',
      trial: true,
    },
    {
      id: 'BUSINESS',
      name: 'Business',
      tagline: 'For growing businesses',
      outcome: 'Govern',
      whyUpgrade:
        'Manage a larger firm with approvals, departments, analytics and stronger controls.',
      priceCents: PRICING.BUSINESS.base,
      priceFrom: false,
      capacity: '10 included; up to 20',
      expansion: 'Users 11–20: +$25/user/mo',
      locations: 'Single larger firm',
      bestFit: 'Firm needing governance and management controls',
      highlights: ['10 users, up to 20', 'Approvals and departments', 'Priority support'],
      features: [
        'Everything in Team Pro',
        'Advanced role and permission controls',
        'Department and team segmentation',
        'Advanced firm-wide reporting and analytics',
        'Approval workflows',
        'Expanded workflow controls',
        'Higher automation and usage limits',
        'Stronger administrative controls over staff and operations',
        'Expanded integrations',
        'Priority support',
      ],
      upgradeTrigger:
        'Move to Enterprise for multiple locations, centralized control, dedicated implementation or custom configuration.',
      trial: true,
    },
    {
      id: 'ENTERPRISE',
      name: 'Enterprise',
      tagline: 'For larger organizations',
      outcome: 'Scale',
      whyUpgrade:
        'Run multiple locations with centralized oversight, custom configuration and enterprise support.',
      priceCents: PRICING.ENTERPRISE.base,
      priceFrom: true,
      capacity: '20 total; up to 3 locations',
      expansion: '21+ users: rate to be set; +$149/location/mo from location 4',
      locations: 'Up to 3 included',
      bestFit: 'Multi-location or complex organization',
      highlights: ['20 users, 3 locations', 'Multi-location control', 'Dedicated account manager'],
      features: [
        'Everything in Business',
        'Multi-location management',
        'Multiple offices and departments',
        'Enterprise-level permissions',
        'Custom roles',
        'Higher or custom usage limits',
        'Advanced audit and activity logs',
        'Advanced enterprise reporting',
        'Custom workflows',
        'Priority onboarding',
        'Dedicated support/account management',
        'Custom integrations and configuration',
      ],
      upgradeTrigger: 'The top tier: add locations at $149 each from the fourth.',
      trial: false,
    },
  ];
}

/* ------------------------------------------------------------------------------------------ */
/* Lists the screens share.                                                                    */
/* ------------------------------------------------------------------------------------------ */

export const LEAD_SOURCES = [
  { id: 'WEBSITE', label: 'Website' },
  { id: 'REFERRAL', label: 'Referral' },
  { id: 'SOCIAL_MEDIA', label: 'Social Media' },
  { id: 'PAID_ADVERTISING', label: 'Paid Advertising' },
  { id: 'ORGANIC_SEARCH', label: 'Organic Search' },
  { id: 'EVENT', label: 'Event' },
  { id: 'PARTNER', label: 'Partner' },
  { id: 'MANUAL_ENTRY', label: 'Manual Entry' },
  { id: 'OTHER', label: 'Other' },
] as const;
export type LeadSource = (typeof LEAD_SOURCES)[number]['id'];
export const sourceLabel = (id: LeadSource) =>
  LEAD_SOURCES.find((source) => source.id === id)?.label ?? id;

export const LOST_REASONS = [
  { id: 'NOT_A_FIT', label: 'Not a Fit' },
  { id: 'BUDGET', label: 'Budget' },
  { id: 'NO_RESPONSE', label: 'No Response' },
  { id: 'CHOSE_COMPETITOR', label: 'Chose Competitor' },
  { id: 'TIMING', label: 'Timing' },
  { id: 'DUPLICATE', label: 'Duplicate' },
  { id: 'INVALID_LEAD', label: 'Invalid Lead' },
  { id: 'OTHER', label: 'Other' },
] as const;
export type LostReason = (typeof LOST_REASONS)[number]['id'];
export const lostReasonLabel = (id: LostReason) =>
  LOST_REASONS.find((reason) => reason.id === id)?.label ?? id;

export const APPOINTMENT_TYPES = [
  { id: 'DEMO', label: 'Demo' },
  { id: 'INITIAL_CONSULTATION', label: 'Initial Consultation' },
  { id: 'FOLLOW_UP', label: 'Follow-up' },
  { id: 'PROPOSAL_REVIEW', label: 'Proposal Review' },
  { id: 'TRIAL_CHECK_IN', label: 'Trial Check-in' },
  { id: 'CHECK_IN', label: 'Check-in' },
] as const;
export type AppointmentType = (typeof APPOINTMENT_TYPES)[number]['id'];
export const appointmentTypeLabel = (id: AppointmentType) =>
  APPOINTMENT_TYPES.find((type) => type.id === id)?.label ?? id;

/** Stage classification (docx §15): it decides which KPIs and sums a stage counts in. */
export type StageType = 'ACTIVE' | 'CONVERTED' | 'TRANSACTION' | 'CLOSED' | 'LOST';
export const STAGE_TYPES: readonly { id: StageType; label: string }[] = [
  { id: 'ACTIVE', label: 'Active pipeline' },
  { id: 'CONVERTED', label: 'Converted / client' },
  { id: 'TRANSACTION', label: 'Transaction-synced' },
  { id: 'CLOSED', label: 'Closed / success' },
  { id: 'LOST', label: 'Lost / exit' },
];

/** What a stage needs before a record may enter it (docx §12 "Dependent Validation"). */
export type StageRequirement = 'LOST_REASON' | 'TRANSACTION' | 'APPOINTMENT';
export const STAGE_REQUIREMENTS: readonly { id: StageRequirement; label: string }[] = [
  { id: 'LOST_REASON', label: 'Lost reason' },
  { id: 'TRANSACTION', label: 'Linked transaction' },
  { id: 'APPOINTMENT', label: 'Scheduled appointment' },
];

export type StageAutomation =
  'NONE' | 'NOTIFY_OWNER' | 'CREATE_FOLLOW_UP' | 'SEND_WELCOME_EMAIL' | 'START_ONBOARDING';
export const STAGE_AUTOMATIONS: readonly { id: StageAutomation; label: string }[] = [
  { id: 'NONE', label: 'No automation' },
  { id: 'NOTIFY_OWNER', label: 'Notify the owner' },
  { id: 'CREATE_FOLLOW_UP', label: 'Create a follow-up task' },
  { id: 'SEND_WELCOME_EMAIL', label: 'Send the welcome email' },
  { id: 'START_ONBOARDING', label: 'Start firm onboarding' },
];

export type StageTone =
  'blue' | 'grey' | 'sky' | 'purple' | 'amber' | 'lavender' | 'green' | 'teal' | 'mint' | 'red';
export const STAGE_TONES: readonly { id: StageTone; label: string }[] = [
  { id: 'blue', label: 'Blue' },
  { id: 'grey', label: 'Grey' },
  { id: 'sky', label: 'Sky' },
  { id: 'purple', label: 'Purple' },
  { id: 'amber', label: 'Amber' },
  { id: 'lavender', label: 'Lavender' },
  { id: 'green', label: 'Green' },
  { id: 'teal', label: 'Teal' },
  { id: 'mint', label: 'Mint' },
  { id: 'red', label: 'Red' },
];

/** The attention rules (docx §11) and their configured thresholds. */
export const ATTENTION_RULES = {
  /** A new lead with no outreach after this many hours. */
  noContactHours: 48,
  /** Attempts without a reply before "No response". */
  noResponseAttempts: 3,
  /** A follow-up due within this many hours. */
  followUpDueHours: 48,
  /** No qualifying activity for this many days. */
  noActivityDays: 14,
} as const;

export type AttentionFlag =
  'NO_CONTACT' | 'OVERDUE' | 'NO_RESPONSE' | 'FOLLOW_UP_DUE' | 'UNASSIGNED' | 'NO_ACTIVITY';
/** In order of importance: a card shows the first one it has. */
export const ATTENTION_FLAGS: readonly { id: AttentionFlag; label: string; counts: boolean }[] = [
  { id: 'NO_CONTACT', label: 'No contact yet', counts: true },
  { id: 'OVERDUE', label: 'Overdue', counts: true },
  { id: 'NO_RESPONSE', label: 'No response', counts: true },
  { id: 'UNASSIGNED', label: 'Unassigned', counts: true },
  { id: 'NO_ACTIVITY', label: 'No activity', counts: true },
  // Imminent, not late: shown on the card, not counted in Needs Attention.
  { id: 'FOLLOW_UP_DUE', label: 'Follow-up due', counts: false },
];

/** One formula for the Sales Center, the pipeline and Reports (docx §3, §18). */
export const CONVERSION_FORMULA =
  'Records in a converted, transaction or closed stage, divided by all records in the pipeline.';

export type SalesPeriod =
  'LAST_7_DAYS' | 'LAST_30_DAYS' | 'LAST_90_DAYS' | 'THIS_MONTH' | 'THIS_QUARTER' | 'THIS_YEAR';
export const PERIOD_LABELS: Record<SalesPeriod, string> = {
  LAST_7_DAYS: 'Last 7 Days',
  LAST_30_DAYS: 'Last 30 Days',
  LAST_90_DAYS: 'Last 90 Days',
  THIS_MONTH: 'This Month',
  THIS_QUARTER: 'This Quarter',
  THIS_YEAR: 'This Year',
};
/** A period, or a custom range of local dates (`YYYY-MM-DD`). */
export type PeriodInput = SalesPeriod | { from: string; to: string };

export type SalesView = 'CARD' | 'LIST';

/* ------------------------------------------------------------------------------------------ */
/* Records the screens read.                                                                   */
/* ------------------------------------------------------------------------------------------ */

export interface SalesRep {
  id: string;
  name: string;
  role: string;
}
export interface SalesTag {
  id: string;
  name: string;
}
export interface PipelineStage {
  id: string;
  name: string;
  type: StageType;
  tone: StageTone;
  active: boolean;
  requires: StageRequirement[];
  automation: StageAutomation;
}
export interface SalesPipeline {
  id: string;
  name: string;
  description: string;
  isDefault: boolean;
  stages: PipelineStage[];
  createdAt: string;
  updatedAt: string;
  /** Records per stage id. */
  recordCounts: Record<string, number>;
}
export interface LinkedTransaction {
  reference: string;
  status: 'OPEN' | 'UNDER_CONTRACT' | 'CLOSED' | 'TERMINATED';
  linkedAt: string;
  estimatedCloseAt: string | null;
  closedAt: string | null;
}
export interface SalesAppointment {
  id: string;
  opportunityId: string;
  firmName: string;
  contactName: string;
  type: AppointmentType;
  startsAt: string;
  assignedId: string | null;
  assignedName: string | null;
  status: 'SCHEDULED' | 'COMPLETED' | 'CANCELLED';
  createdAt: string;
}
export interface SalesOpportunity {
  id: string;
  pipelineId: string;
  stageId: string;
  stageName: string;
  stageType: StageType;
  stageTone: StageTone;
  /** 0-based place of the stage in its pipeline. */
  stageOrder: number;
  firmName: string;
  contactName: string;
  email: string | null;
  phone: string | null;
  /** Estimated annual value; null when none was given (never invented). */
  valueCents: number | null;
  plan: PlanId | null;
  extraUsers: number;
  extraLocations: number;
  /** The plan's monthly price with add-ons. */
  monthlyCents: number | null;
  source: LeadSource;
  owner: SalesRep | null;
  tags: SalesTag[];
  createdAt: string;
  stageEnteredAt: string;
  lastActivityAt: string;
  attempts: number;
  contactedAt: string | null;
  nextFollowUpAt: string | null;
  nextStep: string | null;
  trialStartedAt: string | null;
  trialEndsAt: string | null;
  convertedAt: string | null;
  closedAt: string | null;
  lostAt: string | null;
  lostReason: LostReason | null;
  lostNote: string | null;
  transaction: LinkedTransaction | null;
  attention: AttentionFlag[];
  nextAppointment: SalesAppointment | null;
}

export type ActivityKind =
  | 'CREATED'
  | 'STAGE_CHANGED'
  | 'ASSIGNED'
  | 'REASSIGNED'
  | 'APPOINTMENT_SCHEDULED'
  | 'FOLLOW_UP_ADDED'
  | 'FOLLOW_UP_COMPLETED'
  | 'OUTREACH_ATTEMPT'
  | 'CONTACTED'
  | 'TRIAL_STARTED'
  | 'PROPOSAL_SENT'
  | 'WON'
  | 'LOST'
  | 'TRANSACTION_LINKED'
  | 'UNDER_CONTRACT'
  | 'CLOSED'
  | 'TERMINATED'
  | 'NOTE_ADDED'
  | 'UPDATED'
  | 'AUTOMATION';
export interface SalesActor {
  kind: 'USER' | 'SYSTEM' | 'AUTOMATION';
  name: string;
}
export interface SalesActivity {
  id: string;
  opportunityId: string;
  firmName: string;
  kind: ActivityKind;
  /** "Moved Brightpath Tax to Attempted Contact". */
  text: string;
  actor: SalesActor;
  at: string;
  /** The plan price on trial, proposal and won entries. */
  valueCents: number | null;
  fromStage: string | null;
  toStage: string | null;
  /** Reasons, before/after values, transaction references. */
  detail: string | null;
}
export interface SalesNote {
  id: string;
  opportunityId: string;
  body: string;
  author: string;
  createdAt: string;
}
export interface SalesTask {
  id: string;
  opportunityId: string;
  title: string;
  dueAt: string;
  done: boolean;
  completedAt: string | null;
}
export interface SalesCommunication {
  id: string;
  opportunityId: string;
  channel: 'EMAIL' | 'CALL' | 'SMS';
  direction: 'OUTBOUND' | 'INBOUND';
  summary: string;
  at: string;
  by: string;
}
export interface SalesDocument {
  id: string;
  opportunityId: string;
  name: string;
  addedAt: string;
}

export interface SalesMeta {
  reps: SalesRep[];
  tags: SalesTag[];
  plans: { id: PlanId; name: string }[];
  pipelines: { id: string; name: string; isDefault: boolean }[];
  defaultPipelineId: string;
  /** Today as a local date (`YYYY-MM-DD`), for the default date range. */
  today: string;
  /** Centralized capabilities (docx §10): the screens never check role names. */
  permissions: { managePipelines: boolean; assign: boolean; bulkEdit: boolean; export: boolean };
}

export interface SalesTrend {
  direction: 'up' | 'down' | 'flat';
  percent: number;
}
export interface SalesMetric {
  value: number;
  trend: SalesTrend;
}
export interface CenterKpis {
  totalLeads: SalesMetric;
  demosScheduled: SalesMetric;
  activeTrials: SalesMetric;
  wonDeals: SalesMetric;
  lostDeals: SalesMetric;
  projectedMrrCents: SalesMetric;
}
export interface PipelineKpis {
  totalOpportunities: SalesMetric;
  inProgress: SalesMetric;
  pipelineValueCents: SalesMetric;
  conversionRate: SalesMetric;
  activeClients: number;
  needsAttention: number;
}
export interface StageCount {
  stageId: string;
  name: string;
  tone: StageTone;
  type: StageType;
  count: number;
  valueCents: number;
}
export interface RevenueSlice {
  id: 'SOLO' | 'TEAM_PRO' | 'BUSINESS' | 'ENTERPRISE' | 'ADD_ONS';
  label: string;
  cents: number;
}
export interface RevenueByPlan {
  totalCents: number;
  slices: RevenueSlice[];
}
export interface SourceShare {
  source: LeadSource;
  label: string;
  count: number;
  percent: number;
}

/** Which records a KPI card opens (docx §3: "Clicking filters to the relevant dataset"). */
export type OpportunityScope = 'IN_PROGRESS' | 'PIPELINE' | 'CONVERTED' | 'CLIENTS' | 'OPEN';
export interface OpportunityQuery {
  pipelineId?: string;
  search?: string;
  stageId?: string;
  ownerId?: string;
  plan?: PlanId;
  source?: LeadSource;
  tagId?: string;
  /** Local dates: records open at any time in the range (created by its end, not ended before its start). */
  from?: string;
  to?: string;
  overdueOnly?: boolean;
  unassignedOnly?: boolean;
  attentionOnly?: boolean;
  scope?: OpportunityScope;
}

export interface OpportunityRecord {
  opportunity: SalesOpportunity;
  pipeline: { id: string; name: string; stages: PipelineStage[] };
  notes: SalesNote[];
  tasks: SalesTask[];
  appointments: SalesAppointment[];
  communications: SalesCommunication[];
  documents: SalesDocument[];
  activity: SalesActivity[];
}

/* ------------------------------------------------------------------------------------------ */
/* Errors the forms show.                                                                      */
/* ------------------------------------------------------------------------------------------ */

/** VALIDATION_FAILED with a message per field, so each input shows its own error. */
export class SalesFieldError extends ApiRequestError {
  constructor(readonly fields: Record<string, string>) {
    super(400, 'VALIDATION_FAILED', Object.values(fields)[0] ?? 'The request is not valid');
    this.name = 'SalesFieldError';
  }
}
export interface DuplicateMatch {
  id: string;
  firmName: string;
  contactName: string;
  stageName: string;
  matchedOn: string;
}
/** A probable duplicate person or firm (docx §16): the form asks before creating another. */
export class SalesDuplicateError extends ApiRequestError {
  constructor(readonly matches: DuplicateMatch[]) {
    super(409, 'POSSIBLE_DUPLICATE', 'A similar record already exists.');
    this.name = 'SalesDuplicateError';
  }
}
export const fieldErrors = (error: unknown): Record<string, string> =>
  error instanceof SalesFieldError ? error.fields : {};

/* ------------------------------------------------------------------------------------------ */
/* The store.                                                                                  */
/* ------------------------------------------------------------------------------------------ */

/** The approved Firmivra lifecycle (docx §4), shipped as the default pipeline. */
function defaultStages(): StoredStage[] {
  const stage = (
    n: number,
    name: string,
    type: StageType,
    tone: StageTone,
    requires: StageRequirement[],
    automation: StageAutomation,
  ): StoredStage => ({ id: uuid('5a02', n), name, type, tone, active: true, requires, automation });
  return [
    stage(1, 'New Lead', 'ACTIVE', 'blue', [], 'NOTIFY_OWNER'),
    stage(2, 'Attempted Contact', 'ACTIVE', 'grey', [], 'CREATE_FOLLOW_UP'),
    stage(3, 'Contacted', 'ACTIVE', 'sky', [], 'NONE'),
    stage(4, 'Qualified', 'ACTIVE', 'purple', [], 'NONE'),
    stage(5, 'Appointment Set', 'ACTIVE', 'amber', ['APPOINTMENT'], 'NOTIFY_OWNER'),
    stage(6, 'Nurturing', 'ACTIVE', 'lavender', [], 'CREATE_FOLLOW_UP'),
    stage(7, 'Active Client', 'CONVERTED', 'green', [], 'START_ONBOARDING'),
    stage(8, 'Under Contract', 'TRANSACTION', 'teal', ['TRANSACTION'], 'NONE'),
    stage(9, 'Closed / Past Client', 'CLOSED', 'mint', ['TRANSACTION'], 'NONE'),
    stage(10, 'Unqualified / Lost', 'LOST', 'red', ['LOST_REASON'], 'NONE'),
  ];
}

let store: SalesStore | undefined;
/** Built on first use (mocks run nothing on import). */
function db(): SalesStore {
  store ??= seedSales({
    now: Date.now(),
    empty: mockedEmpty(MODULE),
    stages: defaultStages(),
    monthly: monthlyCents,
    maxExtraUsers,
    planName,
    lostReasonLabel,
    appointmentTypeLabel,
  });
  return store;
}

/** The signed-in Super Admin in mock mode (Morgan Admin) is the actor of every change. */
const ME: SalesActor = { kind: 'USER', name: 'Morgan Admin' };
const SYNC: SalesActor = { kind: 'SYSTEM', name: 'Transactions sync' };
const AUTOMATION: SalesActor = { kind: 'AUTOMATION', name: 'Pipeline automation' };

function nextId(block: string) {
  const s = db();
  s.next += 1;
  return uuid(block, s.next);
}

const iso = (ms: number) => new Date(ms).toISOString();
const time = (value: string | null) => (value ? Date.parse(value) : null);

function pipelineOf(id?: string) {
  const s = db();
  const pipeline = id
    ? s.pipelines.find((p) => p.id === id)
    : (s.pipelines.find((p) => p.isDefault) ?? s.pipelines[0]);
  if (!pipeline) throw notFound();
  return pipeline;
}

function stageInfo(opp: StoredOpportunity) {
  const pipeline = pipelineOf(opp.pipelineId);
  const order = pipeline.stages.findIndex((stage) => stage.id === opp.stageId);
  const stage = pipeline.stages[order] ?? pipeline.stages[0];
  if (!stage) throw notFound();
  return { pipeline, stage, order: Math.max(0, order) };
}

const isOpen = (type: StageType) =>
  type === 'ACTIVE' || type === 'CONVERTED' || type === 'TRANSACTION';
const isConverted = (type: StageType) =>
  type === 'CONVERTED' || type === 'TRANSACTION' || type === 'CLOSED';

function attentionOf(opp: StoredOpportunity, type: StageType, now: number): AttentionFlag[] {
  if (!isOpen(type)) return [];
  const flags = new Set<AttentionFlag>();
  const created = Date.parse(opp.createdAt);
  const follow = time(opp.nextFollowUpAt);
  if (
    type === 'ACTIVE' &&
    opp.attempts === 0 &&
    !opp.contactedAt &&
    now - created > ATTENTION_RULES.noContactHours * HOUR
  )
    flags.add('NO_CONTACT');
  if (follow !== null && follow < now) flags.add('OVERDUE');
  if (type === 'ACTIVE' && !opp.contactedAt && opp.attempts >= ATTENTION_RULES.noResponseAttempts)
    flags.add('NO_RESPONSE');
  if (!opp.ownerId) flags.add('UNASSIGNED');
  // Records still being worked; a converted client's quiet weeks are not a sales problem.
  if (
    type === 'ACTIVE' &&
    now - Date.parse(opp.lastActivityAt) > ATTENTION_RULES.noActivityDays * DAY
  )
    flags.add('NO_ACTIVITY');
  if (follow !== null && follow >= now && follow - now <= ATTENTION_RULES.followUpDueHours * HOUR)
    flags.add('FOLLOW_UP_DUE');
  return ATTENTION_FLAGS.map((flag) => flag.id).filter((id) => flags.has(id));
}

const needsAttention = (flags: AttentionFlag[]) =>
  flags.some((flag) => ATTENTION_FLAGS.find((rule) => rule.id === flag)?.counts);

function appointmentView(appointment: SalesAppointment): SalesAppointment {
  const s = db();
  const opp = s.opportunities.find((o) => o.id === appointment.opportunityId);
  const rep = s.reps.find((r) => r.id === appointment.assignedId);
  return {
    ...appointment,
    firmName: opp?.firmName ?? appointment.firmName,
    contactName: opp?.contactName ?? appointment.contactName,
    assignedName: rep?.name ?? null,
  };
}

function view(opp: StoredOpportunity, now: number): SalesOpportunity {
  const s = db();
  const { stage, order } = stageInfo(opp);
  const upcoming = s.appointments
    .filter((a) => a.opportunityId === opp.id && a.status === 'SCHEDULED')
    .filter((a) => Date.parse(a.startsAt) >= now)
    .sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt))[0];
  return {
    ...copy(opp),
    stageName: stage.name,
    stageType: stage.type,
    stageTone: stage.tone,
    stageOrder: order,
    monthlyCents: opp.plan ? monthlyCents(opp.plan, opp.extraUsers, opp.extraLocations) : null,
    owner: copy(s.reps.find((rep) => rep.id === opp.ownerId) ?? null),
    tags: s.tags.filter((tag) => opp.tagIds.includes(tag.id)).map(copy),
    attention: attentionOf(opp, stage.type, now),
    nextAppointment: upcoming ? appointmentView(upcoming) : null,
  };
}

function findOpportunity(id: string) {
  const opp = db().opportunities.find((o) => o.id === id);
  if (!opp) throw notFound();
  return opp;
}

function log(
  opp: StoredOpportunity,
  kind: ActivityKind,
  text: string,
  options: {
    actor?: SalesActor;
    at?: number;
    valueCents?: number | null;
    fromStage?: string | null;
    toStage?: string | null;
    detail?: string | null;
  } = {},
) {
  const at = options.at ?? Date.now();
  db().activities.unshift({
    id: nextId('5a05'),
    opportunityId: opp.id,
    firmName: opp.firmName,
    kind,
    text,
    actor: options.actor ?? ME,
    at: iso(at),
    valueCents: options.valueCents ?? null,
    fromStage: options.fromStage ?? null,
    toStage: options.toStage ?? null,
    detail: options.detail ?? null,
  });
  if (kind !== 'AUTOMATION') opp.lastActivityAt = iso(at);
}

/* ------------------------------------------------------------------------------------------ */
/* Periods and trends.                                                                         */
/* ------------------------------------------------------------------------------------------ */

const startOfDay = (ms: number) => {
  const date = new Date(ms);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
};
const localDate = (ms: number) => {
  const date = new Date(ms);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
};
const parseLocal = (value: string, endOfDay: boolean) => {
  const [year, month, day] = value.split('-').map(Number);
  if (!year || !month || !day) return null;
  return endOfDay
    ? new Date(year, month - 1, day, 23, 59, 59, 999).getTime()
    : new Date(year, month - 1, day).getTime();
};

interface Bounds {
  start: number;
  end: number;
}
function boundsOf(period: PeriodInput, now: number): Bounds {
  if (typeof period === 'object') {
    return {
      start: parseLocal(period.from, false) ?? 0,
      end: parseLocal(period.to, true) ?? now,
    };
  }
  const today = new Date(now);
  const days = { LAST_7_DAYS: 7, LAST_30_DAYS: 30, LAST_90_DAYS: 90 } as Record<string, number>;
  const last = days[period];
  if (last) return { start: startOfDay(now) - (last - 1) * DAY, end: now };
  if (period === 'THIS_MONTH')
    return {
      start: new Date(today.getFullYear(), today.getMonth(), 1).getTime(),
      end: new Date(today.getFullYear(), today.getMonth() + 1, 1).getTime() - 1,
    };
  if (period === 'THIS_QUARTER') {
    const first = today.getMonth() - (today.getMonth() % 3);
    return {
      start: new Date(today.getFullYear(), first, 1).getTime(),
      end: new Date(today.getFullYear(), first + 3, 1).getTime() - 1,
    };
  }
  return {
    start: new Date(today.getFullYear(), 0, 1).getTime(),
    end: new Date(today.getFullYear() + 1, 0, 1).getTime() - 1,
  };
}
/** The same length of time just before. */
const previousOf = ({ start, end }: Bounds): Bounds => ({
  start: start - (end - start) - 1,
  end: start - 1,
});
const within = (value: string | null, { start, end }: Bounds) => {
  const at = time(value);
  return at !== null && at >= start && at <= end;
};

function trendOf(current: number, previous: number): SalesTrend {
  if (current === previous) return { direction: 'flat', percent: 0 };
  if (previous === 0) return { direction: 'up', percent: 100 };
  return {
    direction: current > previous ? 'up' : 'down',
    percent: Math.round((Math.abs(current - previous) / previous) * 100),
  };
}
const metric = (current: number, previous: number): SalesMetric => ({
  value: current,
  trend: trendOf(current, previous),
});

/** Open at any time in the range: created by its end and not closed or lost before its start. */
function activeDuring(opp: StoredOpportunity, type: StageType, bounds: Bounds) {
  if (Date.parse(opp.createdAt) > bounds.end) return false;
  const ended = type === 'CLOSED' ? time(opp.closedAt) : type === 'LOST' ? time(opp.lostAt) : null;
  return ended === null || ended >= bounds.start;
}

/* ------------------------------------------------------------------------------------------ */
/* Validation.                                                                                 */
/* ------------------------------------------------------------------------------------------ */

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const TRANSACTION_REF = /^[A-Za-z0-9-]{3,30}$/;
const normalize = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, '');
const digits = (value: string) => value.replace(/\D/g, '');

export interface AppointmentInput {
  type: AppointmentType;
  /** Local `YYYY-MM-DD` and `HH:MM`. */
  date: string;
  time: string;
  assignedId: string | null;
}
/** The data a stage may require before a record enters it. */
export interface StageEntryInput {
  lostReason?: LostReason | null;
  lostNote?: string | null;
  transactionReference?: string | null;
  appointment?: AppointmentInput | null;
}

function appointmentStart(input: AppointmentInput) {
  const day = parseLocal(input.date, false);
  const [hours, minutes] = input.time.split(':').map(Number);
  if (day === null || hours === undefined || minutes === undefined) return null;
  if (Number.isNaN(hours) || Number.isNaN(minutes)) return null;
  return day + hours * HOUR + minutes * 60_000;
}

function checkAppointment(
  input: AppointmentInput | null | undefined,
  errors: Record<string, string>,
) {
  if (!input) {
    errors['appointmentDate'] = 'Choose the appointment date.';
    return;
  }
  if (!APPOINTMENT_TYPES.some((type) => type.id === input.type))
    errors['appointmentType'] = 'Choose the appointment type.';
  const start = appointmentStart(input);
  if (!input.date || start === null) errors['appointmentDate'] = 'Choose the appointment date.';
  else if (start < startOfDay(Date.now()))
    errors['appointmentDate'] = 'Choose today or a later date.';
  if (!/^\d{2}:\d{2}$/.test(input.time)) errors['appointmentTime'] = 'Choose a time.';
  if (input.assignedId && !db().reps.some((rep) => rep.id === input.assignedId))
    errors['appointmentAssignedId'] = 'Choose a team member.';
}

/** Dependent validation (docx §12): what the target stage needs that the record lacks. */
function stageEntryErrors(
  stage: StoredStage,
  input: StageEntryInput,
  opp: StoredOpportunity | null,
): Record<string, string> {
  const errors: Record<string, string> = {};
  if (stage.requires.includes('LOST_REASON')) {
    if (!input.lostReason || !LOST_REASONS.some((reason) => reason.id === input.lostReason))
      errors['lostReason'] = 'Choose why this record was lost.';
    else if (input.lostReason === 'OTHER' && !input.lostNote?.trim())
      errors['lostNote'] = 'Explain the reason.';
    if ((input.lostNote ?? '').length > 500)
      errors['lostNote'] = 'Keep the note under 500 characters.';
  }
  if (stage.requires.includes('TRANSACTION') && !opp?.transaction) {
    const reference = input.transactionReference?.trim() ?? '';
    if (!TRANSACTION_REF.test(reference))
      errors['transactionReference'] = 'Enter the transaction reference, like TX-2026-0142.';
  }
  if (stage.requires.includes('APPOINTMENT')) {
    const now = Date.now();
    const booked =
      opp &&
      db().appointments.some(
        (a) =>
          a.opportunityId === opp.id && a.status === 'SCHEDULED' && Date.parse(a.startsAt) >= now,
      );
    if (!booked) checkAppointment(input.appointment, errors);
  }
  return errors;
}

export interface SaveOpportunity extends StageEntryInput {
  pipelineId?: string;
  firmName: string;
  contactName: string;
  email: string;
  phone: string;
  source: LeadSource | '';
  plan: PlanId | '';
  extraUsers: number;
  /** Estimated annual value; null when none was given. */
  valueCents: number | null;
  /** '' leaves it unassigned. */
  ownerId: string;
  /** '' is the pipeline's first stage. */
  stageId: string;
  tagIds: string[];
  notes: string;
  /** Create even though a probable duplicate exists. */
  allowDuplicate?: boolean;
}

function contactErrors(body: {
  firmName: string;
  contactName: string;
  email: string;
  phone: string;
}): Record<string, string> {
  const errors: Record<string, string> = {};
  if (!body.firmName.trim()) errors['firmName'] = 'Enter the firm or company name.';
  else if (body.firmName.trim().length > 120)
    errors['firmName'] = 'Keep the name under 120 characters.';
  if (!body.contactName.trim()) errors['contactName'] = 'Enter the primary contact.';
  else if (body.contactName.trim().length > 80)
    errors['contactName'] = 'Keep the name under 80 characters.';
  const email = body.email.trim();
  const phone = digits(body.phone);
  if (email && !EMAIL.test(email)) errors['email'] = 'Enter an email like name@example.com.';
  if (body.phone.trim() && (phone.length < 10 || phone.length > 15))
    errors['phone'] = 'Enter a phone number with 10 to 15 digits.';
  if (!email && !body.phone.trim()) errors['email'] = 'Enter an email or a phone number.';
  return errors;
}

function salesErrors(body: {
  plan: PlanId | '';
  extraUsers: number;
  valueCents: number | null;
  source?: LeadSource | '';
}): Record<string, string> {
  const errors: Record<string, string> = {};
  if (body.source !== undefined && !LEAD_SOURCES.some((source) => source.id === body.source))
    errors['source'] = 'Choose where this lead came from.';
  if (body.plan && !PLAN_IDS.includes(body.plan)) errors['plan'] = 'Choose a plan.';
  const extra = body.plan ? maxExtraUsers(body.plan) : 0;
  if (!Number.isInteger(body.extraUsers) || body.extraUsers < 0 || body.extraUsers > extra)
    errors['extraUsers'] =
      extra > 0 ? `Add between 0 and ${extra} users.` : 'This plan has no extra users.';
  if (
    body.valueCents !== null &&
    (!Number.isInteger(body.valueCents) || body.valueCents < 0 || body.valueCents > 10_000_000_00)
  )
    errors['valueCents'] = 'Enter an amount between $0 and $10,000,000.';
  return errors;
}

function duplicatesOf(body: { firmName: string; email: string; phone: string }, skipId?: string) {
  const firm = normalize(body.firmName);
  const email = body.email.trim().toLowerCase();
  const phone = digits(body.phone);
  const matches: DuplicateMatch[] = [];
  for (const opp of db().opportunities) {
    if (opp.id === skipId) continue;
    const on: string[] = [];
    if (email && opp.email?.toLowerCase() === email) on.push('email');
    if (phone.length >= 10 && opp.phone && digits(opp.phone) === phone) on.push('phone');
    if (firm && normalize(opp.firmName) === firm) on.push('firm name');
    if (on.length)
      matches.push({
        id: opp.id,
        firmName: opp.firmName,
        contactName: opp.contactName,
        stageName: stageInfo(opp).stage.name,
        matchedOn: on.join(', '),
      });
  }
  return matches.slice(0, 5);
}

/* ------------------------------------------------------------------------------------------ */
/* Changes shared by the actions.                                                              */
/* ------------------------------------------------------------------------------------------ */

function bookAppointment(opp: StoredOpportunity, input: AppointmentInput) {
  const s = db();
  const start = appointmentStart(input) ?? Date.now();
  const appointment: SalesAppointment = {
    id: nextId('5a06'),
    opportunityId: opp.id,
    firmName: opp.firmName,
    contactName: opp.contactName,
    type: input.type,
    startsAt: iso(start),
    assignedId: input.assignedId ?? opp.ownerId,
    assignedName: null,
    status: 'SCHEDULED',
    createdAt: iso(Date.now()),
  };
  s.appointments.push(appointment);
  log(
    opp,
    'APPOINTMENT_SCHEDULED',
    `Scheduled ${appointmentTypeLabel(input.type).toLowerCase()} with ${opp.firmName}`,
    { detail: appointmentTypeLabel(input.type) },
  );
  return appointment;
}

function addTask(opp: StoredOpportunity, title: string, dueAt: number) {
  db().tasks.push({
    id: nextId('5a08'),
    opportunityId: opp.id,
    title,
    dueAt: iso(dueAt),
    done: false,
    completedAt: null,
  });
  refreshFollowUp(opp);
}

/** The next follow-up is the earliest open task. */
function refreshFollowUp(opp: StoredOpportunity) {
  const open = db()
    .tasks.filter((task) => task.opportunityId === opp.id && !task.done)
    .sort((a, b) => Date.parse(a.dueAt) - Date.parse(b.dueAt))[0];
  opp.nextFollowUpAt = open?.dueAt ?? null;
}

function runAutomation(opp: StoredOpportunity, stage: StoredStage) {
  const owner = db().reps.find((rep) => rep.id === opp.ownerId);
  if (stage.automation === 'NOTIFY_OWNER')
    log(
      opp,
      'AUTOMATION',
      `Notified ${owner?.name ?? 'the sales team'}: ${opp.firmName} entered ${stage.name}`,
      {
        actor: AUTOMATION,
      },
    );
  if (stage.automation === 'CREATE_FOLLOW_UP') {
    addTask(opp, `Follow up with ${opp.contactName}`, Date.now() + 2 * DAY);
    log(opp, 'AUTOMATION', `Created a follow-up task for ${opp.firmName}`, { actor: AUTOMATION });
  }
  if (stage.automation === 'SEND_WELCOME_EMAIL')
    log(opp, 'AUTOMATION', `Sent the welcome email to ${opp.contactName}`, { actor: AUTOMATION });
  if (stage.automation === 'START_ONBOARDING')
    log(opp, 'AUTOMATION', `Started firm onboarding for ${opp.firmName}`, { actor: AUTOMATION });
}

/** Moves a record and records old stage, new stage, actor and time (docx §12, §24). */
function applyMove(
  opp: StoredOpportunity,
  target: StoredStage,
  input: StageEntryInput,
  actor: SalesActor,
) {
  const { pipeline, stage: from } = stageInfo(opp);
  if (from.id === target.id) return;
  const now = Date.now();
  if (target.requires.includes('APPOINTMENT') && input.appointment)
    bookAppointment(opp, input.appointment);
  if (target.requires.includes('TRANSACTION') && !opp.transaction && input.transactionReference) {
    opp.transaction = {
      reference: input.transactionReference.trim().toUpperCase(),
      status: 'OPEN',
      linkedAt: iso(now),
      estimatedCloseAt: iso(now + 30 * DAY),
      closedAt: null,
    };
    log(
      opp,
      'TRANSACTION_LINKED',
      `Linked transaction ${opp.transaction.reference} to ${opp.firmName}`,
      {
        actor,
        detail: opp.transaction.reference,
      },
    );
  }
  opp.stageId = target.id;
  opp.stageEnteredAt = iso(now);
  if (from.type === 'LOST') {
    opp.lostAt = null;
    opp.lostReason = null;
    opp.lostNote = null;
  }
  if (isConverted(target.type) && !opp.convertedAt) {
    opp.convertedAt = iso(now);
    log(opp, 'WON', `Won ${opp.firmName}`, {
      actor,
      valueCents: opp.plan ? monthlyCents(opp.plan, opp.extraUsers, opp.extraLocations) : null,
    });
  }
  if (target.type === 'TRANSACTION' && opp.transaction) opp.transaction.status = 'UNDER_CONTRACT';
  if (target.type === 'CLOSED') {
    opp.closedAt = iso(now);
    if (opp.transaction) {
      opp.transaction.status = 'CLOSED';
      opp.transaction.closedAt = iso(now);
    }
  }
  if (target.type !== 'CLOSED') opp.closedAt = null;
  if (target.type === 'LOST') {
    opp.lostAt = iso(now);
    opp.lostReason = input.lostReason ?? 'OTHER';
    opp.lostNote = input.lostNote?.trim() || null;
    opp.nextFollowUpAt = null;
    log(opp, 'LOST', `Marked ${opp.firmName} as ${target.name}`, {
      actor,
      fromStage: from.name,
      toStage: target.name,
      detail: [lostReasonLabel(opp.lostReason), opp.lostNote].filter(Boolean).join(': '),
    });
  } else {
    const backward =
      pipeline.stages.indexOf(target) < pipeline.stages.indexOf(from) && from.type !== 'LOST';
    log(
      opp,
      'STAGE_CHANGED',
      `${backward ? 'Moved back' : 'Moved'} ${opp.firmName} to ${target.name}`,
      { actor, fromStage: from.name, toStage: target.name },
    );
  }
  runAutomation(opp, target);
}

function stageById(pipelineId: string, stageId: string) {
  const stage = pipelineOf(pipelineId).stages.find((s) => s.id === stageId);
  if (!stage) throw new SalesFieldError({ stageId: 'Choose a stage of this pipeline.' });
  return stage;
}

function recordCounts(pipeline: { id: string; stages: StoredStage[] }) {
  const counts: Record<string, number> = {};
  for (const stage of pipeline.stages) counts[stage.id] = 0;
  for (const opp of db().opportunities)
    if (opp.pipelineId === pipeline.id) counts[opp.stageId] = (counts[opp.stageId] ?? 0) + 1;
  return counts;
}

/* ------------------------------------------------------------------------------------------ */
/* Pipelines (the builder).                                                                    */
/* ------------------------------------------------------------------------------------------ */

export interface StageDraft {
  /** Missing for a new stage. */
  id?: string;
  name: string;
  type: StageType;
  tone: StageTone;
  active: boolean;
  requires: StageRequirement[];
  automation: StageAutomation;
}
export interface SavePipeline {
  id: string;
  name: string;
  description: string;
  /** In board order. */
  stages: StageDraft[];
  /** Removed stages and the stage their records move to first (docx §15 "Delete Protection"). */
  removed: { id: string; moveTo: string | null }[];
}
export interface CreatePipeline {
  name: string;
  description: string;
  template: 'DEFAULT' | 'BASIC';
}

function pipelineErrors(body: { name: string; description: string }, skipId?: string) {
  const errors: Record<string, string> = {};
  const name = body.name.trim();
  if (!name) errors['name'] = 'Enter a pipeline name.';
  else if (name.length > 60) errors['name'] = 'Keep the name under 60 characters.';
  else if (
    db().pipelines.some(
      (p) => p.id !== skipId && p.name.trim().toLowerCase() === name.toLowerCase(),
    )
  )
    errors['name'] = 'Another pipeline already has this name.';
  if (body.description.length > 300)
    errors['description'] = 'Keep the description under 300 characters.';
  return errors;
}

function pipelineView(pipeline: SalesStore['pipelines'][number]): SalesPipeline {
  return { ...copy(pipeline), recordCounts: recordCounts(pipeline) };
}

/* ------------------------------------------------------------------------------------------ */
/* The client.                                                                                 */
/* ------------------------------------------------------------------------------------------ */

function filterOpportunities(query: OpportunityQuery, now: number) {
  const pipeline = pipelineOf(query.pipelineId);
  const search = query.search?.trim().toLowerCase() ?? '';
  const searchDigits = digits(search);
  const range =
    query.from || query.to
      ? boundsOf({ from: query.from || '1970-01-01', to: query.to || localDate(now) }, now)
      : null;
  return db()
    .opportunities.filter((opp) => opp.pipelineId === pipeline.id)
    .map((opp) => view(opp, now))
    .filter((opp) => {
      if (query.stageId && opp.stageId !== query.stageId) return false;
      if (query.ownerId && opp.owner?.id !== query.ownerId) return false;
      if (query.plan && opp.plan !== query.plan) return false;
      if (query.source && opp.source !== query.source) return false;
      if (query.tagId && !opp.tags.some((tag) => tag.id === query.tagId)) return false;
      if (query.overdueOnly && !opp.attention.includes('OVERDUE')) return false;
      if (query.unassignedOnly && opp.owner) return false;
      if (query.attentionOnly && !needsAttention(opp.attention)) return false;
      if (query.scope === 'IN_PROGRESS' && opp.stageType !== 'ACTIVE') return false;
      if (query.scope === 'PIPELINE' && !isOpen(opp.stageType)) return false;
      if (query.scope === 'OPEN' && !isOpen(opp.stageType)) return false;
      if (query.scope === 'CONVERTED' && !isConverted(opp.stageType)) return false;
      if (query.scope === 'CLIENTS' && opp.stageType !== 'CONVERTED') return false;
      if (range) {
        const stored = db().opportunities.find((o) => o.id === opp.id);
        if (!stored || !activeDuring(stored, opp.stageType, range)) return false;
      }
      if (search) {
        const haystack = [opp.firmName, opp.contactName, opp.email ?? '', opp.id]
          .join(' ')
          .toLowerCase();
        const phoneHit = searchDigits.length >= 3 && digits(opp.phone ?? '').includes(searchDigits);
        if (!haystack.includes(search) && !phoneHit) return false;
      }
      return true;
    })
    .sort(
      (a, b) =>
        a.stageOrder - b.stageOrder || Date.parse(b.lastActivityAt) - Date.parse(a.lastActivityAt),
    );
}

const csvCell = (value: string) => {
  // A leading = + - @ would run as a formula in a spreadsheet.
  const safe = /^[=+\-@]/.test(value) ? `'${value}` : value;
  return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};

export const adminSales = {
  /** Reps, tags, plans and pipelines for the filters and forms. */
  meta: async (): Promise<SalesMeta> => {
    await ready();
    const s = db();
    return {
      reps: copy(s.reps),
      tags: copy(s.tags),
      plans: PLAN_IDS.map((id) => ({ id, name: planName(id) })),
      pipelines: s.pipelines.map(({ id, name, isDefault }) => ({ id, name, isDefault })),
      defaultPipelineId: pipelineOf().id,
      today: localDate(Date.now()),
      permissions: { managePipelines: true, assign: true, bulkEdit: true, export: true },
    };
  },

  plans: async (): Promise<SalesPlan[]> => {
    await ready();
    return planCatalog();
  },

  /** The Sales Center's six numbers for a period, each against the period before. */
  centerKpis: async (period: SalesPeriod): Promise<CenterKpis> => {
    await ready();
    const s = db();
    const now = Date.now();
    const current = boundsOf(period, now);
    const previous = previousOf(current);
    const count = (bounds: Bounds, pick: (opp: StoredOpportunity) => string | null) =>
      s.opportunities.filter((opp) => within(pick(opp), bounds)).length;
    const demos = (bounds: Bounds) =>
      s.appointments.filter((a) => a.type === 'DEMO' && within(a.createdAt, bounds)).length;
    const price = (opp: StoredOpportunity) =>
      opp.plan ? monthlyCents(opp.plan, opp.extraUsers, opp.extraLocations) : 0;
    const trialActive = (opp: StoredOpportunity) =>
      opp.trialStartedAt !== null &&
      Date.parse(opp.trialStartedAt) <= now &&
      (time(opp.trialEndsAt) ?? 0) > now;
    // Projected MRR: clients won in the period plus trials started in it, at their plan price.
    const mrr = (bounds: Bounds) =>
      s.opportunities
        .filter((opp) => within(opp.convertedAt, bounds) || within(opp.trialStartedAt, bounds))
        .reduce((sum, opp) => sum + price(opp), 0);
    return {
      totalLeads: metric(
        count(current, (o) => o.createdAt),
        count(previous, (o) => o.createdAt),
      ),
      demosScheduled: metric(demos(current), demos(previous)),
      activeTrials: metric(
        s.opportunities.filter(trialActive).length,
        count(previous, (o) => o.trialStartedAt),
      ),
      wonDeals: metric(
        count(current, (o) => o.convertedAt),
        count(previous, (o) => o.convertedAt),
      ),
      lostDeals: metric(
        count(current, (o) => o.lostAt),
        count(previous, (o) => o.lostAt),
      ),
      projectedMrrCents: metric(mrr(current), mrr(previous)),
    };
  },

  /** The pipeline page's KPI row: the whole pipeline, trends on records created in 30 days. */
  pipelineKpis: async (pipelineId?: string): Promise<PipelineKpis> => {
    await ready();
    const now = Date.now();
    const pipeline = pipelineOf(pipelineId);
    const all = db()
      .opportunities.filter((opp) => opp.pipelineId === pipeline.id)
      .map((opp) => view(opp, now));
    const current = boundsOf('LAST_30_DAYS', now);
    const previous = previousOf(current);
    const created = (bounds: Bounds) => all.filter((opp) => within(opp.createdAt, bounds));
    const inProgress = (list: SalesOpportunity[]) =>
      list.filter((opp) => opp.stageType === 'ACTIVE').length;
    const value = (list: SalesOpportunity[]) =>
      list
        .filter((opp) => isOpen(opp.stageType))
        .reduce((sum, opp) => sum + (opp.valueCents ?? 0), 0);
    const rate = (list: SalesOpportunity[]) =>
      list.length
        ? Math.round((list.filter((opp) => isConverted(opp.stageType)).length / list.length) * 100)
        : 0;
    return {
      totalOpportunities: {
        value: all.length,
        trend: trendOf(created(current).length, created(previous).length),
      },
      inProgress: {
        value: inProgress(all),
        trend: trendOf(inProgress(created(current)), inProgress(created(previous))),
      },
      pipelineValueCents: {
        value: value(all),
        trend: trendOf(value(created(current)), value(created(previous))),
      },
      conversionRate: {
        value: rate(all),
        trend: trendOf(rate(created(current)), rate(created(previous))),
      },
      activeClients: all.filter((opp) => opp.stageType === 'CONVERTED').length,
      needsAttention: all.filter((opp) => needsAttention(opp.attention)).length,
    };
  },

  /** Records per stage that were open in the period (Pipeline Analytics, the Center's bars). */
  stageCounts: async (period: PeriodInput, pipelineId?: string): Promise<StageCount[]> => {
    await ready();
    const pipeline = pipelineOf(pipelineId);
    const bounds = boundsOf(period, Date.now());
    const counts = recordCounts(pipeline);
    return pipeline.stages
      .filter((stage) => stage.active || (counts[stage.id] ?? 0) > 0)
      .map((stage) => {
        const records = db().opportunities.filter(
          (opp) =>
            opp.pipelineId === pipeline.id &&
            opp.stageId === stage.id &&
            activeDuring(opp, stage.type, bounds),
        );
        return {
          stageId: stage.id,
          name: stage.name,
          tone: stage.tone,
          type: stage.type,
          count: records.length,
          valueCents: records.reduce((sum, opp) => sum + (opp.valueCents ?? 0), 0),
        };
      });
  },

  /** Monthly revenue of the clients won in the period, by plan, add-ons apart. */
  revenueByPlan: async (period: SalesPeriod): Promise<RevenueByPlan> => {
    await ready();
    const bounds = boundsOf(period, Date.now());
    const slices: RevenueSlice[] = [
      { id: 'SOLO', label: 'Solo Plans', cents: 0 },
      { id: 'TEAM_PRO', label: 'Team Pro', cents: 0 },
      { id: 'BUSINESS', label: 'Business', cents: 0 },
      { id: 'ENTERPRISE', label: 'Enterprise', cents: 0 },
      { id: 'ADD_ONS', label: 'Add-ons', cents: 0 },
    ];
    const add = (id: RevenueSlice['id'], cents: number) => {
      const slice = slices.find((item) => item.id === id);
      if (slice) slice.cents += cents;
    };
    for (const opp of db().opportunities) {
      if (!opp.plan || !within(opp.convertedAt, bounds)) continue;
      const base = PRICING[opp.plan].base;
      const family = opp.plan.startsWith('SOLO') ? 'SOLO' : (opp.plan as RevenueSlice['id']);
      add(family, base);
      add('ADD_ONS', monthlyCents(opp.plan, opp.extraUsers, opp.extraLocations) - base);
    }
    return { totalCents: slices.reduce((sum, slice) => sum + slice.cents, 0), slices };
  },

  /** New records in the period by lead source, largest first. */
  leadSources: async (period: SalesPeriod): Promise<SourceShare[]> => {
    await ready();
    const bounds = boundsOf(period, Date.now());
    const fresh = db().opportunities.filter((opp) => within(opp.createdAt, bounds));
    return LEAD_SOURCES.map(({ id, label }) => {
      const count = fresh.filter((opp) => opp.source === id).length;
      return {
        source: id,
        label,
        count,
        percent: fresh.length ? Math.round((count / fresh.length) * 100) : 0,
      };
    })
      .filter((share) => share.count > 0)
      .sort((a, b) => b.count - a.count);
  },

  /**
   * Activity, newest first. `sales` keeps the Sales Center's kinds (new leads, demos, trials,
   * proposals, won and lost).
   */
  activity: async (
    query: { limit?: number; kinds?: 'sales' | 'all'; pipelineId?: string } = {},
  ): Promise<SalesActivity[]> => {
    await ready();
    const s = db();
    const sales: ActivityKind[] = [
      'CREATED',
      'APPOINTMENT_SCHEDULED',
      'TRIAL_STARTED',
      'PROPOSAL_SENT',
      'WON',
      'LOST',
    ];
    const pipelineIds = query.pipelineId
      ? new Set([pipelineOf(query.pipelineId).id])
      : new Set(s.pipelines.map((p) => p.id));
    const inPipeline = new Set(
      s.opportunities.filter((opp) => pipelineIds.has(opp.pipelineId)).map((opp) => opp.id),
    );
    return s.activities
      .filter((entry) => inPipeline.has(entry.opportunityId))
      .filter((entry) => query.kinds !== 'sales' || sales.includes(entry.kind))
      .slice(0, query.limit ?? 50)
      .map((entry) => {
        const opp = s.opportunities.find((o) => o.id === entry.opportunityId);
        return { ...copy(entry), firmName: opp?.firmName ?? entry.firmName };
      });
  },

  /** Scheduled appointments and follow-up meetings from now on, soonest first. */
  appointments: async (
    query: { limit?: number; pipelineId?: string } = {},
  ): Promise<SalesAppointment[]> => {
    await ready();
    const s = db();
    const now = Date.now();
    const pipelineId = query.pipelineId ? pipelineOf(query.pipelineId).id : null;
    return s.appointments
      .filter((a) => a.status === 'SCHEDULED' && Date.parse(a.startsAt) >= now)
      .filter((a) => {
        const opp = s.opportunities.find((o) => o.id === a.opportunityId);
        return opp && (!pipelineId || opp.pipelineId === pipelineId);
      })
      .sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt))
      .slice(0, query.limit ?? 50)
      .map(appointmentView);
  },

  /** The board and the list read the same records with the same filters (docx §6). */
  opportunities: async (query: OpportunityQuery = {}): Promise<SalesOpportunity[]> => {
    await ready();
    return filterOpportunities(query, Date.now());
  },

  opportunity: async (id: string): Promise<OpportunityRecord> => {
    await ready();
    const s = db();
    const opp = findOpportunity(id);
    const { pipeline } = stageInfo(opp);
    const mine = <T extends { opportunityId: string }>(list: T[]) =>
      list.filter((item) => item.opportunityId === id).map(copy);
    return {
      opportunity: view(opp, Date.now()),
      pipeline: { id: pipeline.id, name: pipeline.name, stages: copy(pipeline.stages) },
      notes: mine(s.notes).sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)),
      tasks: mine(s.tasks).sort((a, b) => Date.parse(a.dueAt) - Date.parse(b.dueAt)),
      appointments: mine(s.appointments)
        .map(appointmentView)
        .sort((a, b) => Date.parse(b.startsAt) - Date.parse(a.startsAt)),
      communications: mine(s.communications).sort((a, b) => Date.parse(b.at) - Date.parse(a.at)),
      documents: mine(s.documents),
      activity: mine(s.activities),
    };
  },

  /** Add Lead / Opportunity (docx §16): checks, duplicate check, then the record and its history. */
  createOpportunity: async (body: SaveOpportunity): Promise<SalesOpportunity> => {
    await ready();
    const s = db();
    const pipeline = pipelineOf(body.pipelineId);
    const stage = body.stageId
      ? pipeline.stages.find((item) => item.id === body.stageId && item.active)
      : pipeline.stages.find((item) => item.active);
    const errors: Record<string, string> = {
      ...contactErrors(body),
      ...salesErrors(body),
    };
    if (!stage) errors['stageId'] = 'Choose a starting stage.';
    if (body.ownerId && !s.reps.some((rep) => rep.id === body.ownerId))
      errors['ownerId'] = 'Choose a team member.';
    if (body.tagIds.some((id) => !s.tags.some((tag) => tag.id === id)))
      errors['tagIds'] = 'Choose tags from the list.';
    if (body.notes.length > 2000) errors['notes'] = 'Keep notes under 2,000 characters.';
    if (stage) Object.assign(errors, stageEntryErrors(stage, body, null));
    if (Object.keys(errors).length || !stage) throw new SalesFieldError(errors);
    if (!body.allowDuplicate) {
      const matches = duplicatesOf(body);
      if (matches.length) throw new SalesDuplicateError(matches);
    }
    const now = Date.now();
    const first = pipeline.stages[0] ?? stage;
    const opp: StoredOpportunity = {
      id: nextId('5a00'),
      pipelineId: pipeline.id,
      stageId: first.id,
      firmName: body.firmName.trim(),
      contactName: body.contactName.trim(),
      email: body.email.trim() || null,
      phone: body.phone.trim() || null,
      valueCents: body.valueCents,
      plan: body.plan || null,
      extraUsers: body.plan ? body.extraUsers : 0,
      extraLocations: 0,
      source: body.source || 'MANUAL_ENTRY',
      ownerId: body.ownerId || null,
      tagIds: [...new Set(body.tagIds)],
      createdAt: iso(now),
      stageEnteredAt: iso(now),
      lastActivityAt: iso(now),
      attempts: 0,
      contactedAt: null,
      nextFollowUpAt: null,
      nextStep: null,
      trialStartedAt: null,
      trialEndsAt: null,
      convertedAt: null,
      closedAt: null,
      lostAt: null,
      lostReason: null,
      lostNote: null,
      transaction: null,
    };
    s.opportunities.push(opp);
    const owner = s.reps.find((rep) => rep.id === opp.ownerId);
    log(opp, 'CREATED', `New lead added: ${opp.firmName}`, {
      at: now,
      toStage: stage.name,
      detail: `Source: ${sourceLabel(opp.source)}. Owner: ${owner?.name ?? 'Unassigned'}. Stage: ${stage.name}.`,
    });
    if (body.notes.trim())
      s.notes.push({
        id: nextId('5a07'),
        opportunityId: opp.id,
        body: body.notes.trim(),
        author: ME.name,
        createdAt: iso(now),
      });
    if (stage.id === first.id) runAutomation(opp, stage);
    else applyMove(opp, stage, body, ME);
    return view(opp, Date.now());
  },

  /** One record to another stage; the stage's required data comes with it. */
  moveStage: async (
    body: { id: string; stageId: string } & StageEntryInput,
  ): Promise<SalesOpportunity> => {
    await ready();
    const opp = findOpportunity(body.id);
    const target = stageById(opp.pipelineId, body.stageId);
    if (!target.active) throw new SalesFieldError({ stageId: 'This stage is switched off.' });
    const errors = stageEntryErrors(target, body, opp);
    if (Object.keys(errors).length) throw new SalesFieldError(errors);
    applyMove(opp, target, body, ME);
    return view(opp, Date.now());
  },

  /** Several records to one stage (List View bulk action). */
  bulkStage: async (
    body: { ids: string[]; stageId: string } & StageEntryInput,
  ): Promise<{ updated: number }> => {
    await ready();
    if (!body.ids.length) throw new SalesFieldError({ ids: 'Select at least one record.' });
    const records = body.ids.map(findOpportunity);
    const pipelineId = records[0]?.pipelineId ?? '';
    const target = stageById(pipelineId, body.stageId);
    if (target.requires.includes('APPOINTMENT'))
      throw new SalesFieldError({
        stageId: `${target.name} needs an appointment for each record: move them one at a time.`,
      });
    const errors: Record<string, string> = {};
    for (const opp of records) Object.assign(errors, stageEntryErrors(target, body, opp));
    if (Object.keys(errors).length) throw new SalesFieldError(errors);
    let updated = 0;
    for (const opp of records) {
      if (opp.stageId === target.id) continue;
      applyMove(opp, target, body, ME);
      updated += 1;
    }
    return { updated };
  },

  /** Assign or reassign one or many records (null makes them unassigned), with history. */
  assign: async (body: { ids: string[]; ownerId: string | null }): Promise<{ updated: number }> => {
    await ready();
    const s = db();
    if (!body.ids.length) throw new SalesFieldError({ ids: 'Select at least one record.' });
    const next = body.ownerId ? s.reps.find((rep) => rep.id === body.ownerId) : null;
    if (body.ownerId && !next) throw new SalesFieldError({ ownerId: 'Choose a team member.' });
    let updated = 0;
    for (const opp of body.ids.map(findOpportunity)) {
      if (opp.ownerId === (body.ownerId ?? null)) continue;
      const before = s.reps.find((rep) => rep.id === opp.ownerId);
      opp.ownerId = body.ownerId ?? null;
      log(
        opp,
        before ? 'REASSIGNED' : 'ASSIGNED',
        next
          ? `${before ? 'Reassigned' : 'Assigned'} ${opp.firmName} to ${next.name}`
          : `Unassigned ${opp.firmName}`,
        { detail: `${before?.name ?? 'Unassigned'} → ${next?.name ?? 'Unassigned'}` },
      );
      updated += 1;
    }
    return { updated };
  },

  bulkTag: async (body: { ids: string[]; tagId: string }): Promise<{ updated: number }> => {
    await ready();
    const tag = db().tags.find((item) => item.id === body.tagId);
    if (!tag) throw new SalesFieldError({ tagId: 'Choose a tag.' });
    if (!body.ids.length) throw new SalesFieldError({ ids: 'Select at least one record.' });
    let updated = 0;
    for (const opp of body.ids.map(findOpportunity)) {
      if (opp.tagIds.includes(tag.id)) continue;
      opp.tagIds.push(tag.id);
      log(opp, 'UPDATED', `Tagged ${opp.firmName} ${tag.name}`, {
        detail: `Tag added: ${tag.name}`,
      });
      updated += 1;
    }
    return { updated };
  },

  /** Edits the record; the history keeps each before and after value (docx §24). */
  updateOpportunity: async (body: {
    id: string;
    firmName: string;
    contactName: string;
    email: string;
    phone: string;
    valueCents: number | null;
    plan: PlanId | '';
    extraUsers: number;
    source: LeadSource;
    tagIds: string[];
    nextStep: string;
  }): Promise<SalesOpportunity> => {
    await ready();
    const s = db();
    const opp = findOpportunity(body.id);
    const errors = { ...contactErrors(body), ...salesErrors(body) };
    if (body.tagIds.some((id) => !s.tags.some((tag) => tag.id === id)))
      errors['tagIds'] = 'Choose tags from the list.';
    if (body.nextStep.length > 200) errors['nextStep'] = 'Keep the next step under 200 characters.';
    if (Object.keys(errors).length) throw new SalesFieldError(errors);
    const money = (cents: number | null) =>
      cents === null ? 'none' : `$${(cents / 100).toLocaleString('en-US')}`;
    const tagNames = (ids: string[]) =>
      s.tags
        .filter((tag) => ids.includes(tag.id))
        .map((tag) => tag.name)
        .join(', ') || 'none';
    const changes: string[] = [];
    const change = (label: string, before: string, after: string) => {
      if (before !== after) changes.push(`${label}: ${before} → ${after}`);
    };
    change('Firm', opp.firmName, body.firmName.trim());
    change('Contact', opp.contactName, body.contactName.trim());
    change('Email', opp.email ?? 'none', body.email.trim() || 'none');
    change('Phone', opp.phone ?? 'none', body.phone.trim() || 'none');
    change('Value', money(opp.valueCents), money(body.valueCents));
    change(
      'Plan',
      opp.plan ? planName(opp.plan) : 'none',
      body.plan ? planName(body.plan) : 'none',
    );
    change('Extra users', String(opp.extraUsers), String(body.plan ? body.extraUsers : 0));
    change('Source', sourceLabel(opp.source), sourceLabel(body.source));
    change('Tags', tagNames(opp.tagIds), tagNames(body.tagIds));
    change('Next step', opp.nextStep ?? 'none', body.nextStep.trim() || 'none');
    if (!changes.length) return view(opp, Date.now());
    Object.assign(opp, {
      firmName: body.firmName.trim(),
      contactName: body.contactName.trim(),
      email: body.email.trim() || null,
      phone: body.phone.trim() || null,
      valueCents: body.valueCents,
      plan: body.plan || null,
      extraUsers: body.plan ? body.extraUsers : 0,
      source: body.source,
      tagIds: [...new Set(body.tagIds)],
      nextStep: body.nextStep.trim() || null,
    });
    log(opp, 'UPDATED', `Updated ${opp.firmName}`, { detail: changes.join('; ') });
    return view(opp, Date.now());
  },

  addNote: async (body: { id: string; body: string }): Promise<SalesNote> => {
    await ready();
    const opp = findOpportunity(body.id);
    const text = body.body.trim();
    if (!text) throw new SalesFieldError({ body: 'Write the note first.' });
    if (text.length > 2000)
      throw new SalesFieldError({ body: 'Keep notes under 2,000 characters.' });
    const note: SalesNote = {
      id: nextId('5a07'),
      opportunityId: opp.id,
      body: text,
      author: ME.name,
      createdAt: iso(Date.now()),
    };
    db().notes.push(note);
    log(opp, 'NOTE_ADDED', `Added a note to ${opp.firmName}`);
    return copy(note);
  },

  addFollowUp: async (body: { id: string; title: string; dueDate: string }): Promise<SalesTask> => {
    await ready();
    const opp = findOpportunity(body.id);
    const errors: Record<string, string> = {};
    const due = parseLocal(body.dueDate, false);
    if (!body.title.trim()) errors['title'] = 'Describe the follow-up.';
    else if (body.title.trim().length > 120) errors['title'] = 'Keep it under 120 characters.';
    if (due === null) errors['dueDate'] = 'Choose the due date.';
    else if (due < startOfDay(Date.now())) errors['dueDate'] = 'Choose today or a later date.';
    if (Object.keys(errors).length || due === null) throw new SalesFieldError(errors);
    addTask(opp, body.title.trim(), due + 9 * HOUR);
    log(opp, 'FOLLOW_UP_ADDED', `Added a follow-up for ${opp.firmName}`, {
      detail: body.title.trim(),
    });
    const task = db().tasks[db().tasks.length - 1];
    if (!task) throw notFound();
    return copy(task);
  },

  completeFollowUp: async (taskId: string): Promise<SalesTask> => {
    await ready();
    const task = db().tasks.find((item) => item.id === taskId);
    if (!task) throw notFound();
    const opp = findOpportunity(task.opportunityId);
    if (!task.done) {
      task.done = true;
      task.completedAt = iso(Date.now());
      refreshFollowUp(opp);
      log(opp, 'FOLLOW_UP_COMPLETED', `Completed follow-up for ${opp.firmName}`, {
        detail: task.title,
      });
    }
    return copy(task);
  },

  /**
   * Books an appointment. A record before the pipeline's appointment stage moves there (docx
   * §27 test 4: Appointment Set reflects the scheduled event).
   */
  scheduleAppointment: async (
    body: { opportunityId: string } & AppointmentInput,
  ): Promise<SalesAppointment> => {
    await ready();
    const opp = findOpportunity(body.opportunityId);
    const errors: Record<string, string> = {};
    checkAppointment(body, errors);
    if (Object.keys(errors).length) throw new SalesFieldError(errors);
    const appointment = bookAppointment(opp, body);
    const { pipeline, order, stage } = stageInfo(opp);
    const target = pipeline.stages.find(
      (item) => item.requires.includes('APPOINTMENT') && item.active,
    );
    if (target && stage.type === 'ACTIVE' && pipeline.stages.indexOf(target) > order)
      applyMove(opp, target, {}, ME);
    return appointmentView(appointment);
  },

  /** A call, email or text: an attempt, or the first two-way contact. */
  logOutreach: async (body: {
    id: string;
    channel: SalesCommunication['channel'];
    reached: boolean;
    summary: string;
  }): Promise<SalesOpportunity> => {
    await ready();
    const opp = findOpportunity(body.id);
    const summary = body.summary.trim();
    if (summary.length > 300)
      throw new SalesFieldError({ summary: 'Keep it under 300 characters.' });
    const now = Date.now();
    const label = { EMAIL: 'Email', CALL: 'Call', SMS: 'Text' }[body.channel];
    db().communications.push({
      id: nextId('5a09'),
      opportunityId: opp.id,
      channel: body.channel,
      direction: 'OUTBOUND',
      summary:
        summary ||
        (body.reached ? `${label}: spoke with ${opp.contactName}` : `${label}: no answer`),
      at: iso(now),
      by: ME.name,
    });
    if (body.reached) {
      opp.contactedAt ??= iso(now);
      log(opp, 'CONTACTED', `Reached ${opp.contactName} at ${opp.firmName}`, { detail: label });
    } else {
      opp.attempts += 1;
      log(opp, 'OUTREACH_ATTEMPT', `Outreach attempt ${opp.attempts} to ${opp.firmName}`, {
        detail: label,
      });
    }
    return view(opp, Date.now());
  },

  startTrial: async (body: {
    opportunityId: string;
    plan: PlanId | '';
  }): Promise<SalesOpportunity> => {
    await ready();
    const opp = findOpportunity(body.opportunityId);
    const errors: Record<string, string> = {};
    if (!body.plan || !PLAN_IDS.includes(body.plan)) errors['plan'] = 'Choose a plan.';
    else if (!planCatalog().find((plan) => plan.id === body.plan)?.trial)
      errors['plan'] = 'Enterprise has no self-serve trial: create a proposal instead.';
    const now = Date.now();
    if (opp.trialEndsAt && Date.parse(opp.trialEndsAt) > now)
      errors['opportunityId'] = 'This record already has a trial running.';
    if (!isOpen(stageInfo(opp).stage.type)) errors['opportunityId'] = 'Choose an open record.';
    if (Object.keys(errors).length || !body.plan) throw new SalesFieldError(errors);
    opp.plan = body.plan;
    opp.extraUsers = Math.min(opp.extraUsers, maxExtraUsers(body.plan));
    opp.trialStartedAt = iso(now);
    opp.trialEndsAt = iso(now + 14 * DAY);
    log(opp, 'TRIAL_STARTED', `Started a 14-day ${planName(body.plan)} trial for ${opp.firmName}`, {
      valueCents: monthlyCents(body.plan, opp.extraUsers, opp.extraLocations),
    });
    return view(opp, Date.now());
  },

  /** Create Offer / Proposal: the plan and value go on the record; the proposal is a document. */
  sendProposal: async (body: {
    opportunityId: string;
    plan: PlanId | '';
    extraUsers: number;
    valueCents: number | null;
  }): Promise<SalesOpportunity> => {
    await ready();
    const opp = findOpportunity(body.opportunityId);
    const errors = salesErrors(body);
    if (!body.plan) errors['plan'] = 'Choose a plan.';
    if (!isOpen(stageInfo(opp).stage.type)) errors['opportunityId'] = 'Choose an open record.';
    if (Object.keys(errors).length || !body.plan) throw new SalesFieldError(errors);
    const monthly = monthlyCents(body.plan, body.extraUsers, opp.extraLocations);
    opp.plan = body.plan;
    opp.extraUsers = body.extraUsers;
    opp.valueCents = body.valueCents ?? monthly * 12;
    db().documents.push({
      id: nextId('5a0a'),
      opportunityId: opp.id,
      name: `Proposal – ${planName(body.plan)}.pdf`,
      addedAt: iso(Date.now()),
    });
    log(opp, 'PROPOSAL_SENT', `Sent a ${planName(body.plan)} proposal to ${opp.firmName}`, {
      valueCents: monthly,
    });
    return view(opp, Date.now());
  },

  /**
   * A linked transaction's events (docx §14): Under Contract and Closed move the record by
   * themselves, a termination returns it to the converted stage; the actor is the sync.
   */
  transactionEvent: async (body: {
    id: string;
    event: 'LINK' | 'UNDER_CONTRACT' | 'CLOSE' | 'TERMINATE';
    reference?: string;
  }): Promise<SalesOpportunity> => {
    await ready();
    const opp = findOpportunity(body.id);
    const { pipeline } = stageInfo(opp);
    const now = Date.now();
    if (body.event === 'LINK') {
      const reference = body.reference?.trim() ?? '';
      if (!TRANSACTION_REF.test(reference))
        throw new SalesFieldError({
          reference: 'Enter the transaction reference, like TX-2026-0142.',
        });
      opp.transaction = {
        reference: reference.toUpperCase(),
        status: 'OPEN',
        linkedAt: iso(now),
        estimatedCloseAt: iso(now + 30 * DAY),
        closedAt: null,
      };
      log(
        opp,
        'TRANSACTION_LINKED',
        `Linked transaction ${opp.transaction.reference} to ${opp.firmName}`,
        {
          detail: opp.transaction.reference,
        },
      );
      return view(opp, Date.now());
    }
    const transaction = opp.transaction;
    if (!transaction) throw new SalesFieldError({ reference: 'Link a transaction first.' });
    const byType = (type: StageType) =>
      pipeline.stages.find((stage) => stage.type === type && stage.active);
    if (body.event === 'UNDER_CONTRACT') {
      transaction.status = 'UNDER_CONTRACT';
      log(opp, 'UNDER_CONTRACT', `Transaction ${transaction.reference} is under contract`, {
        actor: SYNC,
        detail: transaction.reference,
      });
      const target = byType('TRANSACTION');
      if (target) applyMove(opp, target, {}, SYNC);
    } else if (body.event === 'CLOSE') {
      transaction.status = 'CLOSED';
      transaction.closedAt = iso(now);
      log(opp, 'CLOSED', `Transaction ${transaction.reference} closed`, {
        actor: SYNC,
        detail: transaction.reference,
      });
      const target = byType('CLOSED');
      if (target) applyMove(opp, target, {}, SYNC);
    } else {
      transaction.status = 'TERMINATED';
      log(opp, 'TERMINATED', `Transaction ${transaction.reference} was terminated`, {
        actor: SYNC,
        detail: transaction.reference,
      });
      const target = byType('CONVERTED') ?? byType('ACTIVE');
      if (target) applyMove(opp, target, {}, SYNC);
    }
    return view(opp, Date.now());
  },

  /** The user's last Card or List choice, kept on the server (no browser storage). */
  viewPreference: async (): Promise<SalesView> => {
    await ready();
    return db().viewPreference;
  },
  setViewPreference: async (value: SalesView): Promise<SalesView> => {
    await ready();
    db().viewPreference = value === 'LIST' ? 'LIST' : 'CARD';
    return db().viewPreference;
  },

  /** The Sales Center's report as CSV: every record created in the period. */
  exportReport: async (period: SalesPeriod): Promise<string> => {
    await ready();
    const now = Date.now();
    const bounds = boundsOf(period, now);
    const head = [
      'Firm',
      'Contact',
      'Email',
      'Stage',
      'Owner',
      'Source',
      'Plan',
      'Value (USD)',
      'Created',
    ];
    const rows = db()
      .opportunities.filter((opp) => within(opp.createdAt, bounds))
      .map((opp) => view(opp, now))
      .map((opp) => [
        opp.firmName,
        opp.contactName,
        opp.email ?? '',
        opp.stageName,
        opp.owner?.name ?? 'Unassigned',
        sourceLabel(opp.source),
        opp.plan ? planName(opp.plan) : '',
        opp.valueCents === null ? '' : (opp.valueCents / 100).toFixed(2),
        opp.createdAt.slice(0, 10),
      ]);
    return [head, ...rows].map((row) => row.map(csvCell).join(',')).join('\n');
  },

  pipelines: async (): Promise<SalesPipeline[]> => {
    await ready();
    return db().pipelines.map(pipelineView);
  },

  createPipeline: async (body: CreatePipeline): Promise<SalesPipeline> => {
    await ready();
    const errors = pipelineErrors(body);
    if (Object.keys(errors).length) throw new SalesFieldError(errors);
    const now = iso(Date.now());
    const basic = (
      name: string,
      type: StageType,
      tone: StageTone,
      requires: StageRequirement[],
    ): StoredStage => ({
      id: nextId('5a02'),
      name,
      type,
      tone,
      active: true,
      requires,
      automation: 'NONE',
    });
    const stages: StoredStage[] =
      body.template === 'DEFAULT'
        ? defaultStages().map((stage) => ({ ...stage, id: nextId('5a02') }))
        : [
            basic('New', 'ACTIVE', 'blue', []),
            basic('Won', 'CONVERTED', 'green', []),
            basic('Lost', 'LOST', 'red', ['LOST_REASON']),
          ];
    const pipeline = {
      id: nextId('5a01'),
      name: body.name.trim(),
      description: body.description.trim(),
      isDefault: false,
      stages,
      createdAt: now,
      updatedAt: now,
    };
    db().pipelines.push(pipeline);
    return pipelineView(pipeline);
  },

  /**
   * Saves names, order, types, colours, requirements and automations. Stage ids never change,
   * so renaming or reordering keeps every history entry; a removed stage's records move first.
   */
  savePipeline: async (body: SavePipeline): Promise<SalesPipeline> => {
    await ready();
    const s = db();
    const pipeline = s.pipelines.find((p) => p.id === body.id);
    if (!pipeline) throw notFound();
    const errors = pipelineErrors(body, pipeline.id);
    const counts = recordCounts(pipeline);
    const seen = new Set<string>();
    if (body.stages.length < 2) errors['stages'] = 'A pipeline needs at least two stages.';
    if (!body.stages.some((stage) => stage.active))
      errors['stages'] = 'Keep at least one stage switched on.';
    body.stages.forEach((stage, index) => {
      const name = stage.name.trim();
      if (!name) errors[`stage-${index}-name`] = 'Enter the stage name.';
      else if (name.length > 40) errors[`stage-${index}-name`] = 'Keep it under 40 characters.';
      else if (seen.has(name.toLowerCase()))
        errors[`stage-${index}-name`] = 'Two stages have this name.';
      seen.add(name.toLowerCase());
      if (stage.id && !pipeline.stages.some((existing) => existing.id === stage.id))
        errors[`stage-${index}-name`] = 'This stage is not in the pipeline.';
      if (!STAGE_TYPES.some((type) => type.id === stage.type))
        errors[`stage-${index}-type`] = 'Choose a type.';
      if (!stage.active && stage.id && (counts[stage.id] ?? 0) > 0)
        errors[`stage-${index}-active`] =
          'Move its records to another stage before switching it off.';
    });
    const keptIds = new Set(body.stages.map((stage) => stage.id).filter(Boolean));
    for (const removal of body.removed) {
      const holds = counts[removal.id] ?? 0;
      if (keptIds.has(removal.id)) continue;
      if (holds > 0 && (!removal.moveTo || !keptIds.has(removal.moveTo)))
        errors['removed'] = 'Choose where the records of each removed stage go.';
    }
    if (Object.keys(errors).length) throw new SalesFieldError(errors);
    const stages: StoredStage[] = body.stages.map((stage) => ({
      id: stage.id ?? nextId('5a02'),
      name: stage.name.trim(),
      type: stage.type,
      tone: stage.tone,
      active: stage.active,
      requires: [...new Set(stage.requires)],
      automation: stage.automation,
    }));
    const now = Date.now();
    for (const removal of body.removed) {
      const from = pipeline.stages.find((stage) => stage.id === removal.id);
      const to = stages.find((stage) => stage.id === removal.moveTo);
      if (!from || !to) continue;
      for (const opp of s.opportunities.filter((o) => o.stageId === from.id)) {
        opp.stageId = to.id;
        opp.stageEnteredAt = iso(now);
        log(
          opp,
          'STAGE_CHANGED',
          `Moved ${opp.firmName} to ${to.name} (stage ${from.name} removed)`,
          {
            fromStage: from.name,
            toStage: to.name,
          },
        );
      }
    }
    pipeline.name = body.name.trim();
    pipeline.description = body.description.trim();
    pipeline.stages = stages;
    pipeline.updatedAt = iso(now);
    return pipelineView(pipeline);
  },
};
