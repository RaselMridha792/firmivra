import { z } from 'zod';
import { CalendarDate, MemberRef } from '../clients/schemas.js';
import { clearable, SearchText, text } from '../clients/text.js';
import { DownloadLink } from '../documents/schemas.js';
import {
  ActionExecutionStatus,
  AutomationModule,
  AutomationRunStatus,
  AutomationStatus,
  AutomationTiming,
  MatchMode,
  OffsetUnit,
  TaskPriority,
} from '../db-enums.js';

// Automations (R55 contract, for the Automation screens): the overview (KPIs, recent activity,
// quick actions), Manage Rules, the five-step rule builder (trigger, conditions, actions,
// settings, review and activate), rule templates, the logs and rule activity, log details with
// retry, and the Automation settings. Designs: docs/mockups/firm-workspace/automations/source/
// and its developer guide.
//
// An automation reuses the other modules' own APIs: it never creates a second task, message,
// appointment, document, deadline or client system, and it never bypasses a module's permissions.
// What a rule can start from and do is DATA the API serves (`GET .../catalog`): modules, events
// with their timing and condition fields, and action types with their settings, so a new event or
// action is not a new screen. A saved rule is a switch (name, category, priority, owner, status)
// plus IMMUTABLE VERSIONS (trigger, conditions, ordered actions, settings): saving a definition
// makes a new version, and a run records the version it used, so editing a rule never rewrites
// history. Every run has a stable id and every action an idempotency key, so a retry or a
// duplicate event never repeats an action that succeeded. Test / Preview is a dry run with no side
// effects. Loops (a rule that triggers itself, A and B in a cycle) are blocked before activation
// and cut at runtime by a depth limit. Logs hold ids and safe codes, never tokens or client data.
// Firm routes under /api/v1/business (`@Access('AUTOMATIONS')`): everyone with the grid's view
// reads; creating, editing, activating, testing, retrying, exporting and settings need Create,
// Edit or Manage (403 FORBIDDEN); Owner and Admin may always. Responses are plain objects;
// requests are strict. Audited with ids, versions, statuses and field names only.

const DateTime = z.iso.datetime({ offset: true });
const Page = { total: z.number().int(), page: z.number().int(), pageSize: z.number().int() };
const Etag = z.string().min(1).max(100);

export const AutomationRuleId = z.uuid();
export const AutomationRuleVersionNumber = z.number().int().min(1);
export const AutomationTemplateId = z.uuid();
export const AutomationRunId = z.uuid();
/** An event code of a module's catalog: `deadline.approaching`, `invoice.overdue`. */
export const AutomationEventCode = z
  .string()
  .regex(/^[a-z][a-z_]*(\.[a-z][a-z_]*)+$/, 'Use an event code like invoice.overdue')
  .max(80);
/** An action type code of the catalog. */
export const AutomationActionType = z
  .string()
  .regex(/^[A-Z][A-Z0-9_]{1,39}$/, 'Use an action type code');

// ---------- The catalog (data, from the API) ----------

export const AutomationFieldType = z.enum([
  'TEXT',
  'NUMBER',
  'MONEY',
  'DATE',
  'STATUS',
  'BOOLEAN',
  'LIST',
]);
export type AutomationFieldType = z.infer<typeof AutomationFieldType>;

/** The operators a condition can use (the API offers the valid ones for each field's type). */
export const AutomationOperator = z.enum([
  'IS',
  'IS_NOT',
  'INCLUDES',
  'EXCLUDES',
  'GREATER_THAN',
  'LESS_THAN',
  'BEFORE',
  'AFTER',
  'CONTAINS',
  'EXISTS',
  'NOT_EXISTS',
]);
export type AutomationOperator = z.infer<typeof AutomationOperator>;

/** A field a condition can test, for one event ("Client type", "Invoice balance"). */
export const AutomationConditionField = z.object({
  field: z.string().regex(/^[a-z][a-zA-Z0-9_.]{0,79}$/),
  label: z.string(),
  type: AutomationFieldType,
  operators: z.array(AutomationOperator),
  /** A status or list field's values. */
  options: z.array(z.object({ value: z.string(), label: z.string() })),
});
export type AutomationConditionField = z.infer<typeof AutomationConditionField>;

/** An event of a module: what can start a rule ("Deadline approaching"). */
export const AutomationEvent = z.object({
  code: AutomationEventCode,
  module: AutomationModule,
  label: z.string(),
  /** A plain-language example for the trigger preview. */
  example: z.string(),
  /** The kind of record that triggers it ("deadline", "invoice"), for the logs and links. */
  recordKind: z.string(),
  /** Timing it supports: IMMEDIATE only, or before and after a date on the record, or scheduled. */
  timings: z.array(AutomationTiming),
  conditionFields: z.array(AutomationConditionField),
});
export type AutomationEvent = z.infer<typeof AutomationEvent>;

