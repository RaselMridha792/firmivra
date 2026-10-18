import { z } from 'zod';
import { MemberRef } from '../clients/schemas.js';
import { SearchText, text } from '../clients/text.js';
import {
  ApplicabilityDecision,
  ApplicabilityOutcome,
  ComplianceLogKind,
  DeadlineFrequency,
  DeadlineType,
  HolidayRule,
  JurisdictionLevel,
  LogOutcome,
  RecurrenceEnd,
  ServiceKind,
  TaskPriority,
  TaskSeriesStatus,
} from '../db-enums.js';
import {
  ComplianceDay,
  ComplianceClientRef,
  ComplianceReminderOut,
  ComplianceReminders,
  ComplianceDateTime,
  ComplianceDirection,
  CompliancePage,
  ComplianceQueryBool,
  ComplianceStateCode,
  compliancePageQuery,
} from './schemas.js';

// Frame 3 of Compliance & Deadlines: recurring definitions and templates, applicability rules (who
// gets, or is only suggested, a library entry's or a recurrence's deadline), the suggestions
// queue, the logs and the firm's Compliance settings. Staff read the recurring definitions, the
// suggestions and the logs and settings; Owner and Admin create, change and end recurring
// definitions and manage the rules and settings.

const Int = z.number().int();

export const ComplianceRecurrenceId = z.uuid();
export const ComplianceRuleId = z.uuid();
export const ComplianceSuggestionId = z.uuid();

// ---------- Recurring deadlines ----------

/**
 * The repeat-on choice, by frequency:
 * - MONTHLY: `{ dayOfMonth }` (day 31 is the last day of a shorter month) or `{ nth, weekday }`
 *   (the nth, 1 to 5, weekday, 0 Sunday to 6 Saturday; 5 is the last).
 * - QUARTERLY: `{ monthsAfterQuarterEnd, dayOfMonth }` (a quarter rule: 1 and 30 for Form 941).
 * - ANNUAL: `{ month, day }`.
 * - CUSTOM: every `interval` months, on `{ dayOfMonth }` or `{ nth, weekday }`.
 * - AUTHORITY_DEFINED: `{}`; the dates follow the authority's published calendar.
 */
export const ComplianceRepeatRule = z.union([
  z.strictObject({}),
  z.strictObject({ dayOfMonth: z.number().int().min(1).max(31) }),
  z.strictObject({
    nth: z.number().int().min(1).max(5),
    weekday: z.number().int().min(0).max(6),
  }),
  z.strictObject({
    monthsAfterQuarterEnd: z.number().int().min(0).max(3),
    dayOfMonth: z.number().int().min(1).max(31),
  }),
  z.strictObject({
    month: z.number().int().min(1).max(12),
    day: z.number().int().min(1).max(31),
  }),
]);
export type ComplianceRepeatRule = z.infer<typeof ComplianceRepeatRule>;

type Shape = {
  frequency: DeadlineFrequency;
  interval?: number | null;
  repeatRule: ComplianceRepeatRule;
  endMode?: RecurrenceEnd;
  endAfterCount?: number | null;
  endOn?: string | null;
  startOn?: string | null;
  isTemplate?: boolean;
};

/** The rules the database also enforces, so a bad request is a 400 and not a failed write. */
function checkShape(b: Shape, ctx: z.RefinementCtx) {
  const issue = (path: string, message: string) =>
    ctx.addIssue({ code: 'custom', path: [path], message });
  const keys = Object.keys(b.repeatRule).sort().join(',');
  const wanted: Record<DeadlineFrequency, string[]> = {
    MONTHLY: ['dayOfMonth', 'nth,weekday'],
    QUARTERLY: ['dayOfMonth,monthsAfterQuarterEnd'],
    ANNUAL: ['day,month'],
    CUSTOM: ['dayOfMonth', 'nth,weekday'],
    AUTHORITY_DEFINED: [''],
  };
  if (!wanted[b.frequency].includes(keys)) {
    issue('repeatRule', 'This repeat rule does not fit the frequency');
  }
  if (b.frequency === 'CUSTOM' && (b.interval ?? null) === null) {
    issue('interval', 'Say how many months apart');
  }
  if (b.frequency !== 'CUSTOM' && (b.interval ?? null) !== null) {
    issue('interval', 'Only a custom frequency has an interval');
  }
  if (!b.isTemplate && !b.startOn) issue('startOn', 'Choose when it starts');
  const mode = b.endMode ?? 'NEVER';
  if (mode === 'AFTER_COUNT' && (b.endAfterCount ?? null) === null) {
    issue('endAfterCount', 'Say after how many deadlines it ends');
  }
  if (mode === 'ON_DATE' && !b.endOn) issue('endOn', 'Choose the end date');
  if (mode !== 'AFTER_COUNT' && (b.endAfterCount ?? null) !== null) {
    issue('endAfterCount', 'Only "after a number" ends by count');
  }
  if (mode !== 'ON_DATE' && b.endOn) issue('endOn', 'Only "on a date" has an end date');
  if (mode === 'ON_DATE' && b.endOn && b.startOn && b.endOn < b.startOn) {
    issue('endOn', 'The end date is before the start');
  }
}

