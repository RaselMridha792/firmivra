import { z } from 'zod';
import { CalendarDate, MemberRef } from '../clients/schemas.js';
import { clearable, SearchText, text } from '../clients/text.js';
import {
  ClientAccountType,
  OpportunityEventKind,
  OpportunitySource,
  OpportunityStatus,
  PlanInputKind,
  PlanningGoal,
  PlanStrategyStatus,
  PlanVersionEvent,
  StrategyCategory,
  TaskPriority,
  TaxFilingStatus,
  TaxPlanStatus,
  TaxPlanType,
} from '../db-enums.js';

// Tax Planning & Strategy (R55 contract, for the Tax Planning screens): the overview (KPIs, recent
// planning clients, top opportunities, deadlines, resources, quick actions), the Clients tab,
// Create / Edit Planning Plan (client and plan details, financial overview, goals and strategies,
// implementation plan, review and save), the strategy library, the opportunity queue and Planning
// Opportunity Details, the Tax Savings Calculator, the Tax Calendar and Resources. Designs:
// docs/mockups/firm-workspace/tax-planning/source/ and its developer guide.
//
// An estimate is an estimate, never a guarantee: it carries the tax year of the data it used, when
// it was calculated and its basis, and an unavailable estimate is null, never invented. An
// opportunity is not a recommendation until staff review it, and nothing here implements a
// strategy or changes a tax return. A finalized or sent plan keeps an immutable version snapshot.
// Overrides of an estimate need the permission and a reason, and Not Applicable and Dismissed need
// a reason. Firm routes under /api/v1/business (`@Access('TAX_PLANNING')`): Owner and Admin reach
// every client's planning; Staff only their assigned clients' (any other is 404); the grid's
// capabilities decide the rest (Create/Edit plans, Review opportunities, Manage strategies,
// Override estimates, Send plans and resources, View financial inputs, Planning Admin). Money is in
// cents. Responses are plain objects; requests are strict. Audited with ids, statuses and field
// names only, never figures or notes.

const DateTime = z.iso.datetime({ offset: true });
const Page = { total: z.number().int(), page: z.number().int(), pageSize: z.number().int() };
const Cents = z.number().int().min(0).max(100_000_000_000);
const PlanYear = z.number().int().min(2000).max(2100);
/** A plan year in a query string. */
const QueryYear = z.coerce.number().int().min(2000).max(2100);

export const TaxPlanId = z.uuid();
export const PlanStrategyId = z.uuid();
export const PlanDocumentId = z.uuid();
export const PlanningStrategyId = z.uuid();
export const TaxOpportunityId = z.uuid();
export const TaxScenarioId = z.uuid();
export const PlanVersionNumber = z.number().int().min(1);
/** A resource of the approved catalog (`year-end-planning-checklist`). */
export const PlanningResourceKey = z.string().regex(/^[a-z][a-z0-9-]{1,79}$/, 'Use a resource key');

const ClientRef = z.object({
  id: z.uuid(),
  name: z.string(),
  accountType: ClientAccountType,
  email: z.string().nullable(),
  phone: z.string().nullable(),
});
export type PlanningClientRef = z.infer<typeof ClientRef>;

/**
 * A savings estimate: `cents` is the model's figure (null: unavailable, with `unavailableReason`),
 * `dataYear` the tax year of the data it used, `basis` plain words ("Based on current year data"),
 * `overridden` when an authorized person replaced it (then `modelCents` is what the model said).
 */
export const SavingsEstimate = z.object({
  cents: z.number().int().nullable(),
  modelCents: z.number().int().nullable(),
  overridden: z.boolean(),
  dataYear: z.number().int().nullable(),
  calculatedAt: DateTime.nullable(),
  basis: z.string().nullable(),
  unavailableReason: z.string().nullable(),
});
export type SavingsEstimate = z.infer<typeof SavingsEstimate>;

/** Shown wherever an estimate is, and on every client-facing output. */
export const TAX_PLANNING_DISCLAIMER =
  'Estimates are based on the information provided and current tax law. Actual results may vary.';

// ---------- Overview ----------

export const PlanningKpi = z.object({
  value: z.number().int(),
  /** Percent change against the comparison period; null when it cannot be told. */
  deltaPercent: z.number().nullable(),
  /** "vs last quarter". */
  comparedTo: z.string().nullable(),
});
export type PlanningKpi = z.infer<typeof PlanningKpi>;

/** A client in planning: the Recent Planning Clients rows and the Clients tab. */
export const PlanningClientRow = z.object({
  client: ClientRef,
  /** "Individual", "Small Business", "Corporate"...: the client's entity type as the screen shows it. */
  entityLabel: z.string().nullable(),
  planId: z.uuid().nullable(),
  planName: z.string().nullable(),
  planYear: z.number().int().nullable(),
  status: TaxPlanStatus.nullable(),
  nextAppointmentAt: DateTime.nullable(),
  /** Labelled "estimated" in the screen. */
  potentialSavingsCents: z.number().int().nullable(),
  assignedTo: MemberRef.nullable(),
  openOpportunities: z.number().int(),
});
export type PlanningClientRow = z.infer<typeof PlanningClientRow>;