/** A setting of an action ("Template", "Assignee", "Due rule"): data-driven, so the builder draws it. */
export const AutomationActionField = z.object({
  key: z.string().regex(/^[a-z][a-zA-Z0-9_]{0,59}$/),
  label: z.string(),
  type: z.enum([
    'TEXT',
    'LONG_TEXT',
    'NUMBER',
    'TOGGLE',
    'SELECT',
    'MULTI_SELECT',
    'TEMPLATE',
    'MEMBER',
    'DATE_RULE',
  ]),
  required: z.boolean(),
  choices: z.array(z.object({ value: z.string(), label: z.string() })),
  /** For TEMPLATE: the kind of message template that fits (the Templates module's kinds). */
  templateKind: z.string().nullable(),
  help: z.string().nullable(),
});
export type AutomationActionField = z.infer<typeof AutomationActionField>;

/** An action type: what a rule can do, and in which module it does it. */
export const AutomationActionTypeInfo = z.object({
  type: AutomationActionType,
  module: AutomationModule,
  label: z.string(),
  description: z.string(),
  fields: z.array(AutomationActionField),
  /** Needs a connected integration (a webhook, an SMS provider), by code. */
  requiresIntegration: z.string().nullable(),
  /** Sends to a client: it respects consent, contact data, quiet hours and provider limits. */
  contactsClient: z.boolean(),
});
export type AutomationActionTypeInfo = z.infer<typeof AutomationActionTypeInfo>;

export const AutomationCatalog = z.object({
  modules: z.array(
    z.object({ module: AutomationModule, label: z.string(), destination: z.string() }),
  ),
  events: z.array(AutomationEvent),
  actions: z.array(AutomationActionTypeInfo),
  /** Approved merge fields a template or message may use. */
  variables: z.array(z.object({ key: z.string(), label: z.string() })),
});
export type AutomationCatalog = z.infer<typeof AutomationCatalog>;

// ---------- A rule definition (a version's content) ----------

const ConfigValue = z.union([
  z.string().max(2_000),
  z.number(),
  z.boolean(),
  z.array(z.string().max(200)).max(100),
  z.null(),
]);

/** Step 1: what starts the rule. BEFORE and AFTER need an offset; IMMEDIATE and SCHEDULED have none. */
export const AutomationTrigger = z
  .strictObject({
    module: AutomationModule,
    event: AutomationEventCode,
    timing: AutomationTiming.optional().default('IMMEDIATE'),
    offsetValue: z.number().int().min(0).max(100_000).nullable().optional(),
    offsetUnit: OffsetUnit.nullable().optional(),
  })
  .superRefine((t, ctx) => {
    const offset = t.timing === 'BEFORE' || t.timing === 'AFTER';
    if (offset && (t.offsetValue == null || t.offsetUnit == null)) {
      ctx.addIssue({
        code: 'custom',
        path: ['offsetValue'],
        message: 'Enter how long before or after',
      });
    }
    if (!offset && (t.offsetValue != null || t.offsetUnit != null)) {
      ctx.addIssue({
        code: 'custom',
        path: ['offsetValue'],
        message: 'An immediate or scheduled rule has no offset',
      });
    }
  });
export type AutomationTrigger = z.input<typeof AutomationTrigger>;

/** Step 2: a condition. `value` is absent for EXISTS and NOT_EXISTS; a list for INCLUDES and EXCLUDES. */
export const AutomationCondition = z.strictObject({
  field: z.string().regex(/^[a-z][a-zA-Z0-9_.]{0,79}$/),
  operator: AutomationOperator,
  value: z
    .union([z.string().max(200), z.number(), z.boolean(), z.array(z.string().max(200)).max(100)])
    .optional(),
});
export type AutomationCondition = z.input<typeof AutomationCondition>;

/**
 * Step 3: an action. `id` is its key inside the version (an idempotency key is built from the
 * rule, the record, the occurrence and this id). `delayMinutes` waits before it runs (a Delay / Wait
 * step is this). `config` holds the action type's settings from the catalog (a message template
 * id, an assignee, a due rule); a branch's conditions are `config.branch`. An action that depends
 * on an earlier one names it in `dependsOn`: it waits, and is skipped if that one fails.
 */
