import {
  adminSalesReportPath,
  ApiError,
  ApiRequestError,
  CreateSalesFollowUpRequest,
  CreateSalesOpportunityRequest,
  CreateSalesPipelineRequest,
  LogSalesActivityRequest,
  MoveSalesStageRequest,
  SALES_ERRORS,
  SALES_APPOINTMENT_KINDS,
  SALES_CENTER_FEED_KINDS,
  SALES_FOLLOW_UP_KIND_LABELS,
  SALES_ACTIVITY_KIND_LABELS,
  SALES_ACTIVITY_OUTCOME_LABELS,
  SALES_STAGE_ACTIONS_AVAILABLE,
  SALES_STAGE_REQUIREMENT_LABELS,
  SALES_TWO_WAY_OUTCOMES,
  salesFeedDetail,
  salesFeedText,
  SalesOpportunityId,
  salesPlanPriceCents,
  SaveSalesNoteRequest,
  SaveSalesPipelineRequest,
  UpdateSalesOpportunityRequest,
  type PlatformBillingCycle,
  type PlatformSubscriptionStatus,
  type SalesActivityKind,
  type SalesCommunication as ApiCommunication,
  type SalesFeedEntry,
  type SalesFollowUp,
  type SalesFollowUpKind,
  type SalesLinkableSubscription,
  type SalesMetric as ApiMetric,
  type SalesOpportunitiesQuery,
  type SalesOpportunity as ApiOpportunity,
  type SalesOpportunitySet,
  type SalesPipeline as ApiPipeline,
  type SalesPlan as ApiPlan,
  type SalesStage as ApiStage,
  type SalesStageRequirement,
  type SalesStageType,
  type SalesTransaction as ApiTransaction,
} from '@firmivra/types';
import { api } from '../../../../../lib/api';
import { errorMessage as baseErrorMessage } from '../../../../../lib/errors';
import { mocked } from '../../../../../lib/mock';
import { sessionFetch } from '../../../../../lib/session';
import type * as Mock from '../../../../../mocks/admin-sales';
import {
  APPOINTMENT_TYPES,
  appointmentTypeLabel as mockAppointmentTypeLabel,
  adminSales as mockSales,
  maxExtraUsers as mockMaxExtraUsers,
  monthlyCents as mockMonthlyCents,
  PLAN_IDS,
  planName as mockPlanName,
  SalesDuplicateError,
  SalesFieldError,
  sourceLabel,
  STAGE_AUTOMATIONS as MOCK_STAGE_AUTOMATIONS,
  STAGE_REQUIREMENTS as MOCK_STAGE_REQUIREMENTS,
} from '../../../../../mocks/admin-sales';

// The Sales screens' data (R60): `api.adminSales` (contract packages/types/src/admin-sales),
// under the names and shapes the screens were built with (mocks/admin-sales.ts). Mock mode
// (NEXT_PUBLIC_API_MOCK=adminSales) keeps the mock. What differs from the mock
// (docs/work/R60-sales.md, "Sales screens (step 7b)") is handled here:
// - A plan is its code (SOLO_CORE …), the same in every environment, so the plan colours hold;
//   a request looks up the plan's id. Extra users and locations are not stored.
// - The filters go to the API; a trend is left out when there is nothing to compare with.
// - Stage types, requirements and automations are the database's; a colour cannot be saved.
// - One follow-ups list: FOLLOW_UP is a task, the other kinds are appointments.
// - Feed lines come from salesFeedText and salesFeedDetail.
// - Trials, proposal documents, the next step and a stored view choice have no data: 422 or empty.

const MODULE = 'adminSales';
const MOCKED = mocked(MODULE);

// ---------- Types the screens use ----------

export type {
  ActivityKind,
  AttentionFlag,
  CreatePipeline,
  LeadSource,
  LostReason,
  OpportunityQuery,
  OpportunityScope,
  PeriodInput,
  SalesActivity,
  SalesDocument,
  SalesMeta,
  SalesNote,
  SalesRep,
  SalesTask,
  SalesTrend,
  StageCount,
  StageTone,
  SourceShare,
} from '../../../../../mocks/admin-sales';
export type { SalesLinkableSubscription } from '@firmivra/types';

/** The plan's code (SOLO_CORE …): the same in every environment. */
export type PlanId = Mock.PlanId;
export type StageType = Mock.StageType;
export type SalesView = Mock.SalesView;
export type SalesPeriod = Mock.SalesPeriod;

/** The mock's, and the database's VALUE, ASSIGNEE, PLAN and LOST_NOTE. */
export type StageRequirement = Mock.StageRequirement | SalesStageRequirement;
/** The mock's six, and a call or meeting whose title is none of them. */
export type AppointmentType = Mock.AppointmentType | 'CALL' | 'MEETING';

export type PipelineStage = Omit<Mock.PipelineStage, 'requires'> & { requires: StageRequirement[] };
export type SalesPipeline = Omit<Mock.SalesPipeline, 'stages'> & { stages: PipelineStage[] };
export type StageDraft = Omit<Mock.StageDraft, 'requires'> & { requires: StageRequirement[] };
/** `expectedUpdatedAt`: the version the editor opened (409 CONFLICT when it changed since). */
export type SavePipeline = Omit<Mock.SavePipeline, 'stages'> & {
  stages: StageDraft[];
  expectedUpdatedAt?: string;
};

export type SalesAppointment = Omit<Mock.SalesAppointment, 'type'> & { type: AppointmentType };
export type AppointmentInput = Omit<Mock.AppointmentInput, 'type'> & { type: AppointmentType };
export type StageEntryInput = Omit<Mock.StageEntryInput, 'appointment'> & {
  appointment?: AppointmentInput | null;
};
/** `requestId`: one per form opening, so a double click or a retry makes one record. */
export type SaveOpportunity = Omit<Mock.SaveOpportunity, 'appointment'> &
  StageEntryInput & { requestId?: string };

/** The API keeps no link time; `syncedAt` is when its status last changed. */
export type LinkedTransaction = Omit<Mock.LinkedTransaction, 'linkedAt'> & {
  linkedAt: string | null;
  syncedAt?: string | null;
};
export type SalesOpportunity = Omit<Mock.SalesOpportunity, 'transaction' | 'nextAppointment'> & {
  transaction: LinkedTransaction | null;
  nextAppointment: Pick<SalesAppointment, 'id' | 'type' | 'startsAt'> | null;
};
export type SalesCommunication = Omit<Mock.SalesCommunication, 'channel'> & {
  channel: SalesActivityKind;
};
export interface OpportunityRecord {
  opportunity: SalesOpportunity;
  pipeline: { id: string; name: string; stages: PipelineStage[] };
  notes: Mock.SalesNote[];
  tasks: Mock.SalesTask[];
  appointments: SalesAppointment[];
  communications: SalesCommunication[];
  documents: Mock.SalesDocument[];
  activity: Mock.SalesActivity[];
}