/** The Top Planning Opportunities rows: one per library strategy, over the caller's clients. */
export const TopOpportunityRow = z.object({
  strategyId: PlanningStrategyId.nullable(),
  name: z.string(),
  category: StrategyCategory,
  clientCount: z.number().int(),
  estimatedSavingsCents: z.number().int().nullable(),
  /** The id of the first opportunity in the queue for this strategy ("Review"). */
  firstOpportunityId: TaxOpportunityId,
});
export type TopOpportunityRow = z.infer<typeof TopOpportunityRow>;

export const PlanningDeadline = z.object({
  /** Opens the deadline's detail (a compliance deadline or a planning milestone). */
  id: z.string(),
  date: CalendarDate,
  title: z.string(),
  description: z.string().nullable(),
  /** The clients it affects, for the scope line ("Individual & Business Clients"). */
  scope: z.string().nullable(),
  kind: z.enum(['TAX_DEADLINE', 'PLANNING_MILESTONE']),
});
export type PlanningDeadline = z.infer<typeof PlanningDeadline>;

export const PlanningResource = z.object({
  key: PlanningResourceKey,
  title: z.string(),
  category: z.string(),
  kind: z.enum(['PDF', 'CHECKLIST', 'GUIDE', 'VIDEO', 'ARTICLE']),
  /** Safe to send to a client. */
  clientFacing: z.boolean(),
  /** Where it opens (a file, a page or a video); null when it only sends. */
  url: z.string().nullable(),
});
export type PlanningResource = z.infer<typeof PlanningResource>;

/** GET /business/tax-planning/overview: Frame 1. Counts open the matching filtered lists. */
export const TaxPlanningOverview = z.object({
  activePlanningClients: PlanningKpi,
  upcomingAppointments: PlanningKpi,
  strategiesInProgress: PlanningKpi,
  /** Aggregate of documented estimates (cents); open the savings report with the disclaimer. */
  projectedSavings: PlanningKpi,
  recentClients: z.array(PlanningClientRow).max(5),
  topOpportunities: z.array(TopOpportunityRow).max(5),
  deadlines: z.array(PlanningDeadline).max(5),
  resources: z.array(PlanningResource).max(5),
  disclaimer: z.string(),
  canCreatePlan: z.boolean(),
  canSend: z.boolean(),
});
export type TaxPlanningOverview = z.infer<typeof TaxPlanningOverview>;

/** GET .../clients (the Clients tab). `status` is the plan's; `hasPlan` false lists clients with none. */
export const PlanningClientsQuery = z.strictObject({
  search: SearchText.optional(),
  status: TaxPlanStatus.optional(),
  planYear: QueryYear.optional(),
  assignedUserId: z.uuid().optional(),
  entityType: z.string().max(60).optional(),
  hasPlan: z.union([z.boolean(), z.stringbool()]).optional(),
  sort: z.enum(['name', 'status', 'nextAppointment', 'savings']).optional().default('name'),
  direction: z.enum(['asc', 'desc']).optional().default('asc'),
  page: z.coerce.number().int().min(1).optional().default(1),
  pageSize: z.coerce.number().int().min(1).max(100).optional().default(25),
});
export type PlanningClientsQuery = z.input<typeof PlanningClientsQuery>;
export const PlanningClientPage = z.object({ items: z.array(PlanningClientRow).max(100), ...Page });
export type PlanningClientPage = z.infer<typeof PlanningClientPage>;

// ---------- Plans ----------

export const PlanInput = z.object({
  key: z.string(),
  label: z.string(),
  kind: PlanInputKind,
  taxYear: z.number().int(),
  amountCents: z.number().int().nullable(),
  textValue: z.string().nullable(),
  /** "Tax return 2025", "Client estimate", "Manual entry". */
  source: z.string(),
  asOf: DateTime.nullable(),
  note: z.string().nullable(),
});
export type PlanInput = z.infer<typeof PlanInput>;

export const PlanStrategy = z.object({
  id: PlanStrategyId,
  /** The library strategy, or null for a custom one for this client. */
  strategyId: PlanningStrategyId.nullable(),
  name: z.string(),
  category: StrategyCategory,
  custom: z.boolean(),
  selected: z.boolean(),
  priority: TaskPriority,
  status: PlanStrategyStatus,
  estimate: SavingsEstimate,
  /** The reason a person gave when they overrode the estimate. */
  overrideReason: z.string().nullable(),
  overriddenBy: MemberRef.nullable(),
  assumptions: z.string().nullable(),
  implementedOn: CalendarDate.nullable(),
  position: z.number().int(),
});
export type PlanStrategy = z.infer<typeof PlanStrategy>;

export const PlanDocument = z.object({
  /** The documents module's id (open and download there). */
  documentId: z.uuid(),
  fileName: z.string(),
  category: z.string().nullable(),
  planStrategyId: PlanStrategyId.nullable(),
  addedBy: MemberRef.nullable(),
  addedAt: DateTime,
});
export type PlanDocument = z.infer<typeof PlanDocument>;