export const AutomationAction = z.strictObject({
  id: z.string().regex(/^[a-z][a-z0-9_-]{0,39}$/),
  type: AutomationActionType,
  config: z.record(z.string().max(60), ConfigValue).optional().default({}),
  delayMinutes: z.number().int().min(0).max(525_600).optional().default(0),
  dependsOn: z
    .string()
    .regex(/^[a-z][a-z0-9_-]{0,39}$/)
    .nullable()
    .optional(),
});
export type AutomationAction = z.input<typeof AutomationAction>;

/** Step 4: the rule's operational settings (the definition's, versioned with it). */
export const AutomationRuleSettings = z.strictObject({
  /** Do not run twice for the same record and occurrence within this many days; 0 turns it off. */
  preventDuplicatesDays: z.number().int().min(0).max(365).optional(),
  /** Log every run and action. Required in production: the API keeps it on. */
  logAll: z.boolean().optional().default(true),
  /** Tell these people when a run fails. */
  notifyOnFailureUserIds: z.array(z.uuid()).max(20).optional().default([]),
  addToCalendar: z.boolean().optional().default(false),
  /** No client message between these times in the firm's time zone. */
  quietHours: z
    .strictObject({
      start: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
      end: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
    })
    .nullable()
    .optional(),
  /** Stop and alert when a run would act on more than this many records. */
  safetyThreshold: z.number().int().min(1).max(100_000).nullable().optional(),
});
export type AutomationRuleSettings = z.input<typeof AutomationRuleSettings>;

/** The content of a version: trigger, conditions, ordered actions and settings. */
export const AutomationDefinition = z
  .strictObject({
    trigger: AutomationTrigger,
    matchMode: MatchMode.optional().default('ALL'),
    conditions: z.array(AutomationCondition).max(20).optional().default([]),
    actions: z.array(AutomationAction).min(1).max(20),
    settings: AutomationRuleSettings.optional().default({
      logAll: true,
      notifyOnFailureUserIds: [],
      addToCalendar: false,
    }),
  })
  .superRefine((d, ctx) => {
    const ids = d.actions.map((a) => a.id);
    if (new Set(ids).size !== ids.length) {
      ctx.addIssue({ code: 'custom', path: ['actions'], message: 'Each action needs its own id' });
    }
    for (const [i, a] of d.actions.entries()) {
      if (a.dependsOn != null && ids.indexOf(a.dependsOn) >= i) {
        ctx.addIssue({
          code: 'custom',
          path: ['actions', i, 'dependsOn'],
          message: 'An action can depend only on an earlier one',
        });
      }
    }
  });
export type AutomationDefinition = z.input<typeof AutomationDefinition>;

/** A definition as returned (resolved). */
export const AutomationDefinitionView = z.object({
  trigger: z.object({
    module: AutomationModule,
    event: AutomationEventCode,
    timing: AutomationTiming,
    offsetValue: z.number().int().nullable(),
    offsetUnit: OffsetUnit.nullable(),
  }),
  matchMode: MatchMode,
  conditions: z.array(
    z.object({
      field: z.string(),
      operator: AutomationOperator,
      value: z.union([z.string(), z.number(), z.boolean(), z.array(z.string())]).nullable(),
    }),
  ),
  actions: z.array(
    z.object({
      id: z.string(),
      type: AutomationActionType,
      config: z.record(z.string(), ConfigValue),
      delayMinutes: z.number().int(),
      dependsOn: z.string().nullable(),
    }),
  ),
  settings: z.object({
    preventDuplicatesDays: z.number().int(),
    logAll: z.boolean(),
    notifyOnFailureUserIds: z.array(z.uuid()),
    addToCalendar: z.boolean(),
    quietHours: z.object({ start: z.string(), end: z.string() }).nullable(),
    safetyThreshold: z.number().int().nullable(),
  }),
});
export type AutomationDefinitionView = z.infer<typeof AutomationDefinitionView>;

// ---------- Overview ----------

export const AutomationKpi = z.object({
  value: z.number().int(),
  deltaPercent: z.number().nullable(),
  comparedTo: z.string().nullable(),
});
export type AutomationKpi = z.infer<typeof AutomationKpi>;

/** One line of Recent Activity and a row of the log table. */
export const AutomationRunRow = z.object({
  id: AutomationRunId,
  rule: z.object({ id: AutomationRuleId, name: z.string() }),
  ruleVersion: z.number().int(),
  /** "Deadline approaching": the trigger in words. */
  trigger: z.string(),
  triggerModule: AutomationModule,
  client: z.object({ id: z.uuid(), name: z.string() }).nullable(),
  recordKind: z.string().nullable(),
  recordId: z.uuid().nullable(),
  status: AutomationRunStatus,
  dryRun: z.boolean(),
  actionCount: z.number().int(),
  actionsSucceeded: z.number().int(),
  actionsFailed: z.number().int(),
  durationMs: z.number().int().nullable(),
  startedAt: DateTime.nullable(),
  createdAt: DateTime,
});
export type AutomationRunRow = z.infer<typeof AutomationRunRow>;