const recurrenceFields = {
  name: text(200),
  type: DeadlineType,
  description: text(2000, 'many').nullable().optional(),
  agency: text(120).nullable().optional(),
  relatedForm: text(60).nullable().optional(),
  jurisdiction: JurisdictionLevel.nullable().optional(),
  state: ComplianceStateCode.nullable().optional(),
  /** Made from this entry of a published library calendar. */
  calendarEntryId: z.uuid().nullable().optional(),
  frequency: DeadlineFrequency,
  /** Every N months, for CUSTOM only. */
  interval: z.number().int().min(1).max(365).nullable().optional(),
  repeatRule: ComplianceRepeatRule.optional().default({}),
  startOn: ComplianceDay.nullable().optional(),
  endMode: RecurrenceEnd.optional().default('NEVER'),
  endAfterCount: z.number().int().min(1).max(1000).nullable().optional(),
  endOn: ComplianceDay.nullable().optional(),
  holidayRule: HolidayRule.optional().default('NEXT_BUSINESS_DAY'),
  /** A template (Quick Templates, "Use Existing Template") makes no deadlines. */
  isTemplate: z.boolean().optional().default(false),
  createTask: z.boolean().optional().default(false),
  taskTemplateId: z.uuid().nullable().optional(),
  assignedUserId: z.uuid().nullable().optional(),
  clientVisible: z.boolean().optional().default(false),
  remindClient: z.boolean().optional().default(false),
  addToTaxCalendar: z.boolean().optional().default(true),
  notifyTeam: z.boolean().optional().default(false),
  reminders: ComplianceReminders.optional().default([]),
  sendPastDueNotice: z.boolean().optional().default(false),
  escalateToManager: z.boolean().optional().default(false),
};

/** POST /business/compliance/recurrences (Owner and Admin). */
export const CreateComplianceRecurrenceRequest = z
  .strictObject(recurrenceFields)
  .superRefine((b, ctx) => {
    checkShape(b, ctx);
    if (b.remindClient && !b.clientVisible) {
      ctx.addIssue({
        code: 'custom',
        path: ['remindClient'],
        message: 'Make the deadline visible to the client to remind them',
      });
    }
    if (!b.createTask && b.taskTemplateId) {
      ctx.addIssue({
        code: 'custom',
        path: ['taskTemplateId'],
        message: 'Choose "create a task" to use a task template',
      });
    }
  });
export type CreateComplianceRecurrenceRequest = z.input<typeof CreateComplianceRecurrenceRequest>;

/** PATCH /business/compliance/recurrences/{id}: any field; an ended or archived definition stays as it is. */
export const UpdateComplianceRecurrenceRequest = z
  .strictObject({
    name: recurrenceFields.name,
    type: recurrenceFields.type,
    description: recurrenceFields.description,
    agency: recurrenceFields.agency,
    relatedForm: recurrenceFields.relatedForm,
    jurisdiction: recurrenceFields.jurisdiction,
    state: recurrenceFields.state,
    calendarEntryId: recurrenceFields.calendarEntryId,
    frequency: recurrenceFields.frequency,
    interval: recurrenceFields.interval,
    repeatRule: ComplianceRepeatRule,
    startOn: recurrenceFields.startOn,
    endMode: RecurrenceEnd,
    endAfterCount: recurrenceFields.endAfterCount,
    endOn: recurrenceFields.endOn,
    holidayRule: HolidayRule,
    createTask: z.boolean(),
    taskTemplateId: recurrenceFields.taskTemplateId,
    assignedUserId: recurrenceFields.assignedUserId,
    clientVisible: z.boolean(),
    remindClient: z.boolean(),
    addToTaxCalendar: z.boolean(),
    notifyTeam: z.boolean(),
    reminders: ComplianceReminders,
    sendPastDueNotice: z.boolean(),
    escalateToManager: z.boolean(),
  })
  .partial()
  .refine((b) => Object.keys(b).length > 0, 'Change at least one field');