/** A row of the plan list and the "Select an existing plan" picker. */
export const TaxPlanRow = z.object({
  id: TaxPlanId,
  client: ClientRef,
  name: z.string(),
  planYear: z.number().int(),
  planType: TaxPlanType,
  status: TaxPlanStatus,
  entityLabel: z.string().nullable(),
  assignedTo: MemberRef.nullable(),
  targetCompletionOn: CalendarDate.nullable(),
  nextDiscussionOn: CalendarDate.nullable(),
  /** Sum of the selected strategies' estimates (cents); never counts overlapping savings twice. */
  projectedSavingsCents: z.number().int().nullable(),
  strategyCount: z.number().int(),
  version: z.number().int(),
  archived: z.boolean(),
  updatedAt: DateTime,
});
export type TaxPlanRow = z.infer<typeof TaxPlanRow>;

export const TaxPlanDetail = TaxPlanRow.extend({
  filingStatus: TaxFilingStatus.nullable(),
  entityType: z.string().nullable(),
  goals: z.array(PlanningGoal),
  otherGoal: z.string().nullable(),
  /** Internal notes: staff only. */
  notes: z.string().nullable(),
  /** Shown to the client only when set. */
  clientNotes: z.string().nullable(),
  /** The financial overview: each figure with its year, kind and source. Null without the permission. */
  inputs: z.array(PlanInput).nullable(),
  strategies: z.array(PlanStrategy),
  documents: z.array(PlanDocument),
  /** Notes the overlap rules applied so savings are not double-counted. */
  overlapNotes: z.array(z.string()),
  /** The client's data is older than a period the firm sets: prompt to review. */
  staleData: z.boolean(),
  disclaimer: z.string(),
  canEdit: z.boolean(),
  canOverride: z.boolean(),
  canSend: z.boolean(),
  createdAt: DateTime,
  /** Send it back on a change: 409 SAVE_CONFLICT when someone saved after it was loaded. */
  etag: z.string(),
});
export type TaxPlanDetail = z.infer<typeof TaxPlanDetail>;

export const TaxPlansQuery = z.strictObject({
  clientId: z.uuid().optional(),
  status: TaxPlanStatus.optional(),
  planYear: QueryYear.optional(),
  assignedUserId: z.uuid().optional(),
  search: SearchText.optional(),
  includeArchived: z.union([z.boolean(), z.stringbool()]).optional(),
  page: z.coerce.number().int().min(1).optional().default(1),
  pageSize: z.coerce.number().int().min(1).max(100).optional().default(25),
});
export type TaxPlansQuery = z.input<typeof TaxPlansQuery>;
export const TaxPlanPage = z.object({ items: z.array(TaxPlanRow).max(100), ...Page });
export type TaxPlanPage = z.infer<typeof TaxPlanPage>;

/**
 * POST /business/tax-planning/plans: stage 1 (Client & Plan Details) saves a DRAFT; nothing is
 * sent. One live plan per client, year and name: another is 409 DUPLICATE_PLAN unless
 * `allowDuplicate` (Owner, Admin or Planning Admin). The client must be one the caller reaches.
 */
export const CreateTaxPlanRequest = z.strictObject({
  clientId: z.uuid(),
  planYear: PlanYear,
  name: text(200),
  planType: TaxPlanType.optional().default('COMPREHENSIVE'),
  /** Null for a business-only plan. */
  filingStatus: TaxFilingStatus.nullable().optional(),
  entityType: clearable(text(60)),
  goals: z.array(PlanningGoal).max(10).optional().default([]),
  otherGoal: clearable(text(300)),
  assignedUserId: z.uuid().nullable().optional(),
  targetCompletionOn: CalendarDate.nullable().optional(),
  nextDiscussionOn: CalendarDate.nullable().optional(),
  allowDuplicate: z.boolean().optional().default(false),
});
export type CreateTaxPlanRequest = z.input<typeof CreateTaxPlanRequest>;

/**
 * PATCH .../plans/{id}: the sections of the plan (every stage's own fields); only the fields sent
 * change. `etag` guards a concurrent save. The client never changes. A change of status follows
 * the rules of POST .../status.
 */
export const UpdateTaxPlanRequest = z
  .strictObject({
    name: text(200).optional(),
    planYear: PlanYear.optional(),
    planType: TaxPlanType.optional(),
    filingStatus: TaxFilingStatus.nullable().optional(),
    entityType: clearable(text(60)),
    goals: z.array(PlanningGoal).max(10).optional(),
    otherGoal: clearable(text(300)),
    notes: clearable(text(5_000, 'many')),
    clientNotes: clearable(text(5_000, 'many')),
    assignedUserId: z.uuid().nullable().optional(),
    targetCompletionOn: CalendarDate.nullable().optional(),
    nextDiscussionOn: CalendarDate.nullable().optional(),
    etag: z.string().min(1).max(100),
  })
  .refine(
    (o) => Object.keys(o).filter((k) => k !== 'etag').length > 0,
    'Change at least one field',
  );
export type UpdateTaxPlanRequest = z.input<typeof UpdateTaxPlanRequest>;

/**
 * PUT .../plans/{id}/inputs (stage 2, Financial Overview): the figures of the plan, replacing the
 * rows of the keys sent. A historical figure is a prior year's, a projected one is for the plan
 * year, and an adjustment needs a note and the permission to enter one. A missing figure has no
 * row: nothing is invented. Needs "View Financial Inputs" and Edit.
 */