/**
 * GET /business/automations/overview: Frame 1. `tasksCreated` and `clientNotifications` count the
 * successful actions of those kinds in the last 30 days; `timeSavedMinutes` is the actions times
 * the firm's minutes-per-action setting (an estimate, labelled so). Health is OK when no run failed
 * in the last 24 hours and no rule needs attention.
 */
export const AutomationOverview = z.object({
  activeRules: AutomationKpi,
  tasksCreated: AutomationKpi,
  clientNotifications: AutomationKpi,
  timeSavedMinutes: AutomationKpi,
  health: z.object({
    status: z.enum(['HEALTHY', 'ATTENTION', 'FAILING']),
    failedRuns24h: z.number().int(),
    rulesNeedingAttention: z.number().int(),
    pendingRuns: z.number().int(),
  }),
  recent: z.array(AutomationRunRow).max(10),
  canCreate: z.boolean(),
  canManage: z.boolean(),
});
export type AutomationOverview = z.infer<typeof AutomationOverview>;

// ---------- Rules ----------

export const AutomationRuleRow = z.object({
  id: AutomationRuleId,
  name: z.string(),
  description: z.string().nullable(),
  category: AutomationModule,
  priority: TaskPriority,
  status: AutomationStatus,
  owner: MemberRef.nullable(),
  /** The trigger in words ("When a deadline is approaching, 7 days before"). */
  triggerSummary: z.string(),
  /** The conditions in words ("Applies to: Individual clients, state is GA"). */
  appliesTo: z.string(),
  /** The actions in order ("Create task, send email"). */
  actionsSummary: z.string(),
  currentVersion: z.number().int().nullable(),
  lastRunAt: DateTime.nullable(),
  lastRunStatus: AutomationRunStatus.nullable(),
  expiresOn: CalendarDate.nullable(),
  /** The rule needs attention: an inactive integration, a missing template, an expired date. */
  needsAttention: z.boolean(),
  archived: z.boolean(),
  updatedAt: DateTime,
});
export type AutomationRuleRow = z.infer<typeof AutomationRuleRow>;

export const AutomationVersionRow = z.object({
  version: z.number().int(),
  createdBy: MemberRef.nullable(),
  createdAt: DateTime,
  runCount: z.number().int(),
});
export type AutomationVersionRow = z.infer<typeof AutomationVersionRow>;

export const AutomationRuleDetail = AutomationRuleRow.extend({
  /** The version new runs use; null for a draft with no version. */
  definition: AutomationDefinitionView.nullable(),
  versions: z.array(AutomationVersionRow),
  stats: z.object({
    runs: z.number().int(),
    succeeded: z.number().int(),
    failed: z.number().int(),
    skipped: z.number().int(),
  }),
  /** Why the rule cannot be activated yet (the Review step's warnings that block). */
  activationBlockers: z.array(z.string()),
  createdAt: DateTime,
  canEdit: z.boolean(),
  canActivate: z.boolean(),
  /** Send it back on a change: 409 SAVE_CONFLICT when someone saved after it was loaded. */
  etag: z.string(),
});
export type AutomationRuleDetail = z.infer<typeof AutomationRuleDetail>;

/** One historical version, exactly as it ran. */
export const AutomationVersionDetail = AutomationVersionRow.extend({
  definition: AutomationDefinitionView,
});
export type AutomationVersionDetail = z.infer<typeof AutomationVersionDetail>;

export const AutomationRulesQuery = z.strictObject({
  search: SearchText.optional(),
  status: AutomationStatus.optional(),
  category: AutomationModule.optional(),
  ownerUserId: z.uuid().optional(),
  needsAttention: z.union([z.boolean(), z.stringbool()]).optional(),
  includeArchived: z.union([z.boolean(), z.stringbool()]).optional(),
  sort: z.enum(['name', 'status', 'lastRun', 'updated']).optional().default('updated'),
  direction: z.enum(['asc', 'desc']).optional().default('desc'),
  page: z.coerce.number().int().min(1).optional().default(1),
  pageSize: z.coerce.number().int().min(1).max(100).optional().default(25),
});
export type AutomationRulesQuery = z.input<typeof AutomationRulesQuery>;
export const AutomationRulePage = z.object({ items: z.array(AutomationRuleRow).max(100), ...Page });
export type AutomationRulePage = z.infer<typeof AutomationRulePage>;