export type UpdateComplianceRecurrenceRequest = z.input<typeof UpdateComplianceRecurrenceRequest>;

export const ComplianceRecurrence = z.object({
  id: z.uuid(),
  name: z.string(),
  type: DeadlineType,
  description: z.string().nullable(),
  agency: z.string().nullable(),
  relatedForm: z.string().nullable(),
  jurisdiction: JurisdictionLevel.nullable(),
  state: ComplianceStateCode.nullable(),
  calendarEntry: z.object({ id: z.uuid(), name: z.string() }).nullable(),
  frequency: DeadlineFrequency,
  interval: Int.nullable(),
  repeatRule: ComplianceRepeatRule,
  startOn: ComplianceDay.nullable(),
  endMode: RecurrenceEnd,
  endAfterCount: Int.nullable(),
  endOn: ComplianceDay.nullable(),
  holidayRule: HolidayRule,
  isTemplate: z.boolean(),
  createTask: z.boolean(),
  taskTemplateId: z.uuid().nullable(),
  assignedTo: MemberRef.nullable(),
  clientVisible: z.boolean(),
  remindClient: z.boolean(),
  addToTaxCalendar: z.boolean(),
  notifyTeam: z.boolean(),
  reminders: z.array(ComplianceReminderOut),
  sendPastDueNotice: z.boolean(),
  escalateToManager: z.boolean(),
  status: TaskSeriesStatus,
  pausedAt: ComplianceDateTime.nullable(),
  endedAt: ComplianceDateTime.nullable(),
  /** The next date from today by the repeat rule (adjusted for weekends and holidays); null when it has none (a template, ended, or authority-defined). */
  nextDueOn: ComplianceDay.nullable(),
  /** Deadlines made from this definition so far. */
  deadlineCount: Int,
  createdAt: ComplianceDateTime,
  updatedAt: ComplianceDateTime,
});
export type ComplianceRecurrence = z.infer<typeof ComplianceRecurrence>;

/** GET /business/compliance/recurrences (Manage Existing Recurring, and the Recurring tab). */
export const ComplianceRecurrencesQuery = z.strictObject({
  status: TaskSeriesStatus.optional(),
  /** Templates only (true) or definitions only (false); both when left out. */
  templates: ComplianceQueryBool.optional(),
  type: DeadlineType.optional(),
  search: SearchText.optional(),
  sort: z.enum(['name', 'type', 'status', 'nextDueOn']).optional().default('name'),
  direction: ComplianceDirection.optional().default('asc'),
  ...compliancePageQuery(25),
});
export type ComplianceRecurrencesQuery = z.input<typeof ComplianceRecurrencesQuery>;

export const ComplianceRecurrencePage = z.object({
  items: z.array(ComplianceRecurrence).max(100),
  ...CompliancePage,
});
export type ComplianceRecurrencePage = z.infer<typeof ComplianceRecurrencePage>;

/** POST .../recurrences/preview: the next calculated dates, before saving. */
export const PreviewRecurrenceRequest = z
  .strictObject({
    frequency: DeadlineFrequency,
    interval: recurrenceFields.interval,
    repeatRule: ComplianceRepeatRule.optional().default({}),
    startOn: ComplianceDay.optional(),
    endMode: RecurrenceEnd.optional().default('NEVER'),
    endAfterCount: recurrenceFields.endAfterCount,
    endOn: recurrenceFields.endOn,
    holidayRule: HolidayRule.optional().default('NEXT_BUSINESS_DAY'),
    calendarEntryId: z.uuid().nullable().optional(),
    /** How many dates, 1 to 24. */
    count: z.number().int().min(1).max(24).optional().default(6),
  })
  .superRefine((b, ctx) => checkShape({ ...b, isTemplate: true }, ctx));
export type PreviewRecurrenceRequest = z.input<typeof PreviewRecurrenceRequest>;