export const SavePlanInputsRequest = z.strictObject({
  inputs: z
    .array(
      z
        .strictObject({
          key: z.string().regex(/^[a-z][a-z0-9_]{1,59}$/),
          kind: PlanInputKind,
          taxYear: PlanYear,
          amountCents: z
            .number()
            .int()
            .min(-100_000_000_000)
            .max(100_000_000_000)
            .nullable()
            .optional(),
          textValue: clearable(text(200)),
          source: text(100),
          asOf: DateTime.nullable().optional(),
          note: clearable(text(500, 'many')),
        })
        .refine((i) => i.amountCents != null || i.textValue != null, 'Enter an amount or a value')
        .refine((i) => i.kind !== 'ADJUSTMENT' || !!i.note, 'A manual adjustment needs a note'),
    )
    .min(1)
    .max(100),
  etag: z.string().min(1).max(100),
});
export type SavePlanInputsRequest = z.input<typeof SavePlanInputsRequest>;

/** The inputs the model reads, for the screen's labels (GET .../input-catalog). */
export const PlanInputCatalog = z.object({
  items: z.array(
    z.object({
      key: z.string(),
      label: z.string(),
      type: z.enum(['MONEY', 'TEXT']),
      group: z.string(),
    }),
  ),
});
export type PlanInputCatalog = z.infer<typeof PlanInputCatalog>;

/**
 * POST .../plans/{id}/strategies (stage 3): adds a library strategy (`strategyId`) or a custom
 * one for this client (a name, category and assumptions). A strategy once in the plan is 409
 * DUPLICATE_STRATEGY. The estimate comes from the model; a custom one may be given an estimate
 * with its basis by someone who can override.
 */
export const AddPlanStrategyRequest = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('LIBRARY'),
    strategyId: PlanningStrategyId,
    priority: TaskPriority.optional(),
  }),
  z.strictObject({
    kind: z.literal('CUSTOM'),
    name: text(200),
    category: StrategyCategory,
    priority: TaskPriority.optional().default('MEDIUM'),
    assumptions: clearable(text(2_000, 'many')),
    estimatedSavingsCents: Cents.nullable().optional(),
  }),
]);
export type AddPlanStrategyRequest = z.input<typeof AddPlanStrategyRequest>;

/**
 * PATCH .../plans/{id}/strategies/{strategyId}: include or drop it, priority, status, assumptions,
 * the day it was implemented, or an override of the estimate (`overrideSavingsCents` with
 * `overrideReason`, both required together; 403 OVERRIDE_NOT_ALLOWED without the permission;
 * `null` clears an override back to the model's figure).
 */
export const UpdatePlanStrategyRequest = z
  .strictObject({
    selected: z.boolean().optional(),
    priority: TaskPriority.optional(),
    status: PlanStrategyStatus.optional(),
    assumptions: clearable(text(2_000, 'many')),
    implementedOn: CalendarDate.nullable().optional(),
    overrideSavingsCents: Cents.nullable().optional(),
    overrideReason: clearable(text(500, 'many')),
    etag: z.string().min(1).max(100),
  })
  .refine((o) => Object.keys(o).filter((k) => k !== 'etag').length > 0, 'Change at least one field')
  .refine(
    (o) => typeof o.overrideSavingsCents !== 'number' || !!o.overrideReason,
    'An override needs a reason',
  );
export type UpdatePlanStrategyRequest = z.input<typeof UpdatePlanStrategyRequest>;

/** PUT .../plans/{id}/strategies/order: the plan strategies in their new order. */
export const ReorderPlanStrategiesRequest = z.strictObject({
  ids: z.array(PlanStrategyId).min(1).max(100),
  etag: z.string().min(1).max(100),
});
export type ReorderPlanStrategiesRequest = z.input<typeof ReorderPlanStrategiesRequest>;

/** POST .../plans/{id}/documents (stage 4): links a document of the plan's client (uploaded in Documents). */
export const AttachPlanDocumentRequest = z.strictObject({
  documentId: z.uuid(),
  category: clearable(text(60)),
  planStrategyId: PlanStrategyId.nullable().optional(),
});
export type AttachPlanDocumentRequest = z.input<typeof AttachPlanDocumentRequest>;

/**
 * POST .../plans/{id}/status: moves the plan along. IMPLEMENTED needs a strategy in progress or
 * done, CLOSED stops further work; going back to DRAFT is for a plan never finalized. 409
 * INVALID_STATUS otherwise.
 */
export const SetPlanStatusRequest = z.strictObject({
  status: TaxPlanStatus,
  etag: z.string().min(1).max(100),
});
export type SetPlanStatusRequest = z.input<typeof SetPlanStatusRequest>;

/**
 * POST .../plans/{id}/finalize (stage 5) and POST .../plans/{id}/send: each keeps a version
 * snapshot (the strategies with names, priorities, estimates, overrides and assumptions, the
 * inputs, and when the data came from). Send also delivers the client-facing plan by the channel
 * (needs "Send Plans"); the plan must have been finalized and the client's notes are the only
 * notes sent. 409 PLAN_NOT_READY with the missing pieces (no strategy selected, an unavailable
 * estimate shown as such, a stale input).
 */
export const FinalizePlanRequest = z.strictObject({ etag: z.string().min(1).max(100) });
export type FinalizePlanRequest = z.input<typeof FinalizePlanRequest>;
export const SendPlanRequest = z.strictObject({
  channel: z.enum(['PORTAL_MESSAGE', 'EMAIL']),
  message: clearable(text(2_000, 'many')),
});
export type SendPlanRequest = z.input<typeof SendPlanRequest>;