const RuleMeta = {
  name: text(120),
  description: clearable(text(1_000, 'many')),
  /** The rule's own category (usually the trigger's module). */
  category: AutomationModule,
  priority: TaskPriority.optional().default('MEDIUM'),
  /** An Owner or Admin who is responsible for the rule (a member of the firm). */
  ownerUserId: z.uuid().nullable().optional(),
  /** Deactivates the rule on this date. */
  expiresOn: CalendarDate.nullable().optional(),
};

/**
 * POST /business/automations/rules (Save Draft, or Save & Activate): names are unique among live
 * rules ignoring case (409 DUPLICATE_NAME). A DRAFT may be incomplete; `activate: true` validates
 * everything (409 NOT_READY with the blockers: a missing template, an inactive integration, a
 * loop) and needs the Activate capability. Version 1 is made from `definition`.
 */
export const CreateAutomationRuleRequest = z.strictObject({
  ...RuleMeta,
  definition: AutomationDefinition,
  activate: z.boolean().optional().default(false),
});
export type CreateAutomationRuleRequest = z.input<typeof CreateAutomationRuleRequest>;

/** PATCH .../rules/{id}: the name, description, category, priority, owner or expiry; not the definition. `etag` guards it. */
export const UpdateAutomationRuleRequest = z
  .strictObject({
    name: RuleMeta.name.optional(),
    description: RuleMeta.description,
    category: RuleMeta.category.optional(),
    priority: TaskPriority.optional(),
    ownerUserId: RuleMeta.ownerUserId,
    expiresOn: RuleMeta.expiresOn,
    etag: Etag,
  })
  .refine(
    (o) => Object.keys(o).filter((k) => k !== 'etag').length > 0,
    'Change at least one field',
  );
export type UpdateAutomationRuleRequest = z.input<typeof UpdateAutomationRuleRequest>;

/**
 * PUT .../rules/{id}/definition: saves a NEW VERSION (versions are never changed). Runs already
 * pending keep the version they were made for; new runs use this one once it is the current
 * version. An ACTIVE rule's new version is validated as for activation. `etag` guards it.
 */
export const SaveAutomationDefinitionRequest = z.strictObject({
  definition: AutomationDefinition,
  etag: Etag,
});
export type SaveAutomationDefinitionRequest = z.input<typeof SaveAutomationDefinitionRequest>;

/**
 * POST .../rules/{id}/activate and .../pause (the status toggle). Deactivating stops new runs and
 * `scheduledActions` says what happens to actions already waiting: `CANCEL` them (SKIPPED) or let
 * them `FINISH`. Both are audited.
 */
export const ActivateAutomationRuleRequest = z.strictObject({ etag: Etag.optional() });
export type ActivateAutomationRuleRequest = z.input<typeof ActivateAutomationRuleRequest>;
export const PauseAutomationRuleRequest = z.strictObject({
  scheduledActions: z.enum(['CANCEL', 'FINISH']).optional().default('FINISH'),
  etag: Etag.optional(),
});
export type PauseAutomationRuleRequest = z.input<typeof PauseAutomationRuleRequest>;

// ---------- Validate, preview and test ----------

/** What a check found: BLOCK stops activation, WARN lets it through after a look. */
export const AutomationCheck = z.object({
  code: z.enum([
    'MISSING_TRIGGER',
    'MISSING_ACTION',
    'MISSING_TEMPLATE',
    'INACTIVE_INTEGRATION',
    'MISSING_PERMISSION',
    'NO_MATCHES',
    'BAD_CONTACT_DATA',
    'LOOP_RISK',
    'DEPTH_EXCEEDED',
    'HIGH_VOLUME',
    'INVALID_CONDITION',
    'INVALID_ACTION_CONFIG',
    'EXPIRED',
  ]),
  severity: z.enum(['BLOCK', 'WARN']),
  message: z.string(),
  /** The part of the definition it is about (`actions.1.config.templateId`). */
  path: z.string().nullable(),
});
export type AutomationCheck = z.infer<typeof AutomationCheck>;

/**
 * POST .../rules/validate (the Review step) and POST .../rules/{id}/test (Test / Preview): a dry
 * run. Nothing is created, sent or changed, and nothing is logged as a production run. The answer
 * has the matching count and a sample, the actions that would run in order, and the checks.
 * `definition` previews an unsaved one; `ruleId` and `version` a saved one.
 */