export const ComplianceRecurrencePreview = z.object({
  dates: z.array(
    z.object({
      /** The date by the rule, kept as it is whatever the holiday rule does. */
      statutoryOn: ComplianceDay,
      /** The date the firm works to: moved by the holiday rule from a weekend or a federal holiday. */
      dueOn: ComplianceDay,
      adjusted: z.boolean(),
    }),
  ),
  /** Why there are no dates, e.g. an authority-defined rule with no published date. */
  message: z.string().nullable(),
});
export type ComplianceRecurrencePreview = z.infer<typeof ComplianceRecurrencePreview>;

// ---------- Applicability rules ----------

const Criteria = z
  .record(z.string().max(60), z.union([z.string().max(200), z.number(), z.boolean()]))
  .refine((c) => Object.keys(c).length <= 20, 'Use at most 20 criteria');

/** The state codes the database accepts in a rule (the states, DC included). */
export const COMPLIANCE_STATES = [
  'AL',
  'AK',
  'AZ',
  'AR',
  'CA',
  'CO',
  'CT',
  'DE',
  'DC',
  'FL',
  'GA',
  'HI',
  'ID',
  'IL',
  'IN',
  'IA',
  'KS',
  'KY',
  'LA',
  'ME',
  'MD',
  'MA',
  'MI',
  'MN',
  'MS',
  'MO',
  'MT',
  'NE',
  'NV',
  'NH',
  'NJ',
  'NM',
  'NY',
  'NC',
  'ND',
  'OH',
  'OK',
  'OR',
  'PA',
  'RI',
  'SC',
  'SD',
  'TN',
  'TX',
  'UT',
  'VT',
  'VA',
  'WA',
  'WV',
  'WI',
  'WY',
] as const;
const RuleState = z.enum(COMPLIANCE_STATES);

const ruleFields = {
  name: text(200),
  outcome: ApplicabilityOutcome.optional().default('SUGGEST'),
  /** Federal classification or entity codes, e.g. "S_CORPORATION", "LLC_MULTI_MEMBER". */
  entityTypes: z.array(text(60)).max(30).optional().default([]),
  /** The client's state (the profile's), two letters. */
  states: z.array(RuleState).max(60).optional().default([]),
  services: z.array(ServiceKind).max(10).optional().default([]),
  /** Clients with one of these statuses (for example INACTIVE) never match. */
  excludeStatuses: z.array(text(60)).max(20).optional().default([]),
  priorYearLiabilityOverCents: z.number().int().min(0).max(2_000_000_000).nullable().optional(),
  /** Anything else (election, fiscal year end, payroll or sales tax registration); needs staff review while the client has no such data. */
  criteria: Criteria.optional().default({}),
  active: z.boolean().optional().default(true),
};

/** What a rule makes deadlines for: one library entry or one recurring definition. */
export const ComplianceRuleTargetInput = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('CALENDAR_ENTRY'), id: z.uuid() }),
  z.strictObject({ kind: z.literal('RECURRENCE'), id: z.uuid() }),
]);
export type ComplianceRuleTargetInput = z.input<typeof ComplianceRuleTargetInput>;

/** POST /business/compliance/applicability-rules (Owner and Admin): for exactly one library entry or one recurrence. */
export const CreateApplicabilityRuleRequest = z.strictObject({
  ...ruleFields,
  target: ComplianceRuleTargetInput,
});
export type CreateApplicabilityRuleRequest = z.input<typeof CreateApplicabilityRuleRequest>;

/** PATCH .../applicability-rules/{id}: any field except the target. Each change raises the rule's version. */
export const UpdateApplicabilityRuleRequest = z
  .strictObject({
    name: ruleFields.name,
    outcome: ApplicabilityOutcome,
    entityTypes: z.array(text(60)).max(30),
    states: z.array(RuleState).max(60),
    services: z.array(ServiceKind).max(10),
    excludeStatuses: z.array(text(60)).max(20),
    priorYearLiabilityOverCents: ruleFields.priorYearLiabilityOverCents,
    criteria: Criteria,
    active: z.boolean(),
  })
  .partial()
  .refine((b) => Object.keys(b).length > 0, 'Change at least one field');
export type UpdateApplicabilityRuleRequest = z.input<typeof UpdateApplicabilityRuleRequest>;