export const PlanVersionRow = z.object({
  version: z.number().int(),
  event: PlanVersionEvent,
  taxYear: z.number().int(),
  sourceDataAsOf: DateTime.nullable(),
  createdBy: MemberRef.nullable(),
  createdAt: DateTime,
});
export type PlanVersionRow = z.infer<typeof PlanVersionRow>;
export const PlanVersionList = z.object({ items: z.array(PlanVersionRow) });
export type PlanVersionList = z.infer<typeof PlanVersionList>;

/** One snapshot, exactly as it was kept: later edits never change it. */
export const PlanVersionDetail = PlanVersionRow.extend({
  planName: z.string(),
  strategies: z.array(
    z.object({
      name: z.string(),
      category: StrategyCategory,
      priority: TaskPriority,
      estimate: SavingsEstimate,
      assumptions: z.string().nullable(),
    }),
  ),
  inputs: z.array(PlanInput).nullable(),
  projectedSavingsCents: z.number().int().nullable(),
  disclaimer: z.string(),
});
export type PlanVersionDetail = z.infer<typeof PlanVersionDetail>;

// ---------- Strategy library ----------

export const PlanningStrategy = z.object({
  id: PlanningStrategyId,
  name: z.string(),
  category: StrategyCategory,
  description: z.string().nullable(),
  defaultPriority: TaskPriority,
  /** The criteria the screening reads, in plain sentences. */
  eligibility: z.array(z.string()),
  requiredInputs: z.array(z.string()),
  requiredDocuments: z.array(z.string()),
  implementationChecklist: z.array(z.string()),
  active: z.boolean(),
  archived: z.boolean(),
  /** Plans and open opportunities that use it. */
  planCount: z.number().int(),
  openOpportunityCount: z.number().int(),
  updatedAt: DateTime,
});
export type PlanningStrategy = z.infer<typeof PlanningStrategy>;

export const PlanningStrategiesQuery = z.strictObject({
  category: StrategyCategory.optional(),
  active: z.union([z.boolean(), z.stringbool()]).optional(),
  includeArchived: z.union([z.boolean(), z.stringbool()]).optional(),
  search: SearchText.optional(),
  page: z.coerce.number().int().min(1).optional().default(1),
  pageSize: z.coerce.number().int().min(1).max(100).optional().default(25),
});
export type PlanningStrategiesQuery = z.input<typeof PlanningStrategiesQuery>;
export const PlanningStrategyPage = z.object({
  items: z.array(PlanningStrategy).max(100),
  ...Page,
});
export type PlanningStrategyPage = z.infer<typeof PlanningStrategyPage>;

const Lines = (max: number) => z.array(text(300)).max(max);

/** Needs "Manage Strategies". Names are unique in the firm ignoring case (409 DUPLICATE_NAME). */
export const CreatePlanningStrategyRequest = z.strictObject({
  name: text(200),
  category: StrategyCategory,
  description: clearable(text(2_000, 'many')),
  defaultPriority: TaskPriority.optional().default('MEDIUM'),
  eligibility: Lines(30).optional().default([]),
  requiredInputs: z
    .array(z.string().regex(/^[a-z][a-z0-9_]{1,59}$/))
    .max(30)
    .optional()
    .default([]),
  requiredDocuments: Lines(30).optional().default([]),
  implementationChecklist: Lines(50).optional().default([]),
});
export type CreatePlanningStrategyRequest = z.input<typeof CreatePlanningStrategyRequest>;
export const UpdatePlanningStrategyRequest = z
  .strictObject({
    name: text(200).optional(),
    category: StrategyCategory.optional(),
    description: clearable(text(2_000, 'many')),
    defaultPriority: TaskPriority.optional(),
    eligibility: Lines(30).optional(),
    requiredInputs: z
      .array(z.string().regex(/^[a-z][a-z0-9_]{1,59}$/))
      .max(30)
      .optional(),
    requiredDocuments: Lines(30).optional(),
    implementationChecklist: Lines(50).optional(),
    active: z.boolean().optional(),
  })
  .refine((o) => Object.keys(o).length > 0, 'Change at least one field');
export type UpdatePlanningStrategyRequest = z.input<typeof UpdatePlanningStrategyRequest>;

// ---------- Opportunities ----------

export const OpportunityDataPoint = z.object({
  label: z.string(),
  amountCents: z.number().int().nullable(),
  text: z.string().nullable(),
});
export type OpportunityDataPoint = z.infer<typeof OpportunityDataPoint>;

/** A row of the opportunity queue. */
export const TaxOpportunityRow = z.object({
  id: TaxOpportunityId,
  client: ClientRef,
  strategyId: PlanningStrategyId.nullable(),
  name: z.string(),
  category: StrategyCategory,
  priority: TaskPriority,
  status: OpportunityStatus,
  source: OpportunitySource,
  taxYear: z.number().int(),
  estimatedSavingsCents: z.number().int().nullable(),
  assignedTo: MemberRef.nullable(),
  /** The data was too thin to be sure. */
  dataComplete: z.boolean(),
  planId: TaxPlanId.nullable(),
  lastEvaluatedAt: DateTime.nullable(),
  updatedAt: DateTime,
});
export type TaxOpportunityRow = z.infer<typeof TaxOpportunityRow>;