export const PreviewAutomationRequest = z.strictObject({
  definition: AutomationDefinition,
  /** The sample size (default 10). */
  sample: z.number().int().min(0).max(25).optional().default(10),
});
export type PreviewAutomationRequest = z.input<typeof PreviewAutomationRequest>;
export const TestAutomationRuleRequest = z.strictObject({
  version: AutomationRuleVersionNumber.optional(),
  sample: z.number().int().min(0).max(25).optional().default(10),
});
export type TestAutomationRuleRequest = z.input<typeof TestAutomationRuleRequest>;

export const AutomationPreview = z.object({
  /** The trigger in words, with the example. */
  triggerPreview: z.string(),
  matchCount: z.number().int(),
  /** The records the rule would act on now (ids and labels the caller may see). */
  sample: z.array(
    z.object({
      recordKind: z.string(),
      recordId: z.uuid(),
      label: z.string(),
      client: z.object({ id: z.uuid(), name: z.string() }).nullable(),
    }),
  ),
  plannedActions: z.array(
    z.object({
      id: z.string(),
      type: AutomationActionType,
      label: z.string(),
      delayMinutes: z.number().int(),
      summary: z.string(),
    }),
  ),
  /** Templates and integrations the rule uses, for the Review step. */
  templates: z.array(
    z.object({ id: z.uuid(), name: z.string(), kind: z.string(), active: z.boolean() }),
  ),
  integrations: z.array(
    z.object({ provider: z.string(), name: z.string(), connected: z.boolean() }),
  ),
  checks: z.array(AutomationCheck),
  /** True when nothing blocks activation. */
  canActivate: z.boolean(),
});
export type AutomationPreview = z.infer<typeof AutomationPreview>;

// ---------- Templates ----------

export const AutomationTemplateRow = z.object({
  id: AutomationTemplateId,
  name: z.string(),
  description: z.string().nullable(),
  category: AutomationModule,
  /** One of the firm's installed starter templates ("Popular Automation Templates"). */
  starter: z.boolean(),
  requiredIntegrations: z.array(z.string()),
  /** A required integration is not connected. */
  integrationsMissing: z.array(z.string()),
  triggerSummary: z.string(),
  actionsSummary: z.string(),
  archived: z.boolean(),
  updatedAt: DateTime,
});
export type AutomationTemplateRow = z.infer<typeof AutomationTemplateRow>;
export const AutomationTemplateDetail = AutomationTemplateRow.extend({
  definition: AutomationDefinitionView,
  createdBy: MemberRef.nullable(),
});
export type AutomationTemplateDetail = z.infer<typeof AutomationTemplateDetail>;

export const AutomationTemplatesQuery = z.strictObject({
  search: SearchText.optional(),
  category: AutomationModule.optional(),
  includeArchived: z.union([z.boolean(), z.stringbool()]).optional(),
  page: z.coerce.number().int().min(1).optional().default(1),
  pageSize: z.coerce.number().int().min(1).max(100).optional().default(25),
});
export type AutomationTemplatesQuery = z.input<typeof AutomationTemplatesQuery>;
export const AutomationTemplatePage = z.object({
  items: z.array(AutomationTemplateRow).max(100),
  ...Page,
});
export type AutomationTemplatePage = z.infer<typeof AutomationTemplatePage>;

/**
 * POST .../automation-templates (Save as Template, or from a rule: `ruleId`): the configuration
 * with merge variables, never client data, a secret or a token (the API removes any value that
 * looks like one and refuses a definition that names a record id).
 */
export const CreateAutomationTemplateRequest = z.strictObject({
  name: text(120),
  description: clearable(text(1_000, 'many')),
  category: AutomationModule,
  definition: AutomationDefinition,
  requiredIntegrations: z
    .array(z.string().regex(/^[a-z][a-z0-9_]{1,39}$/))
    .max(20)
    .optional()
    .default([]),
});
export type CreateAutomationTemplateRequest = z.input<typeof CreateAutomationTemplateRequest>;
export const SaveRuleAsTemplateRequest = z.strictObject({
  name: text(120),
  description: clearable(text(1_000, 'many')),
});
export type SaveRuleAsTemplateRequest = z.input<typeof SaveRuleAsTemplateRequest>;
export const UpdateAutomationTemplateRequest = z
  .strictObject({
    name: text(120).optional(),
    description: clearable(text(1_000, 'many')),
    category: AutomationModule.optional(),
    definition: AutomationDefinition.optional(),
    requiredIntegrations: z
      .array(z.string().regex(/^[a-z][a-z0-9_]{1,39}$/))
      .max(20)
      .optional(),
  })
  .refine((o) => Object.keys(o).length > 0, 'Change at least one field');