export const ComplianceApplicabilityRule = z.object({
  id: z.uuid(),
  name: z.string(),
  target: z.object({
    kind: z.enum(['CALENDAR_ENTRY', 'RECURRENCE']),
    id: z.uuid(),
    name: z.string(),
  }),
  outcome: ApplicabilityOutcome,
  entityTypes: z.array(z.string()),
  states: z.array(z.string()),
  services: z.array(ServiceKind),
  excludeStatuses: z.array(z.string()),
  priorYearLiabilityOverCents: Int.nullable(),
  criteria: z.record(z.string(), z.unknown()),
  active: z.boolean(),
  version: Int,
  createdAt: ComplianceDateTime,
  updatedAt: ComplianceDateTime,
});
export type ComplianceApplicabilityRule = z.infer<typeof ComplianceApplicabilityRule>;

export const ComplianceApplicabilityRulesQuery = z.strictObject({
  active: ComplianceQueryBool.optional(),
  calendarEntryId: z.uuid().optional(),
  recurrenceId: z.uuid().optional(),
  search: SearchText.optional(),
  ...compliancePageQuery(25),
});
export type ComplianceApplicabilityRulesQuery = z.input<typeof ComplianceApplicabilityRulesQuery>;

export const ComplianceApplicabilityRulePage = z.object({
  items: z.array(ComplianceApplicabilityRule).max(100),
  ...CompliancePage,
});
export type ComplianceApplicabilityRulePage = z.infer<typeof ComplianceApplicabilityRulePage>;

/** POST .../applicability-rules/{id}/evaluate: which of the caller's clients the rule matches. Writes nothing. */
export const ComplianceRuleEvaluation = z.object({
  ruleId: z.uuid(),
  ruleVersion: Int,
  matchingCount: Int,
  /** The first 100. */
  matching: z.array(ComplianceClientRef).max(100),
  /** Clients the rule cannot decide for lack of data (never generated silently). */
  needsReviewCount: Int,
  needsReview: z.array(z.object({ client: ComplianceClientRef, reason: z.string() })).max(100),
  excludedCount: Int,
});
export type ComplianceRuleEvaluation = z.infer<typeof ComplianceRuleEvaluation>;

// ---------- Suggestions (applicability decisions) ----------

export const ComplianceSuggestionFilter = z.enum([
  /** Suggested or needing review (the queue). */
  'OPEN',
  ...ApplicabilityDecision.options,
]);

export const ComplianceSuggestionsQuery = z.strictObject({
  decision: ComplianceSuggestionFilter.optional().default('OPEN'),
  clientId: z.uuid().optional(),
  ruleId: z.uuid().optional(),
  ...compliancePageQuery(25),
});
export type ComplianceSuggestionsQuery = z.input<typeof ComplianceSuggestionsQuery>;

export const ComplianceSuggestion = z.object({
  id: z.uuid(),
  client: ComplianceClientRef,
  rule: z.object({ id: z.uuid(), name: z.string(), version: Int }),
  /** The deadline's name: the library entry's or the recurrence's. */
  name: z.string(),
  dueOn: ComplianceDay,
  decision: ApplicabilityDecision,
  /** Why it applies, needs review or was dismissed, with the rule version. */
  reason: z.string(),
  deadlineId: z.uuid().nullable(),
  decidedBy: MemberRef.nullable(),
  decidedAt: ComplianceDateTime.nullable(),
  createdAt: ComplianceDateTime,
});
export type ComplianceSuggestion = z.infer<typeof ComplianceSuggestion>;

export const ComplianceSuggestionPage = z.object({
  items: z.array(ComplianceSuggestion).max(100),
  ...CompliancePage,
});
export type ComplianceSuggestionPage = z.infer<typeof ComplianceSuggestionPage>;

/**
 * POST /business/compliance/suggestions: runs a rule for one due date over the caller's clients
 * and records what it decided: suggested, needing review, or (APPLY rules) the deadline made.
 * `dueOn` is the library entry's fixed date when it has one; any other entry or recurrence needs it (a
 * date is never invented). Running it again for the same date adds nothing.
 */
export const GenerateSuggestionsRequest = z.strictObject({
  ruleId: z.uuid(),
  dueOn: ComplianceDay.optional(),
});
export type GenerateSuggestionsRequest = z.input<typeof GenerateSuggestionsRequest>;