/** Frame 3. Reading an opportunity never changes it. */
export const TaxOpportunityDetail = TaxOpportunityRow.extend({
  description: z.string().nullable(),
  /** The screening rule's id and its plain-language explanation ("Why this opportunity?"). */
  ruleId: z.string().nullable(),
  whyExplanation: z.string().nullable(),
  missingData: z.array(z.string()),
  /** The client's data the screening used, with the tax year in `taxYear`. Null without "View Financial Inputs". */
  clientDataUsed: z.array(OpportunityDataPoint).nullable(),
  estimate: SavingsEstimate,
  /** Estimated Impact: the suggested action amount and the modeled result. */
  impact: z.object({
    suggestedActionCents: z.number().int().nullable(),
    newTaxableIncomeCents: z.number().int().nullable(),
    effectiveRateBeforeBp: z.number().int().nullable(),
    effectiveRateAfterBp: z.number().int().nullable(),
  }),
  recommendedActions: z.array(z.string()),
  eligibility: z.array(z.object({ text: z.string(), met: z.boolean() })),
  documentsNeeded: z.array(
    z.object({ index: z.number().int(), label: z.string(), received: z.boolean() }),
  ),
  plan: z.object({ id: TaxPlanId, name: z.string() }).nullable(),
  discussionOn: CalendarDate.nullable(),
  reviewed: z.boolean(),
  reviewedBy: MemberRef.nullable(),
  dispositionReason: z.string().nullable(),
  suppressedUntil: CalendarDate.nullable(),
  implementedOn: CalendarDate.nullable(),
  /** The neighbours in the queue the caller came from, for Previous and Next. */
  previousId: TaxOpportunityId.nullable(),
  nextId: TaxOpportunityId.nullable(),
  /** Plans of this client that this can be added to (the picker). */
  candidatePlans: z.array(
    z.object({ id: TaxPlanId, name: z.string(), planYear: z.number().int() }),
  ),
  disclaimer: z.string(),
  canReview: z.boolean(),
  createdAt: DateTime,
  /** Send it back on an action: 409 SAVE_CONFLICT when someone acted after it was loaded. */
  etag: z.string(),
});
export type TaxOpportunityDetail = z.infer<typeof TaxOpportunityDetail>;

export const TaxOpportunitiesQuery = z.strictObject({
  status: OpportunityStatus.optional(),
  /** `open`: NEW, UNDER_REVIEW, ASSIGNED, DISCUSSION_SCHEDULED, NEEDS_DOCUMENTS and ADDED_TO_PLAN. */
  group: z.enum(['open', 'closed']).optional(),
  category: StrategyCategory.optional(),
  priority: TaskPriority.optional(),
  source: OpportunitySource.optional(),
  clientId: z.uuid().optional(),
  strategyId: PlanningStrategyId.optional(),
  taxYear: QueryYear.optional(),
  assignedUserId: z.uuid().optional(),
  search: SearchText.optional(),
  sort: z.enum(['savings', 'priority', 'client', 'updated']).optional().default('savings'),
  direction: z.enum(['asc', 'desc']).optional().default('desc'),
  page: z.coerce.number().int().min(1).optional().default(1),
  pageSize: z.coerce.number().int().min(1).max(100).optional().default(25),
});
export type TaxOpportunitiesQuery = z.input<typeof TaxOpportunitiesQuery>;
export const TaxOpportunityPage = z.object({ items: z.array(TaxOpportunityRow).max(100), ...Page });
export type TaxOpportunityPage = z.infer<typeof TaxOpportunityPage>;

/**
 * POST .../opportunities (a custom opportunity by authorized staff, source STAFF or MANUAL). A
 * client has one open opportunity per library strategy and year: another is 409
 * DUPLICATE_OPPORTUNITY with the existing id.
 */
export const CreateTaxOpportunityRequest = z.strictObject({
  clientId: z.uuid(),
  strategyId: PlanningStrategyId.nullable().optional(),
  name: text(200),
  category: StrategyCategory,
  priority: TaskPriority.optional().default('MEDIUM'),
  description: clearable(text(2_000, 'many')),
  taxYear: PlanYear,
  estimatedSavingsCents: Cents.nullable().optional(),
  estimateBasis: clearable(text(500, 'many')),
  recommendedActions: z.array(text(500, 'many')).max(20).optional().default([]),
  documentsNeeded: z.array(text(200)).max(20).optional().default([]),
});
export type CreateTaxOpportunityRequest = z.input<typeof CreateTaxOpportunityRequest>;

/**
 * POST .../opportunities/{id}/actions (Frame 3 and the row menu). Each action is audited and is
 * a review, not an implementation: nothing changes a tax return. NOT_APPLICABLE and DISMISS need a
 * reason (and may suppress screening until a date); REOPEN needs the Review permission.
 * ADD_TO_PLAN links to the plan (or makes a new draft plan for the client) without a duplicate.
 * 409 INVALID_STATUS when the action does not fit the status.
 */