export type UpdateAutomationTemplateRequest = z.input<typeof UpdateAutomationTemplateRequest>;

/** POST .../automation-templates/import: a template exported from another firm; schema, version and permissions are validated. */
export const ImportAutomationTemplateRequest = z.strictObject({
  format: z.literal('firmivra.automation-template'),
  schemaVersion: z.literal(1),
  template: CreateAutomationTemplateRequest,
});
export type ImportAutomationTemplateRequest = z.input<typeof ImportAutomationTemplateRequest>;
export const AutomationTemplateExport = ImportAutomationTemplateRequest;

/** POST .../automation-templates/{id}/use: makes a DRAFT rule for review (never active); the name defaults to the template's. */
export const UseAutomationTemplateRequest = z.strictObject({ name: text(120).optional() });
export type UseAutomationTemplateRequest = z.input<typeof UseAutomationTemplateRequest>;

export const AutomationStartersResult = z.object({
  available: z.number().int(),
  installed: z.number().int(),
  alreadyThere: z.number().int(),
});
export type AutomationStartersResult = z.infer<typeof AutomationStartersResult>;

// ---------- Logs and run details ----------

/** GET .../runs/summary and the list: Frame 3. */
export const AutomationRunsQuery = z.strictObject({
  tab: z.enum(['all', 'success', 'failed', 'skipped', 'pending']).optional().default('all'),
  from: CalendarDate.optional(),
  to: CalendarDate.optional(),
  ruleId: AutomationRuleId.optional(),
  module: AutomationModule.optional(),
  clientId: z.uuid().optional(),
  dryRun: z.union([z.boolean(), z.stringbool()]).optional(),
  search: SearchText.optional(),
  page: z.coerce.number().int().min(1).optional().default(1),
  pageSize: z.coerce.number().int().min(1).max(100).optional().default(25),
});
export type AutomationRunsQuery = z.input<typeof AutomationRunsQuery>;
export const AutomationRunPage = z.object({ items: z.array(AutomationRunRow).max(100), ...Page });
export type AutomationRunPage = z.infer<typeof AutomationRunPage>;

export const AutomationRunsSummary = z.object({
  total: z.number().int(),
  success: z.number().int(),
  failed: z.number().int(),
  skipped: z.number().int(),
  pending: z.number().int(),
});
export type AutomationRunsSummary = z.infer<typeof AutomationRunsSummary>;

/** One action of a run (the Action Log). `detail` is a safe sentence, never data. */
export const AutomationActionLog = z.object({
  actionKey: z.string(),
  position: z.number().int(),
  type: AutomationActionType,
  label: z.string(),
  status: ActionExecutionStatus,
  attempts: z.number().int(),
  retryable: z.boolean(),
  errorCode: z.string().nullable(),
  detail: z.string().nullable(),
  scheduledFor: DateTime.nullable(),
  /** What it made, by kind and id ("task", "message"), when the caller may open it. */
  result: z.object({ kind: z.string(), id: z.uuid() }).nullable(),
  startedAt: DateTime.nullable(),
  finishedAt: DateTime.nullable(),
});
export type AutomationActionLog = z.infer<typeof AutomationActionLog>;

/** Log Details: run information, the error panel, the action log, the rule snapshot and related records. */
export const AutomationRunDetail = AutomationRunRow.extend({
  sourceEventKey: z.string(),
  correlationId: z.uuid(),
  depth: z.number().int(),
  parentRunId: AutomationRunId.nullable(),
  finishedAt: DateTime.nullable(),
  error: z
    .object({ code: z.string(), message: z.string(), remediation: z.string().nullable() })
    .nullable(),
  actions: z.array(AutomationActionLog),
  /** The rule's definition as this run used it; later edits never change it. */
  ruleSnapshot: AutomationDefinitionView,
  /** The current version differs from the one this run used. */
  ruleChanged: z.boolean(),
  related: z.array(z.object({ kind: z.string(), id: z.uuid(), label: z.string() })),
  rerun: z.object({
    count: z.number().int(),
    lastAt: DateTime.nullable(),
    lastBy: MemberRef.nullable(),
    lastReason: z.string().nullable(),
  }),
  /** Which actions a re-run would retry (failed and retryable only). */
  retryableActionKeys: z.array(z.string()),
  canRerun: z.boolean(),
});
export type AutomationRunDetail = z.infer<typeof AutomationRunDetail>;