/** A trend is left out when there is nothing to compare with. */
export interface SalesMetric {
  value: number;
  trend?: Mock.SalesTrend;
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
/** OTHER: a plan outside the six codes; NO_PLAN: deals won without a plan. */
export type RevenueSlice = Omit<Mock.RevenueSlice, 'id'> & {
  id: Mock.RevenueSlice['id'] | 'OTHER' | 'NO_PLAN';
};
export interface RevenueByPlan {
  totalCents: number;
  slices: RevenueSlice[];
}
/** The API stores no plan copy (note 1): the card's highlights come from the plan's numbers. */
export type SalesPlan = Omit<Mock.SalesPlan, 'highlights'> & { highlights: string[] };

// ---------- Constants and labels ----------

export {
  APPOINTMENT_TYPES,
  ATTENTION_FLAGS,
  fieldErrors,
  LEAD_SOURCES,
  LOST_REASONS,
  lostReasonLabel,
  PERIOD_LABELS,
  SalesDuplicateError,
  SalesFieldError,
  sourceLabel,
  STAGE_TONES,
  STAGE_TYPES,
} from '../../../../../mocks/admin-sales';

const API_REQUIREMENTS: readonly SalesStageRequirement[] = [
  'VALUE',
  'ASSIGNEE',
  'PLAN',
  'TRANSACTION',
  'LOST_NOTE',
];
/**
 * The builder's "Requires" boxes: the database's five (a lost stage always needs its reason, so
 * it has no box). The mock's three in mock mode.
 */
export const STAGE_REQUIREMENTS: readonly { id: StageRequirement; label: string }[] = MOCKED
  ? MOCK_STAGE_REQUIREMENTS
  : API_REQUIREMENTS.map((id) => ({ id, label: SALES_STAGE_REQUIREMENT_LABELS[id] }));

/** "On entry": only what the API runs (CREATE_FOLLOW_UP; note 6). Every one in mock mode. */
export const STAGE_AUTOMATIONS: readonly { id: Mock.StageAutomation; label: string }[] = MOCKED
  ? MOCK_STAGE_AUTOMATIONS
  : MOCK_STAGE_AUTOMATIONS.filter(
      (item) =>
        item.id === 'NONE' ||
        (SALES_STAGE_ACTIONS_AVAILABLE as readonly string[]).includes(item.id),
    );

/**
 * The mock links a transaction from a typed reference when a record enters a transaction stage.
 * The API links the firm's subscription on the record page instead, and no one enters a
 * transaction-synced stage by hand (note 12), so the move forms ask for no reference there.
 */
export const TRANSACTION_BY_REFERENCE = MOCKED;

export const SUBSCRIPTION_STATUS_LABELS: Readonly<Record<PlatformSubscriptionStatus, string>> = {
  TRIAL: 'Trial',
  ACTIVE: 'Active',
  PAST_DUE: 'Past due',
  SUSPENDED: 'Suspended',
  NON_RENEWING: 'Non-renewing',
  EXPIRED: 'Expired',
  CANCELLED: 'Cancelled',
};

/** The kind each appointment type is stored as (note 15); its label is the title. */
const APPOINTMENT_KIND: Readonly<Record<Mock.AppointmentType, SalesFollowUpKind>> = {
  DEMO: 'DEMO',
  INITIAL_CONSULTATION: 'CONSULTATION',
  FOLLOW_UP: 'CALL',
  PROPOSAL_REVIEW: 'MEETING',
  TRIAL_CHECK_IN: 'CALL',
  CHECK_IN: 'CALL',
};

export function appointmentTypeLabel(type: AppointmentType): string {
  return type === 'CALL' || type === 'MEETING'
    ? SALES_FOLLOW_UP_KIND_LABELS[type]
    : mockAppointmentTypeLabel(type);
}

/** The appointment type a follow-up reads as: by its title, else by its kind. */
function appointmentTypeOf(kind: SalesFollowUpKind, title: string): AppointmentType {
  const named = APPOINTMENT_TYPES.find(
    (type) =>
      APPOINTMENT_KIND[type.id] === kind && type.label.toLowerCase() === title.trim().toLowerCase(),
  );
  if (named) return named.id;
  if (kind === 'DEMO' || kind === 'FOLLOW_UP') return kind;
  return kind === 'CONSULTATION' ? 'INITIAL_CONSULTATION' : kind;
}

// ---------- Errors ----------

/** A feature the API has no data or route for yet: 422 with the plain message the screen shows. */
class SalesNotYetError extends ApiRequestError {
  constructor(message: string) {
    super(422, 'NOT_SUPPORTED_YET', message);
    this.name = 'SalesNotYetError';
  }
}
/** The contract's check on a value the form has no field for. */
class SalesInputError extends ApiRequestError {
  constructor(message: string) {
    super(400, 'VALIDATION_FAILED', message);
    this.name = 'SalesInputError';
  }
}
const notYet = (message: string) => new SalesNotYetError(message);

/**
 * lib/errors' errorMessage with the Sales codes (SALES_ERRORS). The checks made in this file (a
 * field's message, a feature not available yet) read as written.
 */
export function errorMessage(error: unknown): string {
  if (
    error instanceof SalesFieldError ||
    error instanceof SalesNotYetError ||
    error instanceof SalesInputError
  )
    return error.message;
  return baseErrorMessage(error, SALES_ERRORS);
}

interface Issue {
  readonly path: readonly PropertyKey[];
  readonly message: string;
}
interface Checked {
  safeParse(
    value: unknown,
  ): { success: true } | { success: false; error: { issues: readonly Issue[] } };
}

/**
 * The contract's checks before anything is sent, each message next to the field `field` names
 * for the issue's path (the client would send one message for the whole form).
 */
function check(
  schema: Checked,
  value: unknown,
  field: (path: readonly PropertyKey[]) => string | undefined,
): void {
  const result = schema.safeParse(value);
  if (result.success) return;
  const fields: Record<string, string> = {};
  for (const issue of result.error.issues) {
    const key = field(issue.path);
    if (key) fields[key] ??= issue.message;
  }
  if (Object.keys(fields).length) throw new SalesFieldError(fields);
  throw new SalesInputError(result.error.issues[0]?.message ?? 'Check the form.');
}
/** The field of a path's first key. */
const top = (fields: Readonly<Record<string, string>>) => (path: readonly PropertyKey[]) =>
  fields[String(path[0])];

/** The API's codes for one field (`codes`: code → field) go next to that field. */
async function fieldsOf<T>(call: Promise<T>, codes: Readonly<Record<string, string>>): Promise<T> {
  try {
    return await call;
  } catch (error) {
    const field = error instanceof ApiRequestError ? codes[error.code] : undefined;
    if (field) throw new SalesFieldError({ [field]: errorMessage(error) });
    throw error;
  }
}

const LOST_CODES = {
  LOST_REASON_REQUIRED: 'lostReason',
  LOST_NOTE_REQUIRED: 'lostNote',
  STAGE_INACTIVE: 'stageId',
};

// ---------- Plans ----------

let plans: ApiPlan[] | undefined;
let loadingPlans: Promise<ApiPlan[]> | undefined;

/** Names, prices and the code ↔ id lookup: read once, and again on every plans(). */
function loadPlans(fresh = false): Promise<ApiPlan[]> {
  if (fresh || !loadingPlans)
    loadingPlans = api.adminSales.plans().then(
      (list) => (plans = list),
      (error: unknown) => {
        loadingPlans = undefined;
        throw error;
      },
    );
  return loadingPlans;
}

const isPlanId = (code: string): code is PlanId => (PLAN_IDS as readonly string[]).includes(code);
const planOfCode = (code: PlanId) => plans?.find((plan) => plan.code === code);
const perMonth = (cents: number, cycle: PlatformBillingCycle) =>
  cycle === 'ANNUAL' ? Math.floor(cents / 12) : cents;

/** The plan's id for a request (null for none); a plan no longer listed is the form's error. */
async function planIdOf(code: PlanId | '' | null): Promise<string | null> {
  if (!code) return null;
  const plan = (await loadPlans()).find((item) => item.code === code);
  if (!plan) throw new SalesFieldError({ plan: SALES_ERRORS.INACTIVE_CHOICE });
  return plan.id;
}

export const planName: (plan: PlanId) => string = MOCKED
  ? mockPlanName
  : (plan) => planOfCode(plan)?.name ?? plan;
/** No column keeps extra users (note 2): the forms' field stays hidden on the API. */
export const maxExtraUsers: (plan: PlanId) => number = MOCKED ? mockMaxExtraUsers : () => 0;
/** The forms' price preview: the plan's price a month with its add-ons. */
export const monthlyCents: (plan: PlanId, extraUsers: number, extraLocations: number) => number =
  MOCKED
    ? mockMonthlyCents
    : (plan, extraUsers, extraLocations) => {
        const found = planOfCode(plan);
        return found
          ? perMonth(salesPlanPriceCents(found, extraUsers, extraLocations), found.billingCycle)
          : 0;
      };

const dollars = (cents: number) => `$${(cents / 100).toLocaleString('en-US')}`;

/** A plan card from the stored plan: the lines the numbers give, no marketing copy (note 1). */
function planOut(plan: ApiPlan & { code: PlanId }): SalesPlan {
  const cycle = plan.billingCycle === 'ANNUAL' ? 'yr' : 'mo';
  const seats =
    plan.maxSeats === plan.includedSeats
      ? `${plan.includedSeats} ${plan.includedSeats === 1 ? 'user' : 'users'}`
      : plan.maxSeats === null
        ? `${plan.includedSeats} users included`
        : `${plan.includedSeats} included; up to ${plan.maxSeats}`;
  const expansion = [
    plan.seatPriceCents !== null && plan.maxSeats !== plan.includedSeats
      ? `Users ${plan.includedSeats + 1}${plan.maxSeats === null ? '+' : `–${plan.maxSeats}`}: +${dollars(plan.seatPriceCents)}/user/${cycle}`
      : null,
    plan.locationPriceCents !== null
      ? `+${dollars(plan.locationPriceCents)}/location/${cycle} from location ${plan.includedLocations + 1}`
      : null,
  ].filter((line): line is string => line !== null);
  return {
    id: plan.code,
    name: plan.name,
    tagline: '',
    outcome: '',
    whyUpgrade: '',
    priceCents: perMonth(plan.priceCents, plan.billingCycle),
    priceFrom: false,
    capacity: seats,
    expansion: expansion.join('; ') || '—',
    locations:
      plan.includedLocations === 1 ? '1 location' : `Up to ${plan.includedLocations} included`,
    bestFit: '',
    highlights: [seats, ...expansion],
    features: plan.features.map((feature) => feature.label),
    upgradeTrigger: '',
    // No self-serve trial is stored and trials are not available yet (note 31).
    trial: false,
  };
}

// ---------- Records ----------

const typeOut = (type: SalesStageType): StageType =>
  type === 'TRANSACTION_SYNCED' ? 'TRANSACTION' : type;
const typeIn = (type: StageType): SalesStageType =>
  type === 'TRANSACTION' ? 'TRANSACTION_SYNCED' : type;
const isApiRequirement = (need: StageRequirement): need is SalesStageRequirement =>
  (API_REQUIREMENTS as readonly string[]).includes(need);

function stageOut(stage: ApiStage): PipelineStage {
  return {
    id: stage.id,
    name: stage.name,
    type: typeOut(stage.type),
    tone: stage.tone,
    active: stage.active,
    // A lost stage always needs its reason (B5); the database lists only the other requirements.
    requires: [...(stage.type === 'LOST' ? (['LOST_REASON'] as const) : []), ...stage.requires],
    automation: stage.onEnter[0] ?? 'NONE',
  };
}

/** The pipelines as last read: the builder's colours are checked against them. */
const pipelinesRead = new Map<string, ApiPipeline>();

function pipelineOut(pipeline: ApiPipeline): SalesPipeline {
  pipelinesRead.set(pipeline.id, pipeline);
  return {
    id: pipeline.id,
    name: pipeline.name,
    description: pipeline.description,
    isDefault: pipeline.isDefault,
    stages: pipeline.stages.map(stageOut),
    createdAt: pipeline.createdAt,
    updatedAt: pipeline.updatedAt,
    recordCounts: Object.fromEntries(pipeline.stages.map((stage) => [stage.id, stage.records])),
  };
}

/** The firm's subscription as the panel names it; there is no reference or link time. */
function transactionOut(
  transaction: ApiTransaction | null,
  closedAt: string | null,
): LinkedTransaction | null {
  if (!transaction) return null;
  const subscription = transaction.subscription;
  return {
    reference: subscription
      ? `${subscription.firm.name} · ${subscription.plan.name}`
      : 'Platform subscription',
    status: transaction.status,
    linkedAt: null,
    estimatedCloseAt: null,
    closedAt: transaction.status === 'CLOSED' ? closedAt : null,
    syncedAt: transaction.syncedAt,
  };
}

function opportunityOut(opp: ApiOpportunity): SalesOpportunity {
  const next = opp.nextAppointment;
  return {
    id: opp.id,
    pipelineId: opp.pipelineId,
    stageId: opp.stageId,
    stageName: opp.stageName,
    stageType: typeOut(opp.stageType),
    stageTone: opp.stageTone,
    stageOrder: opp.stageOrder,
    firmName: opp.firmName,
    contactName: opp.contactName,
    email: opp.email,
    phone: opp.phone,
    valueCents: opp.valueCents,
    plan: opp.plan && isPlanId(opp.plan.code) ? opp.plan.code : null,
    extraUsers: 0,
    extraLocations: 0,
    // The plan's base price (note 2).
    monthlyCents: opp.plan ? perMonth(opp.plan.priceCents, opp.plan.billingCycle) : null,
    source: opp.source,
    owner: opp.owner ? { id: opp.owner.id, name: opp.owner.name, role: opp.owner.role } : null,
    tags: opp.tags.map(({ id, name }) => ({ id, name })),
    createdAt: opp.createdAt,
    stageEnteredAt: opp.stageEnteredAt,
    lastActivityAt: opp.lastActivityAt,
    attempts: opp.attempts,
    contactedAt: opp.contactedAt,
    nextFollowUpAt: opp.nextFollowUp?.dueAt ?? null,
    nextStep: null,
    trialStartedAt: opp.trial?.startedAt ?? null,
    trialEndsAt: opp.trial?.endsAt ?? null,
    trialActive: opp.trial?.active ?? false,
    convertedAt: opp.convertedAt,
    closedAt: opp.closedAt,
    lostAt: opp.lostAt,
    lostReason: opp.lostReason,
    lostNote: opp.lostNote,
    transaction: transactionOut(opp.transaction, opp.closedAt),
    attention: opp.attention,
    nextAppointment: next
      ? { id: next.id, type: appointmentTypeOf(next.kind, next.title), startsAt: next.dueAt }
      : null,
  };
}

function appointmentOut(item: SalesFollowUp): SalesAppointment {
  return {
    id: item.id,
    opportunityId: item.opportunityId,
    firmName: item.firmName,
    contactName: item.contactName,
    type: appointmentTypeOf(item.kind, item.title),
    startsAt: item.dueAt,
    assignedId: item.assignee?.id ?? null,
    assignedName: item.assignee?.name ?? null,
    status: item.status,
    createdAt: item.createdAt,
  };
}

const taskOut = (item: SalesFollowUp): Mock.SalesTask => ({
  id: item.id,
  opportunityId: item.opportunityId,
  title: item.title,
  dueAt: item.dueAt,
  done: item.status === 'COMPLETED',
  completedAt: item.completedAt,
});

function communicationOut(item: ApiCommunication, opportunityId: string): SalesCommunication {
  const outcome = item.outcome ? SALES_ACTIVITY_OUTCOME_LABELS[item.outcome].toLowerCase() : null;
  const kind = SALES_ACTIVITY_KIND_LABELS[item.kind];
  return {
    id: item.id,
    opportunityId,
    channel: item.kind,
    direction: item.direction,
    summary: item.summary ?? (outcome ? `${kind}: ${outcome}` : kind),
    at: item.occurredAt,
    by: item.by,
  };
}

/** The mock's kind for a feed entry (its marker and badge); the line is the contract's. */
function feedKind(entry: SalesFeedEntry): Mock.ActivityKind {
  switch (entry.kind) {
    case 'COMMUNICATION': {
      const done = entry.communication;
      const reached =
        done !== null &&
        (done.direction === 'INBOUND' ||
          (done.outcome !== null && SALES_TWO_WAY_OUTCOMES.includes(done.outcome)));
      return reached ? 'CONTACTED' : 'OUTREACH_ATTEMPT';
    }
    case 'FOLLOW_UP_SCHEDULED':
      return entry.followUp?.kind === 'FOLLOW_UP' ? 'FOLLOW_UP_ADDED' : 'APPOINTMENT_SCHEDULED';
    case 'FOLLOW_UP_CANCELLED':
      return 'UPDATED';
    case 'UNASSIGNED':
      return 'REASSIGNED';
    default:
      return entry.kind;
  }
}

function feedOut(entry: SalesFeedEntry): Mock.SalesActivity {
  return {
    // The source row's id is unique only with its kind (a follow-up gives two entries).
    id: `${entry.kind}-${entry.id}`,
    opportunityId: entry.opportunityId,
    firmName: entry.firmName,
    kind: feedKind(entry),
    text: salesFeedText(entry),
    actor: {
      kind:
        entry.actor.kind === 'USER'
          ? 'USER'
          : entry.source === 'AUTOMATION'
            ? 'AUTOMATION'
            : 'SYSTEM',
      name: entry.actor.name,
    },
    at: entry.at,
    valueCents: entry.valueCents,
    fromStage: entry.fromStage,
    toStage: entry.toStage,
    detail: salesFeedDetail(entry),
  };
}

const trendOut = (trend: number | null): Mock.SalesTrend | undefined =>
  trend === null
    ? undefined
    : trend === 0
      ? { direction: 'flat', percent: 0 }
      : { direction: trend > 0 ? 'up' : 'down', percent: Math.abs(trend) };
const metricOut = (value: number, trend: number | null): SalesMetric => {
  const shown = trendOut(trend);
  return shown ? { value, trend: shown } : { value };
};
const centerMetric = (metric: ApiMetric) => metricOut(metric.value, metric.trend);

/** The KPI cards' record sets (note 25): the mock's PIPELINE and OPEN are one set. */
const SET: Readonly<Record<Mock.OpportunityScope, SalesOpportunitySet>> = {
  IN_PROGRESS: 'IN_PROGRESS',
  PIPELINE: 'OPEN',
  OPEN: 'OPEN',
  CONVERTED: 'CONVERTED',
  CLIENTS: 'ACTIVE_CLIENTS',
};

/** The screen's filters in the contract's terms; null when a plan filter names no plan. */
async function listQuery(query: Mock.OpportunityQuery): Promise<SalesOpportunitiesQuery | null> {
  const planId = query.plan ? (await loadPlans()).find((p) => p.code === query.plan)?.id : null;
  if (planId === undefined) return null;
  return {
    pipelineId: query.pipelineId || undefined,
    search: query.search?.trim() || undefined,
    stageIds: query.stageId ? [query.stageId] : undefined,
    ownerId: query.ownerId || undefined,
    unassigned: query.unassignedOnly || undefined,
    planId: planId ?? undefined,
    source: query.source,
    tagId: query.tagId || undefined,
    from: query.from || undefined,
    to: query.to || undefined,
    overdue: query.overdueOnly || undefined,
    attention: query.attentionOnly || undefined,
    set: query.scope ? SET[query.scope] : undefined,
  };
}

const periodQuery = (period: Mock.PeriodInput) =>
  typeof period === 'object' ? { from: period.from, to: period.to } : { period };

/** A day and time from the form (the browser's local time), or null when either is missing. */
function localTime(day: string, time: string): number | null {
  const [year, month, date] = day.split('-').map(Number);
  const [hours, minutes] = time.split(':').map(Number);
  if (!year || !month || !date || hours === undefined || minutes === undefined) return null;
  if (Number.isNaN(hours) || Number.isNaN(minutes)) return null;
  return new Date(year, month - 1, date, hours, minutes).getTime();
}
const startOfToday = () => new Date(new Date().setHours(0, 0, 0, 0)).getTime();

const MATCHED_ON = { EMAIL: 'email', PHONE: 'phone', FIRM_NAME: 'firm name' } as const;

/** The Card or List choice: no table keeps it (note 33), so it lasts while the console is open. */
let view: SalesView = 'CARD';

// ---------- The client the screens call ----------

const real = {
  /** Reps who take new records, tags, active plans (by code) and pipelines. */
  meta: async (): Promise<Mock.SalesMeta> => {
    const [meta] = await Promise.all([api.adminSales.meta(), loadPlans()]);
    const { managePipelines, assign, bulkEdit, export: canExport } = meta.permissions;
    return {
      reps: meta.reps.flatMap(({ id, name, role, active }) => (active ? [{ id, name, role }] : [])),
      tags: meta.tags.map(({ id, name }) => ({ id, name })),
      plans: meta.plans.flatMap((plan) =>
        plan.active && isPlanId(plan.code) ? [{ id: plan.code, name: plan.name }] : [],
      ),
      pipelines: meta.pipelines.map(({ id, name, isDefault }) => ({ id, name, isDefault })),
      defaultPipelineId: meta.defaultPipelineId,
      today: meta.today,
      permissions: { managePipelines, assign, bulkEdit, export: canExport },
    };
  },

  plans: async (): Promise<SalesPlan[]> =>
    (await loadPlans(true)).flatMap((plan) =>
      plan.active && isPlanId(plan.code) ? [planOut({ ...plan, code: plan.code })] : [],
    ),

  centerKpis: async (period: SalesPeriod): Promise<CenterKpis> => {
    const kpis = await api.adminSales.centerKpis({ period });
    return {
      totalLeads: centerMetric(kpis.totalLeads),
      demosScheduled: centerMetric(kpis.demosScheduled),
      activeTrials: centerMetric(kpis.activeTrials),
      wonDeals: centerMetric(kpis.wonDeals),
      lostDeals: centerMetric(kpis.lostDeals),
      projectedMrrCents: centerMetric(kpis.projectedMrrCents),
    };
  },

  /** The whole pipeline, as the mock's KPI row (the cards then open their set). */
  pipelineKpis: async (pipelineId?: string): Promise<PipelineKpis> => {
    const kpis = await api.adminSales.pipelineKpis(pipelineId ? { pipelineId } : {});
    return {
      totalOpportunities: metricOut(kpis.totalOpportunities, kpis.trends.totalOpportunities),
      inProgress: metricOut(kpis.inProgress, kpis.trends.inProgress),
      pipelineValueCents: metricOut(kpis.pipelineValueCents, kpis.trends.pipelineValueCents),
      conversionRate: metricOut(Math.round(kpis.conversion.rateBp / 100), kpis.trends.conversion),
      activeClients: kpis.activeClients,
      needsAttention: kpis.needsAttention,
    };
  },

  stageCounts: async (period: Mock.PeriodInput, pipelineId?: string): Promise<Mock.StageCount[]> =>
    (
      await api.adminSales.stageCounts({
        ...periodQuery(period),
        ...(pipelineId ? { pipelineId } : {}),
      })
    ).stages.map((stage) => ({
      stageId: stage.stageId,
      name: stage.name,
      tone: stage.tone,
      type: typeOut(stage.type),
      count: stage.count,
      valueCents: stage.valueCents,
    })),

  /**
   * The estimated value of the deals won, in the mock's families (the Solo plans together); a plan
   * outside the six codes and deals without a plan get their own slice. No add-ons (note 22).
   */
  revenueByPlan: async (period: SalesPeriod): Promise<RevenueByPlan> => {
    const revenue = await api.adminSales.revenueByPlan({ period });
    const slices: RevenueSlice[] = [
      { id: 'SOLO', label: 'Solo Plans', cents: 0 },
      { id: 'TEAM_PRO', label: 'Team Pro', cents: 0 },
      { id: 'BUSINESS', label: 'Business', cents: 0 },
      { id: 'ENTERPRISE', label: 'Enterprise', cents: 0 },
    ];
    for (const slice of revenue.slices) {
      const id: RevenueSlice['id'] =
        slice.code === null
          ? 'NO_PLAN'
          : slice.code.startsWith('SOLO_')
            ? 'SOLO'
            : slice.code === 'TEAM_PRO' || slice.code === 'BUSINESS' || slice.code === 'ENTERPRISE'
              ? slice.code
              : 'OTHER';
      let family = slices.find((item) => item.id === id);
      if (!family) {
        if (id === 'OTHER' && slice.cents === 0) continue;
        family = { id, label: id === 'NO_PLAN' ? 'No plan' : 'Other plans', cents: 0 };
        slices.push(family);
      }
      if (id !== 'SOLO' && id !== 'OTHER' && id !== 'NO_PLAN') family.label = slice.name;
      family.cents += slice.cents;
    }
    return { totalCents: revenue.totalCents, slices };
  },

  leadSources: async (period: SalesPeriod): Promise<Mock.SourceShare[]> =>
    (await api.adminSales.leadSources({ period })).items.map((item) => ({
      source: item.source,
      label: sourceLabel(item.source),
      count: item.count,
      percent: item.percent,
    })),

  activity: async (
    query: { limit?: number; kinds?: 'sales' | 'all'; pipelineId?: string } = {},
  ): Promise<Mock.SalesActivity[]> => {
    const sales = query.kinds === 'sales';
    const entries = (
      await api.adminSales.activity({
        pipelineId: query.pipelineId,
        kinds: sales ? [...SALES_CENTER_FEED_KINDS] : undefined,
        // FOLLOW_UP_SCHEDULED also brings plain follow-up tasks, dropped below: ask for more.
        limit: sales && query.limit ? Math.min(100, query.limit * 4) : query.limit,
      })
    ).map(feedOut);
    // As in the mock, the Sales Center's sales events are appointments, not follow-up tasks.
    if (!sales) return entries;
    return entries.filter((e) => e.kind !== 'FOLLOW_UP_ADDED').slice(0, query.limit);
  },

  /** Scheduled appointments from now on (tasks are not appointments, as in the mock). */
  appointments: async (
    query: { limit?: number; pipelineId?: string } = {},
  ): Promise<SalesAppointment[]> =>
    (
      await api.adminSales.appointments({
        pipelineId: query.pipelineId,
        kinds: [...SALES_APPOINTMENT_KINDS],
        limit: query.limit,
      })
    ).map(appointmentOut),

  /** Filtered by the API; the board reads every page (500 a page, the API's 5,000 at most). */
  opportunities: async (query: Mock.OpportunityQuery = {}): Promise<SalesOpportunity[]> => {
    const filters = await listQuery(query);
    if (!filters) return [];
    const items: ApiOpportunity[] = [];
    for (let page = 1; page <= 10; page += 1) {
      const result = await api.adminSales.opportunities({ ...filters, page, pageSize: 500 });
      items.push(...result.items);
      if (items.length >= result.total || result.items.length < result.pageSize) break;
    }
    return items.map(opportunityOut);
  },

  opportunity: async (id: string): Promise<OpportunityRecord> => {
    if (!SalesOpportunityId.safeParse(id).success)
      throw new ApiRequestError(404, 'NOT_FOUND', SALES_ERRORS.NOT_FOUND);
    const [record] = await Promise.all([api.adminSales.opportunity(id), loadPlans()]);
    const appointments = record.followUps.filter((item) => item.kind !== 'FOLLOW_UP');
    return {
      opportunity: opportunityOut(record.opportunity),
      pipeline: {
        id: record.pipeline.id,
        name: record.pipeline.name,
        stages: record.pipeline.stages.map(stageOut),
      },
      notes: record.notes.map((note) => ({
        id: note.id,
        opportunityId: id,
        body: note.body,
        author: note.author.name,
        createdAt: note.createdAt,
      })),
      // Follow-ups are cancelled, never deleted; a cancelled task leaves the list.
      tasks: record.followUps
        .filter((item) => item.kind === 'FOLLOW_UP' && item.status !== 'CANCELLED')
        .map(taskOut),
      // Newest first, as the mock listed them.
      appointments: appointments.map(appointmentOut).reverse(),
      communications: record.communications.map((item) => communicationOut(item, id)),
      // No table keeps proposals or other documents for a prospect (note 30).
      documents: [],
      activity: record.activity.map(feedOut),
    };
  },

  /**
   * Add Lead. A probable duplicate is 409 POSSIBLE_DUPLICATE without the matches, so they are read
   * with duplicates() and thrown as the mock's SalesDuplicateError.
   */
  createOpportunity: async (body: SaveOpportunity): Promise<SalesOpportunity> => {
    if (!body.source) throw new SalesFieldError({ source: 'Choose where this lead came from.' });
    const input: CreateSalesOpportunityRequest = {
      requestId: body.requestId ?? crypto.randomUUID(),
      ...(body.pipelineId ? { pipelineId: body.pipelineId } : {}),
      ...(body.stageId ? { stageId: body.stageId } : {}),
      firmName: body.firmName,
      contactName: body.contactName,
      email: body.email.trim() || null,
      phone: body.phone.trim() || null,
      source: body.source,
      planId: await planIdOf(body.plan),
      valueCents: body.valueCents,
      ownerId: body.ownerId || null,
      tagIds: body.tagIds,
      note: body.notes.trim() || null,
      ...(body.lostReason ? { lostReason: body.lostReason } : {}),
      ...(body.lostNote?.trim() ? { lostNote: body.lostNote } : {}),
      allowDuplicate: body.allowDuplicate ?? false,
    };
    check(
      CreateSalesOpportunityRequest,
      input,
      top({
        firmName: 'firmName',
        contactName: 'contactName',
        email: 'email',
        phone: 'phone',
        source: 'source',
        planId: 'plan',
        valueCents: 'valueCents',
        ownerId: 'ownerId',
        tagIds: 'tagIds',
        note: 'notes',
        lostReason: 'lostReason',
        lostNote: 'lostNote',
        stageId: 'stageId',
      }),
    );
    try {
      return opportunityOut(
        await fieldsOf(api.adminSales.createOpportunity(input), {
          ...LOST_CODES,
          VALUE_REQUIRED: 'valueCents',
          OWNER_REQUIRED: 'ownerId',
          PLAN_REQUIRED: 'plan',
        }),
      );
    } catch (error) {
      if (!(error instanceof ApiRequestError) || error.code !== 'POSSIBLE_DUPLICATE') throw error;
      const matches = await api.adminSales.duplicates({
        firmName: input.firmName,
        email: input.email,
        phone: input.phone,
      });
      if (!matches.length) throw error;
      throw new SalesDuplicateError(
        matches.map((match) => ({
          id: match.opportunityId,
          firmName: match.firmName,
          contactName: match.contactName,
          stageName: match.stageName,
          matchedOn: match.matchedOn.map((on) => MATCHED_ON[on]).join(', '),
        })),
      );
    }
  },

  /** A lost stage's reason and note come with the move; the transaction is never typed in. */
  moveStage: async (
    body: { id: string; stageId: string } & StageEntryInput,
  ): Promise<SalesOpportunity> => {
    const input: MoveSalesStageRequest = {
      stageId: body.stageId,
      ...(body.lostReason ? { lostReason: body.lostReason } : {}),
      ...(body.lostNote?.trim() ? { lostNote: body.lostNote } : {}),
    };
    check(MoveSalesStageRequest, input, top({ lostReason: 'lostReason', lostNote: 'lostNote' }));
    return opportunityOut(await fieldsOf(api.adminSales.moveStage(body.id, input), LOST_CODES));
  },

  bulkStage: async (
    body: { ids: string[]; stageId: string } & StageEntryInput,
  ): Promise<{ updated: number }> => {
    if (!body.ids.length) throw new SalesFieldError({ ids: 'Select at least one record.' });
    const lost = {
      ...(body.lostReason ? { lostReason: body.lostReason } : {}),
      ...(body.lostNote?.trim() ? { lostNote: body.lostNote } : {}),
    };
    check(MoveSalesStageRequest, { stageId: body.stageId, ...lost }, (path) =>
      path[0] === 'stageId'
        ? 'stageId'
        : top({ lostReason: 'lostReason', lostNote: 'lostNote' })(path),
    );
    const result = await fieldsOf(
      api.adminSales.bulk({
        ids: body.ids,
        confirmedCount: body.ids.length,
        action: { type: 'STAGE', stageId: body.stageId, ...lost },
      }),
      LOST_CODES,
    );
    return { updated: result.updated };
  },

  /** One record through its own route (the `assign` right), several through bulk. */
  assign: async (body: { ids: string[]; ownerId: string | null }): Promise<{ updated: number }> => {
    const [first, ...others] = body.ids;
    if (!first) throw new SalesFieldError({ ids: 'Select at least one record.' });
    const codes = { INACTIVE_CHOICE: 'ownerId' };
    if (!others.length) {
      await fieldsOf(api.adminSales.assign(first, { ownerId: body.ownerId }), codes);
      return { updated: 1 };
    }
    const result = await fieldsOf(
      api.adminSales.bulk({
        ids: body.ids,
        confirmedCount: body.ids.length,
        action: { type: 'ASSIGN', ownerId: body.ownerId },
      }),
      codes,
    );
    return { updated: result.updated };
  },

  bulkTag: async (body: { ids: string[]; tagId: string }): Promise<{ updated: number }> => {
    if (!body.tagId) throw new SalesFieldError({ tagId: 'Choose a tag.' });
    if (!body.ids.length) throw new SalesFieldError({ ids: 'Select at least one record.' });
    const result = await api.adminSales.bulk({
      ids: body.ids,
      confirmedCount: body.ids.length,
      action: { type: 'ADD_TAG', tagId: body.tagId },
    });
    return { updated: result.updated };
  },

  /** The record's own data. Extra users and the next step have no column (notes 2, 32). */
  updateOpportunity: async (body: {
    id: string;
    firmName: string;
    contactName: string;
    email: string;
    phone: string;
    valueCents: number | null;
    plan: PlanId | '';
    extraUsers: number;
    source: Mock.LeadSource;
    tagIds: string[];
    nextStep: string;
  }): Promise<SalesOpportunity> => {
    if (body.nextStep.trim())
      throw notYet('The next step cannot be saved yet. Clear it to save your other changes.');
    if (!body.email.trim() && !body.phone.trim())
      throw new SalesFieldError({ email: 'Enter an email or a phone number.' });
    const input: UpdateSalesOpportunityRequest = {
      firmName: body.firmName,
      contactName: body.contactName,
      email: body.email.trim() || null,
      phone: body.phone.trim() || null,
      valueCents: body.valueCents,
      planId: await planIdOf(body.plan),
      source: body.source,
      tagIds: body.tagIds,
    };
    check(
      UpdateSalesOpportunityRequest,
      input,
      top({
        firmName: 'firmName',
        contactName: 'contactName',
        email: 'email',
        phone: 'phone',
        valueCents: 'valueCents',
        planId: 'plan',
        source: 'source',
      }),
    );
    return opportunityOut(await api.adminSales.updateOpportunity(body.id, input));
  },

  addNote: async (body: { id: string; body: string }): Promise<Mock.SalesNote> => {
    const input = { body: body.body };
    check(SaveSalesNoteRequest, input, top({ body: 'body' }));
    const note = await api.adminSales.addNote(body.id, input);
    return {
      id: note.id,
      opportunityId: body.id,
      body: note.body,
      author: note.author.name,
      createdAt: note.createdAt,
    };
  },

  /** A task (FOLLOW_UP) due at 9:00 on the chosen day; today or later, as the mock asked. */
  addFollowUp: async (body: {
    id: string;
    title: string;
    dueDate: string;
  }): Promise<Mock.SalesTask> => {
    const errors: Record<string, string> = {};
    const due = localTime(body.dueDate, '09:00');
    if (!body.title.trim()) errors['title'] = 'Describe the follow-up.';
    if (due === null) errors['dueDate'] = 'Choose the due date.';
    else if (due < startOfToday()) errors['dueDate'] = 'Choose today or a later date.';
    if (Object.keys(errors).length || due === null) throw new SalesFieldError(errors);
    const input: CreateSalesFollowUpRequest = {
      kind: 'FOLLOW_UP',
      title: body.title,
      dueAt: new Date(due).toISOString(),
    };
    check(CreateSalesFollowUpRequest, input, top({ title: 'title', dueAt: 'dueDate' }));
    return taskOut(await api.adminSales.addFollowUp(body.id, input));
  },

  completeFollowUp: async (taskId: string): Promise<Mock.SalesTask> =>
    taskOut(await api.adminSales.completeFollowUp(taskId)),

  /**
   * An appointment: its type's kind, with the type's name as the title. Booking one for a record
   * in an earlier active stage moves it to Appointment Set (the API does it, note 16).
   */
  scheduleAppointment: async (
    body: { opportunityId: string } & AppointmentInput,
  ): Promise<SalesAppointment> => {
    const errors: Record<string, string> = {};
    const type = APPOINTMENT_TYPES.find((item) => item.id === body.type);
    const day = localTime(body.date, '00:00');
    const start = localTime(body.date, body.time);
    if (!type) errors['appointmentType'] = 'Choose the appointment type.';
    if (day === null) errors['appointmentDate'] = 'Choose the appointment date.';
    else if (day < startOfToday()) errors['appointmentDate'] = 'Choose today or a later date.';
    if (!/^\d{2}:\d{2}$/.test(body.time)) errors['appointmentTime'] = 'Choose a time.';
    if (Object.keys(errors).length || !type || start === null) throw new SalesFieldError(errors);
    const input: CreateSalesFollowUpRequest = {
      kind: APPOINTMENT_KIND[type.id],
      title: type.label,
      dueAt: new Date(start).toISOString(),
      // Left out: the record's owner.
      ...(body.assignedId ? { assigneeId: body.assignedId } : {}),
    };
    check(CreateSalesFollowUpRequest, input, top({ dueAt: 'appointmentDate' }));
    return appointmentOut(
      await fieldsOf(api.adminSales.addFollowUp(body.opportunityId, input), {
        INACTIVE_CHOICE: 'appointmentAssignedId',
      }),
    );
  },

  /** Reached: a call or meeting connected, a message replied to; not reached: a call unanswered. */
  logOutreach: async (body: {
    id: string;
    channel: SalesCommunication['channel'];
    reached: boolean;
    summary: string;
  }): Promise<SalesOpportunity> => {
    const spoken = body.channel === 'CALL' || body.channel === 'MEETING';
    const input: LogSalesActivityRequest = {
      kind: body.channel,
      direction: 'OUTBOUND',
      outcome: body.reached
        ? spoken
          ? 'CONNECTED'
          : 'REPLIED'
        : body.channel === 'CALL'
          ? 'NO_ANSWER'
          : null,
      summary: body.summary,
    };
    check(LogSalesActivityRequest, input, top({ summary: 'summary' }));
    const [opp] = await Promise.all([api.adminSales.logOutreach(body.id, input), loadPlans()]);
    return opportunityOut(opp);
  },

  /** A trial is a firm's platform subscription, which a prospect has none of (note 31). */
  startTrial: async (_body: {
    opportunityId: string;
    plan: PlanId | '';
  }): Promise<SalesOpportunity> => {
    throw notYet('Trials are not available yet.');
  },

  /**
   * Create Offer / Proposal: the plan and the value go on the record (note 30); no proposal
   * document is kept, and a missing value stays missing (the mock made one up).
   */
  sendProposal: async (body: {
    opportunityId: string;
    plan: PlanId | '';
    extraUsers: number;
    valueCents: number | null;
  }): Promise<SalesOpportunity> => {
    if (!body.plan) throw new SalesFieldError({ plan: 'Choose a plan.' });
    const input: UpdateSalesOpportunityRequest = {
      planId: await planIdOf(body.plan),
      ...(body.valueCents === null ? {} : { valueCents: body.valueCents }),
    };
    check(UpdateSalesOpportunityRequest, input, top({ valueCents: 'valueCents', planId: 'plan' }));
    return opportunityOut(await api.adminSales.updateOpportunity(body.opportunityId, input));
  },

  /** The transaction picker: firms' platform subscriptions, at most 20 by firm name. */
  subscriptions: async (query: { search?: string } = {}): Promise<SalesLinkableSubscription[]> =>
    api.adminSales.subscriptions(query),

  /** Links the firm's subscription (null unlinks); its status then moves the record. */
  linkTransaction: async (id: string, subscriptionId: string | null): Promise<SalesOpportunity> =>
    opportunityOut(await api.adminSales.linkTransaction(id, { subscriptionId })),

  viewPreference: async (): Promise<SalesView> => view,
  setViewPreference: async (value: SalesView): Promise<SalesView> => {
    view = value === 'LIST' ? 'LIST' : 'CARD';
    return view;
  },

  /** The report is a CSV download (`GET /report`), read here so the screen saves it as before. */
  exportReport: async (period: SalesPeriod): Promise<string> => {
    const response = await sessionFetch(`/api/v1${adminSalesReportPath({ period })}`, {
      headers: { accept: 'text/csv' },
    });
    if (!response.ok) {
      const body = ApiError.safeParse(await response.json().catch(() => undefined));
      const code = body.success ? body.data.error.code : `HTTP_${response.status}`;
      throw new ApiRequestError(response.status, code, body.success ? body.data.error.message : '');
    }
    return response.text();
  },

  pipelines: async (): Promise<SalesPipeline[]> =>
    (await api.adminSales.pipelines()).map(pipelineOut),

  createPipeline: async (body: Mock.CreatePipeline): Promise<SalesPipeline> => {
    check(CreateSalesPipelineRequest, body, top({ name: 'name', description: 'description' }));
    return pipelineOut(
      await fieldsOf(api.adminSales.createPipeline(body), { DUPLICATE_NAME: 'name' }),
    );
  },

  /**
   * Saves the layout in one step (note 7). A stage keeps its colour: no column stores one
   * (note 5), so a changed colour is refused rather than dropped.
   */
  savePipeline: async (body: SavePipeline): Promise<SalesPipeline> => {
    const read = pipelinesRead.get(body.id);
    const expectedUpdatedAt = body.expectedUpdatedAt ?? read?.updatedAt;
    if (!expectedUpdatedAt) throw new ApiRequestError(409, 'CONFLICT', SALES_ERRORS.CONFLICT);
    const recoloured = body.stages.some((stage) => {
      const was = stage.id ? read?.stages.find((item) => item.id === stage.id)?.tone : 'blue';
      return was !== undefined && stage.tone !== was;
    });
    if (recoloured)
      throw notYet('Stage colours cannot be saved yet. Change the colour back to save.');
    const misplaced = body.stages.findIndex(
      (stage) => stage.type !== 'LOST' && stage.requires.includes('LOST_NOTE'),
    );
    if (misplaced >= 0)
      throw new SalesFieldError({
        [`stage-${misplaced}-active`]: 'Only a lost stage can require a lost note.',
      });
    const input: SaveSalesPipelineRequest = {
      expectedUpdatedAt,
      name: body.name,
      description: body.description,
      stages: body.stages.map((stage) => ({
        ...(stage.id ? { id: stage.id } : {}),
        name: stage.name,
        type: typeIn(stage.type),
        active: stage.active,
        requires: stage.requires.filter(isApiRequirement),
        onEnter: stage.automation === 'NONE' ? [] : [stage.automation],
      })),
      removed: body.removed,
    };
    // Each stage's message shows under its row (`stage-<n>-active` is the row's line).
    check(SaveSalesPipelineRequest, input, (path) => {
      const [key, index, part] = path;
      if (key === 'stages' && typeof index === 'number')
        return `stage-${index}-${part === 'name' || part === 'type' ? part : 'active'}`;
      return top({
        name: 'name',
        description: 'description',
        stages: 'stages',
        removed: 'removed',
      })(path);
    });
    return pipelineOut(
      await fieldsOf(api.adminSales.savePipeline(body.id, input), { DUPLICATE_NAME: 'name' }),
    );
  },
};

/**
 * Mock mode: the mock as it is, plus the two calls it never had (the transaction picker). The
 * mock has no firm subscriptions, so its picker stays empty.
 */
const mockMode: typeof real = {
  ...(mockSales as unknown as typeof real),
  subscriptions: async (): Promise<SalesLinkableSubscription[]> => [],
  linkTransaction: async (): Promise<SalesOpportunity> => {
    throw notYet('Linking a subscription needs the Sales API.');
  },
};

/** What the Sales screens call: the API, or the mock in mock mode. */
export const adminSales: typeof real = MOCKED ? mockMode : real;