export const OpportunityActionRequest = z.discriminatedUnion('action', [
  z.strictObject({ action: z.literal('START_REVIEW'), etag: z.string().max(100).optional() }),
  z.strictObject({
    action: z.literal('ADD_TO_PLAN'),
    /** An existing plan of this client, or omit it to start a draft plan. */
    planId: TaxPlanId.optional(),
    etag: z.string().max(100).optional(),
  }),
  z.strictObject({
    action: z.literal('ASSIGN'),
    userId: z.uuid().nullable(),
    etag: z.string().max(100).optional(),
  }),
  z.strictObject({
    action: z.literal('SCHEDULE_DISCUSSION'),
    on: CalendarDate,
    /** An appointment made in Appointments (tagged Tax Planning). */
    appointmentId: z.uuid().optional(),
    etag: z.string().max(100).optional(),
  }),
  z.strictObject({
    action: z.literal('SET_DOCUMENT'),
    index: z.number().int().min(0).max(19),
    received: z.boolean(),
    etag: z.string().max(100).optional(),
  }),
  z.strictObject({
    action: z.enum(['MARK_NOT_APPLICABLE', 'DISMISS']),
    reason: text(500, 'many'),
    suppressedUntil: CalendarDate.nullable().optional(),
    etag: z.string().max(100).optional(),
  }),
  z.strictObject({
    action: z.literal('MARK_IMPLEMENTED'),
    on: CalendarDate,
    note: clearable(text(500, 'many')),
    etag: z.string().max(100).optional(),
  }),
  z.strictObject({
    action: z.enum(['CLOSE', 'REOPEN']),
    note: clearable(text(500, 'many')),
    etag: z.string().max(100).optional(),
  }),
  z.strictObject({
    action: z.literal('ADD_NOTE'),
    note: text(1_000, 'many'),
    etag: z.string().max(100).optional(),
  }),
]);
export type OpportunityActionRequest = z.input<typeof OpportunityActionRequest>;

export const TaxOpportunityEvent = z.object({
  id: z.uuid(),
  kind: OpportunityEventKind,
  fromStatus: OpportunityStatus.nullable(),
  toStatus: OpportunityStatus.nullable(),
  reason: z.string().nullable(),
  actor: MemberRef.nullable(),
  createdAt: DateTime,
});
export type TaxOpportunityEvent = z.infer<typeof TaxOpportunityEvent>;
export const TaxOpportunityEventList = z.object({ items: z.array(TaxOpportunityEvent) });
export type TaxOpportunityEventList = z.infer<typeof TaxOpportunityEventList>;

/**
 * POST .../screening/run (Owner, Admin or Planning Admin): re-screens one client or all the firm's
 * clients for a tax year under the documented rules. It never overrides a Not Applicable or
 * Dismissed opportunity before its suppression date or without a material change, and leaves an
 * opportunity a person reviewed as it is. Runs in the background for many clients: the answer
 * says how many were found and updated so far.
 */
export const RunScreeningRequest = z.strictObject({
  clientId: z.uuid().optional(),
  taxYear: PlanYear.optional(),
});
export type RunScreeningRequest = z.input<typeof RunScreeningRequest>;
export const RunScreeningResult = z.object({
  clientsScreened: z.number().int(),
  created: z.number().int(),
  updated: z.number().int(),
  skippedSuppressed: z.number().int(),
  /** More clients remain: the run continues in the background. */
  queued: z.boolean(),
});
export type RunScreeningResult = z.infer<typeof RunScreeningResult>;

// ---------- Tax Savings Calculator ----------

/**
 * The baseline a scenario starts from (cents, the plan or scenario year). Only fields sent are
 * used; a figure the model needs and lacks makes the result unavailable (with the reason), never
 * a guess.
 */
export const CalculatorBaseline = z.strictObject({
  wagesCents: Cents.optional(),
  selfEmploymentIncomeCents: Cents.optional(),
  businessIncomeCents: Cents.optional(),
  interestDividendsCents: Cents.optional(),
  capitalGainsCents: Cents.optional(),
  otherIncomeCents: Cents.optional(),
  adjustmentsCents: Cents.optional(),
  itemizedDeductionsCents: Cents.optional(),
  creditsCents: Cents.optional(),
  age: z.number().int().min(0).max(120).optional(),
  dependents: z.number().int().min(0).max(30).optional(),
  /** A US state code; only supported states are modelled (the result says when not). */
  state: z
    .string()
    .regex(/^[A-Z]{2}$/)
    .optional(),
});
export type CalculatorBaseline = z.input<typeof CalculatorBaseline>;

/** What the scenario adds. */
export const CalculatorStrategy = z.strictObject({
  retirementContributionCents: Cents.optional(),
  hsaContributionCents: Cents.optional(),
  section179Cents: Cents.optional(),
  homeOfficeCents: Cents.optional(),
  otherDeductionCents: Cents.optional(),
  additionalCreditCents: Cents.optional(),
});
export type CalculatorStrategy = z.input<typeof CalculatorStrategy>;

/** POST .../calculator/calculate: nothing is saved. `clientId` links a client (a reachable one). */
export const CalculateSavingsRequest = z.strictObject({
  clientId: z.uuid().optional(),
  taxYear: PlanYear,
  filingStatus: TaxFilingStatus.optional(),
  baseline: CalculatorBaseline,
  strategy: CalculatorStrategy,
});
export type CalculateSavingsRequest = z.input<typeof CalculateSavingsRequest>;