/**
 * POST .../runs/{id}/rerun: retries the FAILED, retryable actions of this run only (a task that
 * was made is never made again). Needs the Retry capability and a reason (audited). If the rule
 * changed since, `confirmRuleChanged` is required; if the condition no longer matches the run is
 * SKIPPED unless `force` (Automation Admin). An inactive integration pauses retries (409
 * INTEGRATION_INACTIVE); an invalid contact is a non-retryable failure.
 */
export const RerunAutomationRequest = z.strictObject({
  reason: text(500, 'many'),
  actionKeys: z
    .array(z.string().regex(/^[a-z][a-z0-9_-]{0,39}$/))
    .min(1)
    .max(20)
    .optional(),
  confirmRuleChanged: z.boolean().optional().default(false),
  force: z.boolean().optional().default(false),
});
export type RerunAutomationRequest = z.input<typeof RerunAutomationRequest>;

/**
 * POST .../runs/export (Export Logs): CSV of the filtered runs with ids and safe columns only (no
 * client names beyond the id unless the caller may see clients), up to 50,000 rows (422-style
 * `TOO_MANY_ROWS` otherwise: narrow the filter). Needs the Export capability; the export is audited.
 */
export const ExportAutomationLogsRequest = z.strictObject({
  filter: AutomationRunsQuery.omit({ page: true, pageSize: true }),
  format: z.literal('CSV').optional().default('CSV'),
});
export type ExportAutomationLogsRequest = z.input<typeof ExportAutomationLogsRequest>;
export const AutomationLogExport = DownloadLink.extend({
  rowCount: z.number().int(),
  fileName: z.string(),
});
export type AutomationLogExport = z.infer<typeof AutomationLogExport>;

// ---------- Settings ----------

/**
 * GET and PUT /business/automations/settings: quiet hours for client messages, the default
 * duplicate window, the loop depth, the default safety threshold, who is told when a rule fails,
 * the minutes each action counts as saving (the Time Saved figure) and how long logs are kept.
 * Automation Admin changes them; a new default applies to new rules only.
 */
export const AutomationSettingsView = z.object({
  quietHours: z.object({ start: z.string(), end: z.string() }).nullable(),
  defaultDedupeDays: z.number().int(),
  maxDepth: z.number().int(),
  safetyThreshold: z.number().int(),
  failureAlertUsers: z.array(MemberRef),
  minutesSavedPerAction: z.number().int(),
  logRetentionDays: z.number().int(),
  timezone: z.string(),
  updatedAt: DateTime.nullable(),
});
export type AutomationSettingsView = z.infer<typeof AutomationSettingsView>;
export const SaveAutomationSettingsRequest = z
  .strictObject({
    quietHours: z
      .strictObject({
        start: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
        end: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
      })
      .nullable()
      .optional(),
    defaultDedupeDays: z.number().int().min(0).max(365).optional(),
    maxDepth: z.number().int().min(1).max(10).optional(),
    safetyThreshold: z.number().int().min(1).max(100_000).optional(),
    failureAlertUserIds: z.array(z.uuid()).max(20).optional(),
    minutesSavedPerAction: z.number().int().min(0).max(240).optional(),
    logRetentionDays: z.number().int().min(30).max(2_555).optional(),
  })
  .refine((o) => Object.keys(o).length > 0, 'Change at least one field');
export type SaveAutomationSettingsRequest = z.input<typeof SaveAutomationSettingsRequest>;

// ---------- Errors ----------

export const AutomationErrorCode = z.enum([
  /** 409: a live rule has this name. */
  'DUPLICATE_NAME',
  /** 409: someone saved after it was loaded. */
  'SAVE_CONFLICT',
  /** 409: the rule cannot be activated or saved active; the checks name what blocks it. */
  'NOT_READY',
  /** 409: the rule is archived. */
  'RULE_ARCHIVED',
  /** 409: the status change does not fit the rule's status. */
  'INVALID_STATUS',
  /** 400: an event, field, operator or action type the catalog does not have, or a setting it refuses. */
  'INVALID_DEFINITION',
  /** 409: a re-run needs the confirmation that the rule changed, or the run has nothing to retry. */
  'RERUN_NOT_ALLOWED',
  /** 409: a connection the action needs is not active; retries are paused. */
  'INTEGRATION_INACTIVE',
  /** 409: a person is not an active member of the firm. */
  'NOT_A_MEMBER',
  /** 409: the export is larger than 50,000 rows; narrow the filter. */
  'TOO_MANY_ROWS',
  /** 409: the template needs an integration or permission the firm does not have. */
  'TEMPLATE_UNAVAILABLE',
]);
export type AutomationErrorCode = z.infer<typeof AutomationErrorCode>;