export const GenerateSuggestionsResult = z.object({
  ruleId: z.uuid(),
  dueOn: ComplianceDay,
  suggested: Int,
  needsReview: Int,
  /** APPLY rules: deadlines made at once. */
  applied: Int,
  /** Clients that already had a record for this rule and date. */
  alreadyDecided: Int,
});
export type GenerateSuggestionsResult = z.infer<typeof GenerateSuggestionsResult>;

/** POST .../suggestions/{id}/confirm: makes the client's deadline on the suggestion's date. Anything left out is taken from the entry or recurrence. */
export const ConfirmSuggestionRequest = z.strictObject({
  assignedUserId: z.uuid().nullable().optional(),
  priority: TaskPriority.optional(),
  clientVisible: z.boolean().optional(),
});
export type ConfirmSuggestionRequest = z.input<typeof ConfirmSuggestionRequest>;

export const DismissSuggestionRequest = z.strictObject({ reason: text(400, 'many') });
export type DismissSuggestionRequest = z.input<typeof DismissSuggestionRequest>;

// ---------- Logs ----------

/** GET /business/compliance/logs: imports, verification, publishing, generation, overrides and errors. */
export const ComplianceLogsQuery = z
  .strictObject({
    kind: ComplianceLogKind.optional(),
    outcome: LogOutcome.optional(),
    calendarId: z.uuid().optional(),
    from: ComplianceDay.optional(),
    to: ComplianceDay.optional(),
    ...compliancePageQuery(25),
  })
  .refine((q) => !q.from || !q.to || q.from <= q.to, {
    message: 'The end date is before the start date',
    path: ['to'],
  });
export type ComplianceLogsQuery = z.input<typeof ComplianceLogsQuery>;

export const ComplianceLog = z.object({
  id: z.uuid(),
  kind: ComplianceLogKind,
  outcome: LogOutcome,
  message: z.string().nullable(),
  calendarId: z.uuid().nullable(),
  deadlineId: z.uuid().nullable(),
  recurrenceId: z.uuid().nullable(),
  /** Ids and counts only. */
  details: z.record(z.string(), z.unknown()),
  actor: MemberRef.nullable(),
  createdAt: ComplianceDateTime,
});
export type ComplianceLog = z.infer<typeof ComplianceLog>;

export const ComplianceLogPage = z.object({
  items: z.array(ComplianceLog).max(100),
  ...CompliancePage,
});
export type ComplianceLogPage = z.infer<typeof ComplianceLogPage>;

// ---------- Settings ----------

export const ComplianceTypeTemplate = z.strictObject({
  type: DeadlineType,
  taskTemplateId: z.uuid(),
});
export type ComplianceTypeTemplate = z.infer<typeof ComplianceTypeTemplate>;

/** The Settings button: thresholds, stale calendars, default reminders, escalation and a default task template per type. */
export const ComplianceSettings = z.object({
  dueSoonDays: Int,
  atRiskDays: Int,
  staleCalendarDays: Int,
  defaultReminders: z.array(ComplianceReminderOut),
  sendPastDueNotice: z.boolean(),
  escalateToManager: z.boolean(),
  escalateAfterDays: Int,
  /** A task template per deadline type, used when a deadline of that type creates a task and names none. */
  taskTemplates: z.array(ComplianceTypeTemplate),
});
export type ComplianceSettings = z.infer<typeof ComplianceSettings>;

/** PATCH /business/compliance/settings (Owner and Admin): any of the settings. */
export const UpdateComplianceSettingsRequest = z
  .strictObject({
    dueSoonDays: z.number().int().min(1).max(90),
    atRiskDays: z.number().int().min(1).max(90),
    staleCalendarDays: z.number().int().min(7).max(730),
    defaultReminders: ComplianceReminders,
    sendPastDueNotice: z.boolean(),
    escalateToManager: z.boolean(),
    escalateAfterDays: z.number().int().min(1).max(60),
    /** The whole list: a type left out has no default template. */
    taskTemplates: z
      .array(ComplianceTypeTemplate)
      .max(20)
      .refine(
        (rows) => new Set(rows.map((r) => r.type)).size === rows.length,
        'Give each deadline type once',
      ),
  })
  .partial()
  .refine((b) => Object.keys(b).length > 0, 'Change at least one setting');
export type UpdateComplianceSettingsRequest = z.input<typeof UpdateComplianceSettingsRequest>;