export const CalculatorResult = z.object({
  baselineTaxCents: z.number().int().nullable(),
  modeledTaxCents: z.number().int().nullable(),
  /** Baseline minus modeled: the projected saving. Null when unavailable. */
  differenceCents: z.number().int().nullable(),
  /** Why the result is unavailable, or what it could not include. */
  unavailableReason: z.string().nullable(),
  /** The limitations and assumptions the result rests on, always shown. */
  assumptions: z.array(z.string()),
  disclaimer: z.string(),
});
export type CalculatorResult = z.infer<typeof CalculatorResult>;

/**
 * POST .../calculator/scenarios (Save): keeps the inputs and the result as calculated now. With
 * `planId` (needs Edit on plans) it is saved to that plan as a snapshot that never changes.
 */
export const SaveScenarioRequest = z.strictObject({
  name: clearable(text(200)),
  planId: TaxPlanId.optional(),
  calculation: CalculateSavingsRequest,
});
export type SaveScenarioRequest = z.input<typeof SaveScenarioRequest>;

export const TaxScenario = z.object({
  id: TaxScenarioId,
  name: z.string().nullable(),
  client: ClientRef.nullable(),
  plan: z.object({ id: TaxPlanId, name: z.string() }).nullable(),
  taxYear: z.number().int(),
  filingStatus: TaxFilingStatus.nullable(),
  baseline: CalculatorBaseline,
  strategy: CalculatorStrategy,
  result: CalculatorResult,
  savedToPlanAt: DateTime.nullable(),
  createdBy: MemberRef.nullable(),
  createdAt: DateTime,
});
export type TaxScenario = z.infer<typeof TaxScenario>;

export const TaxScenariosQuery = z.strictObject({
  clientId: z.uuid().optional(),
  planId: TaxPlanId.optional(),
  page: z.coerce.number().int().min(1).optional().default(1),
  pageSize: z.coerce.number().int().min(1).max(100).optional().default(25),
});
export type TaxScenariosQuery = z.input<typeof TaxScenariosQuery>;
export const TaxScenarioPage = z.object({ items: z.array(TaxScenario).max(100), ...Page });
export type TaxScenarioPage = z.infer<typeof TaxScenarioPage>;

// ---------- Tax Calendar and Resources ----------

/** GET .../calendar: tax deadlines (from Compliance & Deadlines) and planning milestones in a range. */
export const PlanningCalendarQuery = z
  .strictObject({
    from: CalendarDate,
    to: CalendarDate,
    clientId: z.uuid().optional(),
  })
  .refine((q) => q.from <= q.to, 'The start date must be on or before the end date')
  .refine(
    (q) => (Date.parse(q.to) - Date.parse(q.from)) / 86_400_000 <= 400,
    'Ask for at most 400 days',
  );
export type PlanningCalendarQuery = z.input<typeof PlanningCalendarQuery>;
export const PlanningCalendar = z.object({ items: z.array(PlanningDeadline) });
export type PlanningCalendar = z.infer<typeof PlanningCalendar>;

export const PlanningResourcesQuery = z.strictObject({
  search: SearchText.optional(),
  category: z.string().max(60).optional(),
  kind: PlanningResource.shape.kind.optional(),
});
export type PlanningResourcesQuery = z.input<typeof PlanningResourcesQuery>;
export const PlanningResourceList = z.object({ items: z.array(PlanningResource) });
export type PlanningResourceList = z.infer<typeof PlanningResourceList>;

/** POST .../resources/{key}/send (Send Client Resource): to a client the caller reaches. Needs "Send Plans/Resources". */
export const SendPlanningResourceRequest = z.strictObject({
  clientId: z.uuid(),
  channel: z.enum(['PORTAL_MESSAGE', 'EMAIL']),
  message: clearable(text(2_000, 'many')),
});
export type SendPlanningResourceRequest = z.input<typeof SendPlanningResourceRequest>;

// ---------- Errors ----------

export const TaxPlanningErrorCode = z.enum([
  /** 409: a live plan of this client, year and name exists (Owner or Admin may allow a duplicate). */
  'DUPLICATE_PLAN',
  /** 409: the strategy is in the plan already. */
  'DUPLICATE_STRATEGY',
  /** 409: the client already has an open opportunity for this strategy and year. */
  'DUPLICATE_OPPORTUNITY',
  /** 409: a library strategy has this name. */
  'DUPLICATE_NAME',
  /** 409: someone saved after it was loaded. */
  'SAVE_CONFLICT',
  /** 403: overriding an estimate needs the permission. */
  'OVERRIDE_NOT_ALLOWED',
  /** 403: the figures are restricted (View Financial Inputs). */
  'FINANCIAL_INPUTS_RESTRICTED',
  /** 409: the status change or opportunity action does not fit the current status. */
  'INVALID_STATUS',
  /** 409: the plan cannot be finalized or sent yet; the details name what is missing. */
  'PLAN_NOT_READY',
  /** 409: the person is not an active member of the firm. */
  'NOT_A_MEMBER',
  /** 409: the plan is archived. */
  'PLAN_ARCHIVED',
  /** 409: the document is not one of the plan client's. */
  'DOCUMENT_NOT_ALLOWED',
  /** 503: the estimate could not be calculated now; the plan is saved without one. */
  'CALCULATION_UNAVAILABLE',
]);
export type TaxPlanningErrorCode = z.infer<typeof TaxPlanningErrorCode>;
