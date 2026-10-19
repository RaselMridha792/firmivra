import { z } from 'zod';
import { Email } from '../auth/schemas.js';
import { Phone } from '../client-auth/schemas.js';
import { clearable, SearchText, text } from '../clients/text.js';
import {
  FirmApplicationStatus,
  PlatformBillingCycle,
  PlatformSubscriptionStatus,
  SalesActivityDirection,
  SalesActivityKind,
  SalesActivityOutcome,
  SalesChangeSource,
  SalesFollowUpKind,
  SalesFollowUpStatus,
  SalesLeadSource,
  SalesLostReason,
  SalesStageType,
  SalesTargetMetric,
  SalesTargetPeriod,
  SalesTargetScope,
  SalesTransactionStatus,
} from '../db-enums.js';

// Super Admin Sales (R0 stages B5 and D1, `sales_*` tables; contract notes
// docs/work/R0-stage-b5-sales.md and docs/work/R0-stage-d1-sales-center.md; notes on this
// contract in docs/work/R60-backend.md). Firmivra selling to prospective firms: the Sales Center
// (numbers, plans, activity, follow-ups, lead sources, targets), the Sales Pipeline (board, list,
// KPIs, analytics), the opportunity record and the pipeline builder.
// Routes: /api/v1/admin/sales/... (the Super Admin site's session only).
// One dataset behind every view: the board, the list, the KPIs, the analytics and the record read
// the same rows, and every number is counted from them. With no records the API answers zeros and
// empty lists; a trend is null when there is nothing to compare with.
// The database keeps the lifecycle: stage types and required fields, lost reasons, Under Contract
// and Closed only through the linked transaction, the history (the database writes it), notes
// changed only by their author, and nothing deleted (lose, switch off or cancel instead).
// Money is integer cents (USD). Days are `YYYY-MM-DD` UTC days, as D1's targets; times are ISO
// with an offset. Responses are plain objects (a field the API adds later is dropped); requests
// are strict.

const DateTime = z.iso.datetime({ offset: true });
/** `YYYY-MM-DD`, a UTC day. */
const Day = z.iso.date();
const Id = z.uuid();

export const SalesOpportunityId = Id;
export const SalesContactId = Id;
export const SalesPipelineId = Id;
export const SalesStageId = Id;
export const SalesTagId = Id;
export const SalesNoteId = Id;
export const SalesFollowUpId = Id;
export const SalesTargetId = Id;
/** A `platform_plans` row. */
export const SalesPlanId = Id;
/** A team member's user id (`platform_admins.user_id`). */
export const SalesRepId = Id;

/** Several values in one query parameter: an array in, `a,b` on the wire, an array out. */
const listOf = <T extends z.ZodType>(item: T) =>
  z
    .preprocess(
      (value) => (typeof value === 'string' ? value.split(',').filter(Boolean) : value),
      z.array(item).max(20),
    )
    .optional();

/** A yes/no filter: a boolean in, `true` or `false` on the wire, a boolean out. */
const Flag = z
  .union([z.boolean(), z.enum(['true', 'false']).transform((value) => value === 'true')])
  .optional();

/*
 * The platform tables' text check (`platform_text_ok`) refuses a few characters `text` allows:
 * the soft hyphen U+00AD, U+034F, U+17B4, U+17B5 and the line and paragraph separators U+2028 and
 * U+2029. It also needs one character it counts as visible: not a space, U+00A0, U+1680, U+2000
 * to U+200F, U+202F, U+205F, U+2800, U+3000 or a variation selector (U+FE00 to U+FE0F).
 */
const PLATFORM_REFUSED = new Set([0x00ad, 0x034f, 0x17b4, 0x17b5, 0x2028, 0x2029]);
/** Code points, so the check needs no character class with combining marks. */
const codePoints = (value: string) => Array.from(value, (char) => char.codePointAt(0) ?? 0);
const blank = (point: number) =>
  /\s/u.test(String.fromCodePoint(point)) ||
  point === 0x00a0 ||
  point === 0x1680 ||
  (point >= 0x2000 && point <= 0x200f) ||
  point === 0x202f ||
  point === 0x205f ||
  point === 0x2800 ||
  point === 0x3000 ||
  (point >= 0xfe00 && point <= 0xfe0f);

/** `text` that the sales tables also accept: trimmed, 1 to `max` characters. */
const platformText = (max: number, lines: 'one' | 'many' = 'one', empty = 'Enter a value') =>
  text(max, lines, empty)
    .refine(
      (value) => !codePoints(value).some((point) => PLATFORM_REFUSED.has(point)),
      'Remove the special characters',
    )
    .refine((value) => codePoints(value).some((point) => !blank(point)), empty);

/** Optional text: '' for none (stored as null), otherwise as `platformText`. */
const optionalText = (max: number, lines: 'one' | 'many' = 'one') =>
  z
    .string()
    .trim()
    .pipe(z.union([z.literal(''), platformText(max, lines)]));

const AMOUNT = 'Enter an amount between $0 and $10,000,000.';
/** An estimated value in cents, $0 to $10,000,000. */
const Cents = z.number().int(AMOUNT).min(0, AMOUNT).max(1_000_000_000, AMOUNT);

// ---------- Labels and enums ----------

export const SALES_STAGE_TYPE_LABELS: Readonly<Record<SalesStageType, string>> = {
  ACTIVE: 'Active pipeline',
  CONVERTED: 'Converted / client',
  TRANSACTION_SYNCED: 'Transaction-synced',
  CLOSED: 'Closed / success',
  LOST: 'Lost / exit',
};

export const SALES_LEAD_SOURCE_LABELS: Readonly<Record<SalesLeadSource, string>> = {
  WEBSITE: 'Website',
  REFERRAL: 'Referral',
  SOCIAL_MEDIA: 'Social Media',
  PAID_ADVERTISING: 'Paid Advertising',
  ORGANIC_SEARCH: 'Organic Search',
  EVENT: 'Event',
  PARTNER: 'Partner',
  MANUAL_ENTRY: 'Manual Entry',
  OTHER: 'Other',
};

export const SALES_LOST_REASON_LABELS: Readonly<Record<SalesLostReason, string>> = {
  NOT_A_FIT: 'Not a Fit',
  BUDGET: 'Budget',
  NO_RESPONSE: 'No Response',
  CHOSE_COMPETITOR: 'Chose Competitor',
  TIMING: 'Timing',
  DUPLICATE: 'Duplicate',
  INVALID_LEAD: 'Invalid Lead',
  OTHER: 'Other',
};
/** Lost as these leaves the conversion rate's denominator (B5). */
export const SALES_NOT_COUNTED_LOST_REASONS: readonly SalesLostReason[] = [
  'DUPLICATE',
  'INVALID_LEAD',
];

export const SALES_TRANSACTION_STATUS_LABELS: Readonly<Record<SalesTransactionStatus, string>> = {
  OPEN: 'Open',
  UNDER_CONTRACT: 'Under Contract',
  CLOSED: 'Closed',
  TERMINATED: 'Terminated',
};

export const SALES_FOLLOW_UP_KIND_LABELS: Readonly<Record<SalesFollowUpKind, string>> = {
  FOLLOW_UP: 'Follow-up',
  CALL: 'Call',
  DEMO: 'Demo',
  CONSULTATION: 'Consultation',
  MEETING: 'Meeting',
};
/** The appointment kinds (Upcoming Appointments, Appointment Set); FOLLOW_UP is a task. */
export const SALES_APPOINTMENT_KINDS: readonly SalesFollowUpKind[] = [
  'CALL',
  'DEMO',
  'CONSULTATION',
  'MEETING',
];

export const SALES_FOLLOW_UP_STATUS_LABELS: Readonly<Record<SalesFollowUpStatus, string>> = {
  SCHEDULED: 'Scheduled',
  COMPLETED: 'Completed',
  CANCELLED: 'Cancelled',
};

export const SALES_ACTIVITY_KIND_LABELS: Readonly<Record<SalesActivityKind, string>> = {
  CALL: 'Call',
  EMAIL: 'Email',
  SMS: 'Text message',
  MEETING: 'Meeting',
  OTHER: 'Other',
};

export const SALES_ACTIVITY_DIRECTION_LABELS: Readonly<Record<SalesActivityDirection, string>> = {
  OUTBOUND: 'Outbound',
  INBOUND: 'Inbound',
};

export const SALES_ACTIVITY_OUTCOME_LABELS: Readonly<Record<SalesActivityOutcome, string>> = {
  CONNECTED: 'Connected',
  NO_ANSWER: 'No answer',
  LEFT_MESSAGE: 'Left a message',
  REPLIED: 'Replied',
  NO_REPLY: 'No reply',
  BOUNCED: 'Bounced',
  COMPLETED: 'Completed',
};
/** An outbound activity with one of these reached the contact (two-way), as an inbound one does. */
export const SALES_TWO_WAY_OUTCOMES: readonly SalesActivityOutcome[] = ['CONNECTED', 'REPLIED'];

export const SALES_CHANGE_SOURCE_LABELS: Readonly<Record<SalesChangeSource, string>> = {
  MANUAL: 'Team member',
  AUTOMATION: 'Pipeline automation',
  TRANSACTION: 'Transactions sync',
  IMPORT: 'Lead import',
};

/**
 * What a record must carry to enter a stage (`required_fields`: value, assignee, plan,
 * transaction, lost_note). A LOST stage always needs a lost reason, whatever it lists.
 */
export const SalesStageRequirement = z.enum([
  'VALUE',
  'ASSIGNEE',
  'PLAN',
  'TRANSACTION',
  'LOST_NOTE',
]);
export type SalesStageRequirement = z.infer<typeof SalesStageRequirement>;
export const SALES_STAGE_REQUIREMENT_LABELS: Readonly<Record<SalesStageRequirement, string>> = {
  VALUE: 'Estimated value',
  ASSIGNEE: 'Owner',
  PLAN: 'Plan',
  TRANSACTION: 'Linked transaction',
  LOST_NOTE: 'Lost note',
};
/** The database's key for each requirement. */
export const SALES_STAGE_REQUIREMENT_KEYS: Readonly<Record<SalesStageRequirement, string>> = {
  VALUE: 'value',
  ASSIGNEE: 'assignee',
  PLAN: 'plan',
  TRANSACTION: 'transaction',
  LOST_NOTE: 'lost_note',
};

/** What the API does when a record enters a stage (`on_enter_actions`). */
export const SalesStageAction = z.enum([
  'NOTIFY_OWNER',
  'CREATE_FOLLOW_UP',
  'SEND_WELCOME_EMAIL',
  'START_ONBOARDING',
]);
export type SalesStageAction = z.infer<typeof SalesStageAction>;
export const SALES_STAGE_ACTION_LABELS: Readonly<Record<SalesStageAction, string>> = {
  NOTIFY_OWNER: 'Notify the owner',
  CREATE_FOLLOW_UP: 'Create a follow-up task',
  SEND_WELCOME_EMAIL: 'Send the welcome email',
  START_ONBOARDING: 'Start firm onboarding',
};
/** The database's key for each action. */
export const SALES_STAGE_ACTION_KEYS: Readonly<Record<SalesStageAction, string>> = {
  NOTIFY_OWNER: 'notify_owner',
  CREATE_FOLLOW_UP: 'create_follow_up',
  SEND_WELCOME_EMAIL: 'send_welcome_email',
  START_ONBOARDING: 'start_onboarding',
};
/**
 * The actions the API runs today: CREATE_FOLLOW_UP adds a FOLLOW_UP for the owner, due in two
 * days. Saving a stage with another action is 422 NOT_SUPPORTED_YET.
 */
export const SALES_STAGE_ACTIONS_AVAILABLE: readonly SalesStageAction[] = ['CREATE_FOLLOW_UP'];

/** The board colours, as named design tokens (no hex in the UI). */
export const SALES_STAGE_TONES = [
  'blue',
  'grey',
  'sky',
  'purple',
  'amber',
  'lavender',
  'green',
  'teal',
  'mint',
  'red',
] as const;
export const SalesStageTone = z.enum(SALES_STAGE_TONES);
export type SalesStageTone = z.infer<typeof SalesStageTone>;

/** The pipeline Firmivra ships (`sales_pipelines.system_key`): the default one. */
export const SALES_DEFAULT_PIPELINE_KEY = 'firmivra_default';
/** The shipped stage that booking an appointment moves an earlier record to. */
export const SALES_APPOINTMENT_SET_KEY = 'appointment_set';

const SHIPPED_STAGE_TONES: Readonly<Record<string, SalesStageTone>> = {
  new_lead: 'blue',
  attempted_contact: 'grey',
  contacted: 'sky',
  qualified: 'purple',
  appointment_set: 'amber',
  nurturing: 'lavender',
  active_client: 'green',
  under_contract: 'teal',
  closed_past_client: 'mint',
  unqualified_lost: 'red',
};
const TYPE_TONES: Readonly<Record<SalesStageType, SalesStageTone>> = {
  ACTIVE: 'blue',
  CONVERTED: 'green',
  TRANSACTION_SYNCED: 'teal',
  CLOSED: 'mint',
  LOST: 'red',
};

/**
 * A stage's colour. Stages have no colour column yet: a shipped stage has its own, any other
 * stage takes its type's. The API and the screens use this one function.
 */
export function salesStageTone(stage: {
  systemKey: string | null;
  type: SalesStageType;
}): SalesStageTone {
  return (
    (stage.systemKey ? SHIPPED_STAGE_TONES[stage.systemKey] : undefined) ?? TYPE_TONES[stage.type]
  );
}

/**
 * The attention badges (B5, thresholds from the attention settings), in order of importance: a
 * card shows the first one it has. Only open records (ACTIVE, CONVERTED and TRANSACTION_SYNCED
 * stages) get badges.
 * - NO_CONTACT: in the pipeline's New Lead stage (the shipped `new_lead`; in another pipeline,
 *   its first stage) with no outbound activity `noContactHours` after it was created.
 * - OVERDUE: a scheduled follow-up past due.
 * - NO_RESPONSE: `noResponseAttempts` outbound activities with no two-way contact since.
 * - UNASSIGNED: no owner, while `ownerRequired`.
 * - NO_ACTIVITY: no activity, stage change or owner change for `noActivityDays`.
 * - FOLLOW_UP_DUE: a scheduled follow-up due within `followUpDueHours`.
 */
export const SalesAttentionFlag = z.enum([
  'NO_CONTACT',
  'OVERDUE',
  'NO_RESPONSE',
  'UNASSIGNED',
  'NO_ACTIVITY',
  'FOLLOW_UP_DUE',
]);
export type SalesAttentionFlag = z.infer<typeof SalesAttentionFlag>;
export const SALES_ATTENTION_LABELS: Readonly<Record<SalesAttentionFlag, string>> = {
  NO_CONTACT: 'No contact yet',
  OVERDUE: 'Overdue',
  NO_RESPONSE: 'No response',
  UNASSIGNED: 'Unassigned',
  NO_ACTIVITY: 'No activity',
  FOLLOW_UP_DUE: 'Follow-up due',
};

/**
 * The record sets the KPI cards open (B5's definitions):
 * - OPEN: ACTIVE, CONVERTED and TRANSACTION_SYNCED stages (counted in pipeline value)
 * - IN_PROGRESS: ACTIVE stages
 * - ACTIVE_CLIENTS: CONVERTED and TRANSACTION_SYNCED stages
 * - CONVERTED: records with a conversion time (the conversion rate's numerator)
 */
export const SalesOpportunitySet = z.enum(['OPEN', 'IN_PROGRESS', 'ACTIVE_CLIENTS', 'CONVERTED']);
export type SalesOpportunitySet = z.infer<typeof SalesOpportunitySet>;
export const SALES_OPPORTUNITY_SET_LABELS: Readonly<Record<SalesOpportunitySet, string>> = {
  OPEN: 'Active pipeline (counted in value)',
  IN_PROGRESS: 'In progress',
  ACTIVE_CLIENTS: 'Active clients',
  CONVERTED: 'Converted',
};

/** The list's sort keys; the default is the stage order, then the latest activity first. */
export const SalesOpportunitySort = z.enum([
  'FIRM',
  'CONTACT',
  'STAGE',
  'OWNER',
  'SOURCE',
  'PLAN',
  'VALUE',
  'LAST_ACTIVITY',
  'NEXT_FOLLOW_UP',
  'ATTENTION',
  'CREATED',
]);
export type SalesOpportunitySort = z.infer<typeof SalesOpportunitySort>;

/**
 * A reporting period. LAST_*_DAYS end today; THIS_* are the whole calendar month, quarter or
 * year (later days count what is already scheduled). Each compares with the period just before:
 * the same number of days, or the previous calendar month, quarter or year.
 */
export const SalesPeriod = z.enum([
  'LAST_7_DAYS',
  'LAST_30_DAYS',
  'LAST_90_DAYS',
  'THIS_MONTH',
  'THIS_QUARTER',
  'THIS_YEAR',
]);
export type SalesPeriod = z.infer<typeof SalesPeriod>;
export const SALES_PERIOD_LABELS: Readonly<Record<SalesPeriod, string>> = {
  LAST_7_DAYS: 'Last 7 Days',
  LAST_30_DAYS: 'Last 30 Days',
  LAST_90_DAYS: 'Last 90 Days',
  THIS_MONTH: 'This Month',
  THIS_QUARTER: 'This Quarter',
  THIS_YEAR: 'This Year',
};

/** Which records a team member reaches (`platform_members.scope_type`); a Super Admin: COMPANY. */
export const SalesRecordScope = z.enum(['OWN', 'TEAM', 'COMPANY']);
export type SalesRecordScope = z.infer<typeof SalesRecordScope>;

export const SALES_TARGET_SCOPE_LABELS: Readonly<Record<SalesTargetScope, string>> = {
  COMPANY: 'Company',
  TEAM: 'Team',
  REP: 'Sales rep',
};
export const SALES_TARGET_METRIC_LABELS: Readonly<Record<SalesTargetMetric, string>> = {
  NEW_LEADS: 'New leads',
  DEMOS_SCHEDULED: 'Demos scheduled',
  TRIALS_STARTED: 'Trials started',
  WON_DEALS: 'Won deals',
  REVENUE_WON: 'Revenue won',
  CONVERSION_RATE: 'Conversion rate',
  OUTBOUND_ACTIVITIES: 'Outbound activities',
};
export const SALES_TARGET_PERIOD_LABELS: Readonly<Record<SalesTargetPeriod, string>> = {
  MONTH: 'Month',
  QUARTER: 'Quarter',
  YEAR: 'Year',
  CUSTOM: 'Custom range',
};

// ---------- Plans, team and settings ----------

export const SalesPlanFeature = z.object({ key: z.string(), label: z.string() });
export type SalesPlanFeature = z.infer<typeof SalesPlanFeature>;

/** A firm plan (`platform_plans`), the price ladder the Sales Center presents. */
export const SalesPlan = z.object({
  id: Id,
  /** SOLO_CORE, TEAM_PRO, …: the same in every environment (the screens' plan colours). */
  code: z.string(),
  name: z.string(),
  /** The base price per billing cycle. */
  priceCents: z.number().int(),
  billingCycle: PlatformBillingCycle,
  includedSeats: z.number().int(),
  /** null: no fixed ceiling. */
  maxSeats: z.number().int().nullable(),
  /** Each seat above the included ones; null: the plan sells no extra seats. */
  seatPriceCents: z.number().int().nullable(),
  includedLocations: z.number().int(),
  /** Each location above the included ones; null: the plan sells none. */
  locationPriceCents: z.number().int().nullable(),
  displayOrder: z.number().int(),
  active: z.boolean(),
  /** Every feature included at this tier. */
  features: z.array(SalesPlanFeature),
});
export type SalesPlan = z.infer<typeof SalesPlan>;
export const SalesPlanList = z.object({ items: z.array(SalesPlan) });
export type SalesPlanList = z.infer<typeof SalesPlanList>;

/** Extra seats a plan sells: 0 when it sells none, null when it has no ceiling. */
export function salesPlanMaxExtraSeats(
  plan: Pick<SalesPlan, 'includedSeats' | 'maxSeats' | 'seatPriceCents'>,
): number | null {
  if (plan.seatPriceCents === null) return 0;
  return plan.maxSeats === null ? null : Math.max(0, plan.maxSeats - plan.includedSeats);
}

/**
 * A plan's price per billing cycle with extra seats and locations (the forms' price preview):
 * the base price plus the add-ons. Seats or locations the plan does not sell add nothing.
 */
export function salesPlanPriceCents(
  plan: Pick<SalesPlan, 'priceCents' | 'seatPriceCents' | 'locationPriceCents'>,
  extraSeats = 0,
  extraLocations = 0,
): number {
  return (
    plan.priceCents +
    Math.max(0, extraSeats) * (plan.seatPriceCents ?? 0) +
    Math.max(0, extraLocations) * (plan.locationPriceCents ?? 0)
  );
}

/** A team member who can own records and follow-ups. */
export const SalesRep = z.object({
  /** The member's user id. */
  id: Id,
  name: z.string(),
  /** The role title, e.g. "Sales Manager" ("Super Admin" for an admin with no org-chart row). */
  role: z.string(),
  /** A removed or deactivated member keeps their name on records but takes no new ones. */
  active: z.boolean(),
});
export type SalesRep = z.infer<typeof SalesRep>;

const Person = z.object({ id: Id, name: z.string() });

/** A sales team: a platform department (D1). */
export const SalesTeam = Person;
export type SalesTeam = z.infer<typeof SalesTeam>;

export const SalesTag = z.object({
  id: Id,
  name: z.string(),
  /** A design-token colour name from packages/ui (e.g. accent-blue); null for none. */
  colorKey: z.string().nullable(),
});
export type SalesTag = z.infer<typeof SalesTag>;

/** The attention thresholds and the lost-note rule (`sales_attention_settings`). */
export const SaveSalesAttentionSettingsRequest = z.strictObject({
  noContactHours: z
    .number()
    .int('Enter whole hours')
    .min(1, 'Use 1 to 720 hours')
    .max(720, 'Use 1 to 720 hours'),
  followUpDueHours: z
    .number()
    .int('Enter whole hours')
    .min(1, 'Use 1 to 168 hours')
    .max(168, 'Use 1 to 168 hours'),
  noResponseAttempts: z
    .number()
    .int('Enter a whole number')
    .min(1, 'Use 1 to 20 attempts')
    .max(20, 'Use 1 to 20 attempts'),
  noActivityDays: z
    .number()
    .int('Enter whole days')
    .min(1, 'Use 1 to 365 days')
    .max(365, 'Use 1 to 365 days'),
  /** Unassigned open records show "Unassigned". */
  ownerRequired: z.boolean(),
  /** A lost reason of OTHER needs a note (422 LOST_NOTE_REQUIRED). */
  lostOtherNoteRequired: z.boolean(),
});
export type SaveSalesAttentionSettingsRequest = z.input<typeof SaveSalesAttentionSettingsRequest>;

export const SalesAttentionSettings = z.object({
  noContactHours: z.number().int(),
  followUpDueHours: z.number().int(),
  noResponseAttempts: z.number().int(),
  noActivityDays: z.number().int(),
  ownerRequired: z.boolean(),
  lostOtherNoteRequired: z.boolean(),
  updatedAt: DateTime,
  /** The team member who last changed them; null before any change. */
  updatedBy: z.string().nullable(),
});
export type SalesAttentionSettings = z.infer<typeof SalesAttentionSettings>;

/** What Sales lets the signed-in member do (the `sales.*` permission keys). */
export const SalesPermissions = z.object({
  /** The pipeline builder. */
  managePipelines: z.boolean(),
  /** Change a record's owner. */
  assign: z.boolean(),
  /** The list's bulk actions. */
  bulkEdit: z.boolean(),
  /** Export Sales Report. */
  export: z.boolean(),
  /** Create, change and archive targets. */
  manageTargets: z.boolean(),
  /** Tags and the attention settings. */
  manageSettings: z.boolean(),
});
export type SalesPermissions = z.infer<typeof SalesPermissions>;

/** The pickers and the member's rights, for every Sales screen. */
export const SalesMeta = z.object({
  me: Person,
  permissions: SalesPermissions,
  recordScope: SalesRecordScope,
  /** Everyone who can own records, active first. */
  reps: z.array(SalesRep),
  /** Active platform departments (team targets). */
  teams: z.array(SalesTeam),
  tags: z.array(SalesTag),
  /** In display order. */
  plans: z.array(z.object({ id: Id, code: z.string(), name: z.string(), active: z.boolean() })),
  pipelines: z.array(
    z.object({ id: Id, name: z.string(), isDefault: z.boolean(), active: z.boolean() }),
  ),
  defaultPipelineId: Id,
  /** Today as a UTC day, for the default date range. */
  today: Day,
  attention: SalesAttentionSettings,
});
export type SalesMeta = z.infer<typeof SalesMeta>;

// ---------- Pipelines ----------

export const SalesStage = z.object({
  id: Id,
  name: z.string(),
  /**
   * Set on the ten stages Firmivra ships (`new_lead` … `unqualified_lost`): they keep their key
   * and type, and are switched off, never removed.
   */
  systemKey: z.string().nullable(),
  type: SalesStageType,
  /** `salesStageTone(stage)`. */
  tone: SalesStageTone,
  /** Board order: 0 is the first column. */
  position: z.number().int(),
  /** An inactive stage takes no new records; the records already in it stay. */
  active: z.boolean(),
  requires: z.array(SalesStageRequirement),
  onEnter: z.array(SalesStageAction),
  /** Records in the stage now. */
  records: z.number().int(),
});
export type SalesStage = z.infer<typeof SalesStage>;

export const SalesPipeline = z.object({
  id: Id,
  name: z.string(),
  /** '' when none. */
  description: z.string(),
  systemKey: z.string().nullable(),
  /** The shipped pipeline (`firmivra_default`) opens first. */
  isDefault: z.boolean(),
  active: z.boolean(),
  /**
   * Where a terminated transaction returns a record: an ACTIVE or CONVERTED stage of this
   * pipeline; null: its first active CONVERTED stage.
   */
  terminatedReturnStageId: Id.nullable(),
  /** In board order. */
  stages: z.array(SalesStage),
  createdAt: DateTime,
  /** The latest change to the pipeline or any of its stages: send it back with a save. */
  updatedAt: DateTime,
});
export type SalesPipeline = z.infer<typeof SalesPipeline>;
export const SalesPipelineList = z.object({ items: z.array(SalesPipeline) });
export type SalesPipelineList = z.infer<typeof SalesPipelineList>;

/** Create Pipeline. */
export const CreateSalesPipelineRequest = z.strictObject({
  name: platformText(100, 'one', 'Enter a pipeline name.'),
  description: optionalText(1000, 'many').default(''),
  /**
   * DEFAULT: the ten Firmivra stages (names, types and required fields; without the shipped
   * keys, which only the migration sets). BASIC: New (ACTIVE), Won (CONVERTED), Lost (LOST).
   */
  template: z.enum(['DEFAULT', 'BASIC']).default('DEFAULT'),
});
export type CreateSalesPipelineRequest = z.input<typeof CreateSalesPipelineRequest>;

/** A stage as the builder saves it. */
export const SalesStageDraft = z.strictObject({
  /** Left out for a new stage. Ids never change, so a rename or reorder keeps the history. */
  id: Id.optional(),
  name: platformText(60, 'one', 'Enter the stage name.'),
  /** A shipped stage or one with records keeps its type (422 SHIPPED_STAGE, STAGE_HAS_RECORDS). */
  type: SalesStageType,
  active: z.boolean(),
  requires: z
    .array(SalesStageRequirement)
    .max(5)
    .refine((list) => new Set(list).size === list.length, 'List each requirement once.')
    .default([]),
  onEnter: z
    .array(SalesStageAction)
    .max(4)
    .refine((list) => new Set(list).size === list.length, 'List each action once.')
    .default([]),
});
export type SalesStageDraft = z.input<typeof SalesStageDraft>;

/**
 * Save Pipeline: the name, the description and every stage in board order, in one step. A
 * stage left out is removed: a shipped one cannot be (422 SHIPPED_STAGE), and one that holds
 * records needs `removed` to say where they go first (422 STAGE_HAS_RECORDS otherwise). Moving
 * them follows a move's rules (required fields, lost reasons, transactions). 409 CONFLICT when
 * the pipeline changed since `expectedUpdatedAt`.
 */
export const SaveSalesPipelineRequest = z
  .strictObject({
    expectedUpdatedAt: DateTime,
    name: platformText(100, 'one', 'Enter a pipeline name.'),
    description: optionalText(1000, 'many').default(''),
    stages: z
      .array(SalesStageDraft)
      .min(2, 'A pipeline needs at least two stages.')
      .max(30, 'Use at most 30 stages.')
      .refine(
        (stages) => stages.some((stage) => stage.active),
        'Keep at least one stage switched on.',
      )
      .refine(
        (stages) => new Set(stages.map((stage) => stage.name.toLowerCase())).size === stages.length,
        'Two stages have the same name.',
      )
      .refine((stages) => {
        const ids = stages.flatMap((stage) => (stage.id ? [stage.id] : []));
        return new Set(ids).size === ids.length;
      }, 'A stage is listed twice.'),
    /** Removed stages and the kept stage their records move to (null: it holds none). */
    removed: z
      .array(z.strictObject({ id: Id, moveTo: Id.nullable() }))
      .max(30)
      .default([]),
    /**
     * Left out: unchanged. An ACTIVE or CONVERTED stage of this pipeline (422
     * RETURN_STAGE_INVALID); null: its first active CONVERTED stage.
     */
    terminatedReturnStageId: Id.nullable().optional(),
  })
  .refine(
    (body) =>
      body.removed.every((removal) => !body.stages.some((stage) => stage.id === removal.id)),
    { message: 'A removed stage is still in the list.', path: ['removed'] },
  )
  .refine(
    (body) =>
      body.removed.every(
        (removal) =>
          removal.moveTo === null || body.stages.some((stage) => stage.id === removal.moveTo),
      ),
    { message: 'Choose where the records of each removed stage go.', path: ['removed'] },
  );
export type SaveSalesPipelineRequest = z.input<typeof SaveSalesPipelineRequest>;

// ---------- Opportunities ----------

export const SalesPlanSummary = z.object({
  id: Id,
  code: z.string(),
  name: z.string(),
  /** The plan's base price per billing cycle. */
  priceCents: z.number().int(),
  billingCycle: PlatformBillingCycle,
});
export type SalesPlanSummary = z.infer<typeof SalesPlanSummary>;

/** The linked transaction (B5's sync: no double entry). */
export const SalesTransaction = z.object({
  /** PLATFORM_SUBSCRIPTION: the firm's platform subscription (`platform_subscription`). */
  kind: z.enum(['PLATFORM_SUBSCRIPTION']),
  id: Id,
  /** Reported by Billing: Under Contract and Closed move the record by themselves. */
  status: SalesTransactionStatus,
  /** When the status last changed (the "Synced to Transactions" badge). */
  syncedAt: DateTime.nullable(),
  /** The subscription as Billing has it; null when it is no longer there. */
  subscription: z
    .object({
      firm: Person,
      plan: z.object({ id: Id, name: z.string() }),
      status: PlatformSubscriptionStatus,
    })
    .nullable(),
});
export type SalesTransaction = z.infer<typeof SalesTransaction>;

/** A trial on the linked platform subscription. */
export const SalesTrial = z.object({
  startedAt: DateTime,
  endsAt: DateTime.nullable(),
  /** The subscription is in TRIAL and the trial has not ended. */
  active: z.boolean(),
});
export type SalesTrial = z.infer<typeof SalesTrial>;

const NextFollowUp = z.object({
  id: Id,
  kind: SalesFollowUpKind,
  title: z.string(),
  dueAt: DateTime,
});

/** A card of the board and a row of the list. */
export const SalesOpportunity = z.object({
  id: Id,
  pipelineId: Id,
  stageId: Id,
  stageName: z.string(),
  stageType: SalesStageType,
  stageTone: SalesStageTone,
  /** 0-based place of the stage in its pipeline's order. */
  stageOrder: z.number().int(),
  /** The firm or company: the card's title. */
  firmName: z.string(),
  /** The master person record, shared by every opportunity of that person. */
  contactId: Id,
  contactName: z.string(),
  email: z.string().nullable(),
  /** E.164. */
  phone: z.string().nullable(),
  /** Estimated annual value; null when none was given (never invented). */
  valueCents: z.number().int().nullable(),
  /** The plan the prospect is interested in. */
  plan: SalesPlanSummary.nullable(),
  source: SalesLeadSource,
  owner: SalesRep.nullable(),
  tags: z.array(SalesTag),
  createdAt: DateTime,
  stageEnteredAt: DateTime,
  updatedAt: DateTime,
  /** The latest activity, stage change or owner change (creation when there is none). */
  lastActivityAt: DateTime,
  /** Outbound activities since the last two-way contact (all of them when never reached). */
  attempts: z.number().int(),
  /** The first two-way contact: an inbound activity, or an outbound one CONNECTED or REPLIED. */
  contactedAt: DateTime.nullable(),
  /** The earliest scheduled follow-up of any kind; it may be past due. */
  nextFollowUp: NextFollowUp.nullable(),
  /** The earliest scheduled appointment (SALES_APPOINTMENT_KINDS) from now on. */
  nextAppointment: NextFollowUp.nullable(),
  /** The first entry into a CONVERTED, TRANSACTION_SYNCED or CLOSED stage; kept afterwards. */
  convertedAt: DateTime.nullable(),
  /** When it entered its CLOSED stage; null in any other stage. */
  closedAt: DateTime.nullable(),
  /** Set while the record is in a LOST stage, and only then (the history keeps earlier ones). */
  lostAt: DateTime.nullable(),
  lostReason: SalesLostReason.nullable(),
  lostNote: z.string().nullable(),
  transaction: SalesTransaction.nullable(),
  trial: SalesTrial.nullable(),
  /** The firm, once provisioned (`linked_business_id`). */
  firm: Person.nullable(),
  /** The firm's application (`firm_application_id`). */
  firmApplication: z.object({ id: Id, status: FirmApplicationStatus }).nullable(),
  attention: z.array(SalesAttentionFlag),
});
export type SalesOpportunity = z.infer<typeof SalesOpportunity>;

/** The list and board filters, shared by `opportunities` and `pipelineKpis`. */
const OpportunityFilters = {
  /** The default pipeline when left out. */
  pipelineId: Id.optional(),
  /** Firm, title, contact name, email or phone (three digits or more). */
  search: SearchText.optional(),
  stageIds: listOf(Id),
  ownerId: Id.optional(),
  /** Records with no owner. */
  unassigned: Flag,
  planId: Id.optional(),
  source: SalesLeadSource.optional(),
  tagId: Id.optional(),
  /**
   * Records open at any time in the range: created on or before `to`, and (in a CLOSED or LOST
   * stage) entered it on or after `from`.
   */
  from: Day.optional(),
  to: Day.optional(),
  /** The Overdue badge: a scheduled follow-up past due. */
  overdue: Flag,
  /** Needs Attention: any attention badge. */
  attention: Flag,
  set: SalesOpportunitySet.optional(),
};
const rangeInOrder = (query: { from?: string | undefined; to?: string | undefined }) =>
  !query.from || !query.to || query.from <= query.to;
const RANGE_ORDER = { message: 'The range ends before it starts.', path: ['to'] };

export const SalesOpportunitiesQuery = z
  .strictObject({
    ...OpportunityFilters,
    sort: SalesOpportunitySort.optional(),
    dir: z.enum(['asc', 'desc']).optional(),
    page: z.coerce.number().int().min(1).optional(),
    /** 100 by default; the board asks for up to 500. */
    pageSize: z.coerce.number().int().min(1).max(500).optional(),
  })
  .refine(rangeInOrder, RANGE_ORDER);
export type SalesOpportunitiesQuery = z.input<typeof SalesOpportunitiesQuery>;

export const SalesOpportunityPage = z.object({
  items: z.array(SalesOpportunity),
  total: z.number().int(),
  page: z.number().int(),
  pageSize: z.number().int(),
});
export type SalesOpportunityPage = z.infer<typeof SalesOpportunityPage>;

export const SalesSummaryQuery = z
  .strictObject({ ...OpportunityFilters })
  .refine(rangeInOrder, RANGE_ORDER);
export type SalesSummaryQuery = z.input<typeof SalesSummaryQuery>;

/** Percent change against the period before; null when there is nothing to compare with. */
const Trend = z.number().int().nullable();

/** B5's conversion rate: converted ÷ (created minus those lost as DUPLICATE or INVALID_LEAD). */
export const SalesConversion = z.object({
  /** Basis points (10,000 = 100%); 0 when nothing counts. */
  rateBp: z.number().int(),
  /** Created in the period, with a conversion time. */
  converted: z.number().int(),
  /** Created in the period, minus those lost as DUPLICATE or INVALID_LEAD. */
  eligible: z.number().int(),
});
export type SalesConversion = z.infer<typeof SalesConversion>;

/**
 * The pipeline page's KPI row (B5's definitions), over the records the filters select. The
 * conversion counts records created in the range (all of them without one). The trends compare
 * the records created in the last 30 days with the 30 days before.
 */
export const SalesPipelineSummary = z.object({
  pipelineId: Id,
  totalOpportunities: z.number().int(),
  /** ACTIVE stages. */
  inProgress: z.number().int(),
  /** `value_cents` over ACTIVE, CONVERTED and TRANSACTION_SYNCED stages (null adds nothing). */
  pipelineValueCents: z.number().int(),
  /** `value_cents` over CLOSED stages. */
  closedRevenueCents: z.number().int(),
  conversion: SalesConversion,
  /** CONVERTED and TRANSACTION_SYNCED stages. */
  activeClients: z.number().int(),
  /** Records with any attention badge. */
  needsAttention: z.number().int(),
  /** Records with each badge. */
  attention: z.object({
    NO_CONTACT: z.number().int(),
    OVERDUE: z.number().int(),
    NO_RESPONSE: z.number().int(),
    UNASSIGNED: z.number().int(),
    NO_ACTIVITY: z.number().int(),
    FOLLOW_UP_DUE: z.number().int(),
  }),
  trends: z.object({
    totalOpportunities: Trend,
    inProgress: Trend,
    pipelineValueCents: Trend,
    conversion: Trend,
  }),
});
export type SalesPipelineSummary = z.infer<typeof SalesPipelineSummary>;

// ---------- The record ----------

export const SalesNote = z.object({
  id: Id,
  body: z.string(),
  author: Person,
  createdAt: DateTime,
  updatedAt: DateTime,
  /** The signed-in member wrote it: only they may change or delete it (403 NOT_AUTHOR). */
  mine: z.boolean(),
});
export type SalesNote = z.infer<typeof SalesNote>;

/** A follow-up or an appointment (`sales_follow_ups`). */
export const SalesFollowUp = z.object({
  id: Id,
  opportunityId: Id,
  firmName: z.string(),
  contactName: z.string(),
  kind: SalesFollowUpKind,
  title: z.string(),
  /** When it is due; an appointment's start. */
  dueAt: DateTime,
  /** An appointment's end. */
  endsAt: DateTime.nullable(),
  location: z.string().nullable(),
  /** SCHEDULED, then COMPLETED or CANCELLED once (final). */
  status: SalesFollowUpStatus,
  assignee: Person.nullable(),
  completedAt: DateTime.nullable(),
  cancelledAt: DateTime.nullable(),
  createdAt: DateTime,
  /** Scheduled and past due. */
  overdue: z.boolean(),
});
export type SalesFollowUp = z.infer<typeof SalesFollowUp>;
export const SalesFollowUpList = z.object({ items: z.array(SalesFollowUp) });
export type SalesFollowUpList = z.infer<typeof SalesFollowUpList>;

/** A call, email, text or meeting (`sales_activities`): insert-only. */
export const SalesCommunication = z.object({
  id: Id,
  kind: SalesActivityKind,
  direction: SalesActivityDirection,
  outcome: SalesActivityOutcome.nullable(),
  occurredAt: DateTime,
  summary: z.string().nullable(),
  /** The team member who logged it, or "System" for an import. */
  by: z.string(),
  /** The follow-up it carried out. */
  followUpId: Id.nullable(),
});
export type SalesCommunication = z.infer<typeof SalesCommunication>;

/**
 * A line of Recent Activity and the record's history, read from the stage and owner history
 * (the database writes them), the activities, the follow-ups, the notes and the linked
 * subscription's trial. One entry per event:
 * - CREATED: the first stage row; WON: the stage change that converted the record (its first
 *   entry into a CONVERTED, TRANSACTION_SYNCED or CLOSED stage); LOST: entering a LOST stage;
 *   UNDER_CONTRACT, CLOSED, TERMINATED: a move by the transaction sync; STAGE_CHANGED: any other
 *   move. The first that applies wins.
 * - ASSIGNED, REASSIGNED, UNASSIGNED: owner changes.
 * - FOLLOW_UP_SCHEDULED, _COMPLETED, _CANCELLED: a follow-up's creation and its end.
 * - COMMUNICATION: an activity. NOTE_ADDED: a note. TRIAL_STARTED: the linked subscription's trial.
 */
export const SalesFeedKind = z.enum([
  'CREATED',
  'STAGE_CHANGED',
  'WON',
  'LOST',
  'UNDER_CONTRACT',
  'CLOSED',
  'TERMINATED',
  'ASSIGNED',
  'REASSIGNED',
  'UNASSIGNED',
  'FOLLOW_UP_SCHEDULED',
  'FOLLOW_UP_COMPLETED',
  'FOLLOW_UP_CANCELLED',
  'COMMUNICATION',
  'NOTE_ADDED',
  'TRIAL_STARTED',
]);
export type SalesFeedKind = z.infer<typeof SalesFeedKind>;
/** The Sales Center's Recent Sales Activity. */
export const SALES_CENTER_FEED_KINDS: readonly SalesFeedKind[] = [
  'CREATED',
  'FOLLOW_UP_SCHEDULED',
  'TRIAL_STARTED',
  'WON',
  'LOST',
];

export const SalesFeedEntry = z.object({
  /** The source row's id: with `kind`, unique in a feed (a follow-up gives up to two entries). */
  id: Id,
  kind: SalesFeedKind,
  at: DateTime,
  opportunityId: Id,
  firmName: z.string(),
  /** A team member, or the platform (a transaction sync, an automation or an import). */
  actor: z.object({ kind: z.enum(['USER', 'SYSTEM']), name: z.string() }),
  /** Stage and owner changes; null for the other kinds. */
  source: SalesChangeSource.nullable(),
  /** Stage changes: the stage names at the time (a later rename never rewrites them). */
  fromStage: z.string().nullable(),
  toStage: z.string().nullable(),
  lostReason: SalesLostReason.nullable(),
  lostNote: z.string().nullable(),
  transactionStatus: SalesTransactionStatus.nullable(),
  /** Owner changes: the names (null: unassigned). */
  fromOwner: z.string().nullable(),
  toOwner: z.string().nullable(),
  followUp: z.object({ kind: SalesFollowUpKind, title: z.string(), dueAt: DateTime }).nullable(),
  communication: z
    .object({
      kind: SalesActivityKind,
      direction: SalesActivityDirection,
      outcome: SalesActivityOutcome.nullable(),
      summary: z.string().nullable(),
    })
    .nullable(),
  /** The record's estimated value now (not at the time); null when none. */
  valueCents: z.number().int().nullable(),
});
export type SalesFeedEntry = z.infer<typeof SalesFeedEntry>;
export const SalesFeedList = z.object({ items: z.array(SalesFeedEntry) });
export type SalesFeedList = z.infer<typeof SalesFeedList>;

/** The line a feed entry reads as. */
export function salesFeedText(entry: SalesFeedEntry): string {
  const firm = entry.firmName;
  const followUp = entry.followUp
    ? SALES_FOLLOW_UP_KIND_LABELS[entry.followUp.kind].toLowerCase()
    : 'follow-up';
  switch (entry.kind) {
    case 'CREATED':
      return entry.toStage
        ? `New lead added: ${firm} in ${entry.toStage}`
        : `New lead added: ${firm}`;
    case 'STAGE_CHANGED':
      return `Moved ${firm} to ${entry.toStage ?? 'another stage'}`;
    case 'WON':
      return `Won ${firm}`;
    case 'LOST':
      return `Marked ${firm} as ${entry.toStage ?? 'lost'}`;
    case 'UNDER_CONTRACT':
      return `${firm}'s transaction is under contract`;
    case 'CLOSED':
      return `${firm}'s transaction closed`;
    case 'TERMINATED':
      return `${firm}'s transaction was terminated`;
    case 'ASSIGNED':
      return `Assigned ${firm} to ${entry.toOwner ?? 'a team member'}`;
    case 'REASSIGNED':
      return `Reassigned ${firm} to ${entry.toOwner ?? 'a team member'}`;
    case 'UNASSIGNED':
      return `Unassigned ${firm}`;
    case 'FOLLOW_UP_SCHEDULED':
      return entry.followUp?.kind === 'FOLLOW_UP'
        ? `Added a follow-up for ${firm}`
        : `Scheduled a ${followUp} with ${firm}`;
    case 'FOLLOW_UP_COMPLETED':
      return `Completed the ${followUp} for ${firm}`;
    case 'FOLLOW_UP_CANCELLED':
      return `Cancelled the ${followUp} for ${firm}`;
    case 'COMMUNICATION': {
      const done = entry.communication;
      if (!done) return `Logged an activity for ${firm}`;
      const what = SALES_ACTIVITY_KIND_LABELS[done.kind];
      const line = done.direction === 'INBOUND' ? `${what} from ${firm}` : `${what} to ${firm}`;
      return done.outcome ? `${line} (${SALES_ACTIVITY_OUTCOME_LABELS[done.outcome]})` : line;
    }
    case 'NOTE_ADDED':
      return `Added a note to ${firm}`;
    case 'TRIAL_STARTED':
      return `Trial started for ${firm}`;
  }
}

/** The quieter second line: the lost reason, the owners, the follow-up or the summary. */
export function salesFeedDetail(entry: SalesFeedEntry): string | null {
  if (entry.kind === 'LOST' && entry.lostReason) {
    const reason = SALES_LOST_REASON_LABELS[entry.lostReason];
    return entry.lostNote ? `${reason}: ${entry.lostNote}` : reason;
  }
  if (entry.kind === 'ASSIGNED' || entry.kind === 'REASSIGNED' || entry.kind === 'UNASSIGNED')
    return `${entry.fromOwner ?? 'Unassigned'} → ${entry.toOwner ?? 'Unassigned'}`;
  if (entry.followUp) return entry.followUp.title;
  return entry.communication?.summary ?? null;
}

/** The opportunity record page. */
export const SalesOpportunityRecord = z.object({
  opportunity: SalesOpportunity,
  pipeline: z.object({ id: Id, name: z.string(), stages: z.array(SalesStage) }),
  /** Newest first. */
  notes: z.array(SalesNote),
  /** Every follow-up and appointment, soonest due first. */
  followUps: z.array(SalesFollowUp),
  /** Calls, emails, texts and meetings, newest first. */
  communications: z.array(SalesCommunication),
  /** The record's history, newest first (at most 500 entries). */
  activity: z.array(SalesFeedEntry),
});
export type SalesOpportunityRecord = z.infer<typeof SalesOpportunityRecord>;

/** A probable duplicate (B5: the normalized email and phone, and the firm name). */
export const SalesDuplicateMatch = z.object({
  opportunityId: Id,
  contactId: Id,
  firmName: z.string(),
  contactName: z.string(),
  stageName: z.string(),
  matchedOn: z.array(z.enum(['EMAIL', 'PHONE', 'FIRM_NAME'])),
});
export type SalesDuplicateMatch = z.infer<typeof SalesDuplicateMatch>;
/** At most five, the closest first. */
export const SalesDuplicateList = z.object({ items: z.array(SalesDuplicateMatch) });
export type SalesDuplicateList = z.infer<typeof SalesDuplicateList>;

/** The Add Lead form's duplicate check, before creating. */
export const SalesDuplicateCheckRequest = z
  .strictObject({
    firmName: optionalText(200).default(''),
    email: clearable(Email),
    phone: clearable(Phone),
  })
  .refine(
    (body) => Boolean(body.firmName || body.email || body.phone),
    'Enter a firm name, an email or a phone number.',
  );
export type SalesDuplicateCheckRequest = z.input<typeof SalesDuplicateCheckRequest>;

// ---------- Opportunity changes ----------

const FIRM = 'Enter the firm or company name.';
const CONTACT = 'Enter the primary contact.';

/**
 * Add Lead / Opportunity. The firm name is the record's title. The contact (name, email, phone)
 * becomes a new master person record. With `allowDuplicate` false, a probable duplicate is 409
 * POSSIBLE_DUPLICATE (ask `duplicates` for the matches). The starting stage's required fields
 * come in the same request (422 VALUE_REQUIRED, …).
 */
export const CreateSalesOpportunityRequest = z
  .strictObject({
    /** One per form opening: a double click or a retry never makes two records. */
    requestId: Id,
    /** The default pipeline when left out. */
    pipelineId: Id.optional(),
    /** The pipeline's first active stage when left out. */
    stageId: Id.optional(),
    firmName: platformText(200, 'one', FIRM),
    contactName: platformText(200, 'one', CONTACT),
    /** Left out, null or '': none. */
    email: clearable(Email),
    /** E.164 once parsed. Left out, null or '': none. */
    phone: clearable(Phone),
    source: SalesLeadSource,
    planId: Id.nullable().default(null),
    /** Estimated annual value; null when none was given. */
    valueCents: Cents.nullable().default(null),
    ownerId: Id.nullable().default(null),
    tagIds: z
      .array(Id)
      .max(20, 'Choose at most 20 tags.')
      .refine((ids) => new Set(ids).size === ids.length, 'Choose each tag once.')
      .default([]),
    /** A first note, written as the signed-in member. Left out, null or '': none. */
    note: clearable(platformText(10000, 'many')),
    /** A LOST starting stage only. */
    lostReason: SalesLostReason.optional(),
    lostNote: optionalText(2000, 'many').optional(),
    /** Create even though a probable duplicate exists. */
    allowDuplicate: z.boolean().default(false),
  })
  .refine((body) => Boolean(body.email || body.phone), {
    message: 'Enter an email or a phone number.',
    path: ['email'],
  })
  .refine((body) => !body.lostNote || body.lostReason !== undefined, {
    message: 'Choose why this record was lost.',
    path: ['lostReason'],
  });
export type CreateSalesOpportunityRequest = z.input<typeof CreateSalesOpportunityRequest>;

/**
 * The record's own data, each field left out to keep it. Contact fields change the master
 * person record, which every opportunity of that person shares.
 */
export const UpdateSalesOpportunityRequest = z
  .strictObject({
    firmName: platformText(200, 'one', FIRM).optional(),
    contactName: platformText(200, 'one', CONTACT).optional(),
    email: clearable(Email),
    phone: clearable(Phone),
    valueCents: Cents.nullable().optional(),
    planId: Id.nullable().optional(),
    source: SalesLeadSource.optional(),
    /** The full set of tags (replaces the current one). */
    tagIds: z
      .array(Id)
      .max(20, 'Choose at most 20 tags.')
      .refine((ids) => new Set(ids).size === ids.length, 'Choose each tag once.')
      .optional(),
  })
  .refine(
    (body) => Object.values(body).some((value) => value !== undefined),
    'Change something first',
  );
export type UpdateSalesOpportunityRequest = z.input<typeof UpdateSalesOpportunityRequest>;

/**
 * One record to another stage. The stage's required fields may come with the move (left out:
 * the record's own). A LOST stage needs `lostReason` (and a note for OTHER while the settings
 * ask). Under Contract and Closed follow the transaction (422 TRANSACTION_LOCKED); a move to the
 * stage it is in changes nothing.
 */
export const MoveSalesStageRequest = z
  .strictObject({
    stageId: Id,
    lostReason: SalesLostReason.optional(),
    lostNote: optionalText(2000, 'many').optional(),
    valueCents: Cents.optional(),
    ownerId: Id.optional(),
    planId: Id.optional(),
  })
  .refine((body) => !body.lostNote || body.lostReason !== undefined, {
    message: 'Choose why this record was lost.',
    path: ['lostReason'],
  });
export type MoveSalesStageRequest = z.input<typeof MoveSalesStageRequest>;

/** Assign or reassign (null: unassigned); the history keeps the previous owner. */
export const AssignSalesOpportunityRequest = z.strictObject({ ownerId: Id.nullable() });
export type AssignSalesOpportunityRequest = z.input<typeof AssignSalesOpportunityRequest>;

export const SalesBulkAction = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('ASSIGN'), ownerId: Id.nullable() }),
  z.strictObject({
    type: z.literal('STAGE'),
    stageId: Id,
    /** A LOST stage: one reason (and note) for every record. */
    lostReason: SalesLostReason.optional(),
    lostNote: optionalText(2000, 'many').optional(),
  }),
  z.strictObject({ type: z.literal('ADD_TAG'), tagId: Id }),
  z.strictObject({ type: z.literal('REMOVE_TAG'), tagId: Id }),
]);
export type SalesBulkAction = z.input<typeof SalesBulkAction>;

/**
 * The list's bulk actions, all or nothing: one refused record (a move's rules) refuses the lot
 * with that record's error. Records of one pipeline at a time for STAGE.
 */
export const SalesBulkRequest = z
  .strictObject({
    ids: z
      .array(Id)
      .min(1, 'Select at least one record.')
      .max(200, 'Select at most 200 records at a time.')
      .refine((ids) => new Set(ids).size === ids.length, 'A record is selected twice.'),
    /** The number of records the person confirmed. */
    confirmedCount: z.number().int().min(1),
    action: SalesBulkAction,
  })
  .refine((body) => body.confirmedCount === body.ids.length, {
    message: 'Confirm the number of records again.',
    path: ['confirmedCount'],
  });
export type SalesBulkRequest = z.input<typeof SalesBulkRequest>;

export const SalesBulkResult = z.object({
  updated: z.number().int(),
  /** Already as asked (same stage, owner or tag). */
  unchanged: z.number().int(),
});
export type SalesBulkResult = z.infer<typeof SalesBulkResult>;

/**
 * Link the firm's platform subscription (stored OPEN; Billing then reports its status, and a
 * subscription already active or ended is reported at once), or unlink it with null (409
 * UNLINK_UNDER_CONTRACT while under contract). Linking sets the record's firm when it has none.
 */
export const LinkSalesTransactionRequest = z.strictObject({ subscriptionId: Id.nullable() });
export type LinkSalesTransactionRequest = z.input<typeof LinkSalesTransactionRequest>;

/** The transaction picker: firms' platform subscriptions. */
export const SalesSubscriptionsQuery = z.strictObject({
  /** The firm's name. */
  search: SearchText.optional(),
});
export type SalesSubscriptionsQuery = z.input<typeof SalesSubscriptionsQuery>;

export const SalesLinkableSubscription = z.object({
  id: Id,
  firm: Person,
  plan: z.object({ id: Id, name: z.string() }),
  status: PlatformSubscriptionStatus,
  /** The record it is linked to already, if any (409 TRANSACTION_IN_USE for another one). */
  linkedOpportunityId: Id.nullable(),
});
export type SalesLinkableSubscription = z.infer<typeof SalesLinkableSubscription>;
/** At most 20, by firm name. */
export const SalesSubscriptionList = z.object({ items: z.array(SalesLinkableSubscription) });
export type SalesSubscriptionList = z.infer<typeof SalesSubscriptionList>;

/** Log Outreach: a call, email, text or meeting, as the signed-in member. Insert-only. */
export const LogSalesActivityRequest = z
  .strictObject({
    kind: SalesActivityKind,
    direction: SalesActivityDirection.default('OUTBOUND'),
    /** CONNECTED or REPLIED: the contact was reached (two-way). */
    outcome: SalesActivityOutcome.nullable().default(null),
    /** Left out: now. Never in the future (422 IN_THE_FUTURE past five minutes' leeway). */
    occurredAt: DateTime.optional(),
    summary: optionalText(2000, 'many').default(''),
    /** The follow-up it carried out: one of this record's. */
    followUpId: Id.nullable().default(null),
  })
  .refine((body) => !body.occurredAt || Date.parse(body.occurredAt) <= Date.now() + 5 * 60_000, {
    message: 'An activity cannot be dated in the future.',
    path: ['occurredAt'],
  });
export type LogSalesActivityRequest = z.input<typeof LogSalesActivityRequest>;

export const SaveSalesNoteRequest = z.strictObject({
  body: platformText(10000, 'many', 'Write the note first.'),
});
export type SaveSalesNoteRequest = z.input<typeof SaveSalesNoteRequest>;

const endsAfterStart = (body: { dueAt?: string | undefined; endsAt?: string | null | undefined }) =>
  !body.dueAt || !body.endsAt || Date.parse(body.endsAt) > Date.parse(body.dueAt);
const ENDS_AFTER = { message: 'End it after it starts.', path: ['endsAt'] };

/**
 * A follow-up (FOLLOW_UP) or an appointment (CALL, DEMO, CONSULTATION, MEETING). Booking an
 * appointment for a record in an ACTIVE stage before the pipeline's Appointment Set
 * (`appointment_set`) moves it there (history source AUTOMATION).
 */
export const CreateSalesFollowUpRequest = z
  .strictObject({
    kind: SalesFollowUpKind,
    title: platformText(200, 'one', 'Describe the follow-up.'),
    dueAt: DateTime,
    endsAt: DateTime.nullable().default(null),
    location: optionalText(200).default(''),
    /** Left out: the record's owner; null: nobody. */
    assigneeId: Id.nullable().optional(),
  })
  .refine(endsAfterStart, ENDS_AFTER);
export type CreateSalesFollowUpRequest = z.input<typeof CreateSalesFollowUpRequest>;

/** Edit or reschedule, while scheduled (409 FOLLOW_UP_CLOSED otherwise). */
export const UpdateSalesFollowUpRequest = z
  .strictObject({
    kind: SalesFollowUpKind.optional(),
    title: platformText(200, 'one', 'Describe the follow-up.').optional(),
    dueAt: DateTime.optional(),
    endsAt: DateTime.nullable().optional(),
    location: optionalText(200).optional(),
    assigneeId: Id.nullable().optional(),
  })
  .refine(
    (body) => Object.values(body).some((value) => value !== undefined),
    'Change something first',
  )
  .refine(endsAfterStart, ENDS_AFTER);
export type UpdateSalesFollowUpRequest = z.input<typeof UpdateSalesFollowUpRequest>;

/** The upcoming list: scheduled, due from now on, soonest first. */
export const SalesUpcomingQuery = z.strictObject({
  /** Every pipeline when left out. */
  pipelineId: Id.optional(),
  kinds: listOf(SalesFollowUpKind),
  assigneeId: Id.optional(),
  /** 50 by default. */
  limit: z.coerce.number().int().min(1).max(100).optional(),
});
export type SalesUpcomingQuery = z.input<typeof SalesUpcomingQuery>;

/** Recent Activity: newest first. */
export const SalesFeedQuery = z.strictObject({
  /** Every pipeline when left out. */
  pipelineId: Id.optional(),
  kinds: listOf(SalesFeedKind),
  /** 50 by default. */
  limit: z.coerce.number().int().min(1).max(100).optional(),
});
export type SalesFeedQuery = z.input<typeof SalesFeedQuery>;

export const SalesOk = z.object({ ok: z.literal(true) });
export type SalesOk = z.infer<typeof SalesOk>;

// ---------- The Sales Center and analytics ----------

/** A period, or a range of UTC days (both days); LAST_30_DAYS when neither is given. */
export const SalesPeriodQuery = z
  .strictObject({
    period: SalesPeriod.optional(),
    from: Day.optional(),
    to: Day.optional(),
    /** Stage counts: the default pipeline when left out; the rest: every pipeline. */
    pipelineId: Id.optional(),
  })
  .refine((query) => (query.from === undefined) === (query.to === undefined), {
    message: 'Choose both days of the range.',
    path: ['to'],
  })
  .refine((query) => !(query.period && query.from), {
    message: 'Choose a period or a range, not both.',
    path: ['period'],
  })
  .refine(rangeInOrder, RANGE_ORDER);
export type SalesPeriodQuery = z.input<typeof SalesPeriodQuery>;

export const SalesMetric = z.object({ value: z.number().int(), trend: Trend });
export type SalesMetric = z.infer<typeof SalesMetric>;

/**
 * The Sales Center's numbers for a period, each against the period before (D1's metrics):
 * - totalLeads: opportunities created in the period (NEW_LEADS)
 * - demosScheduled: DEMO follow-ups due in the period, not cancelled (DEMOS_SCHEDULED)
 * - trialsStarted: linked platform subscriptions whose trial started in the period
 * - activeTrials: linked subscriptions in a running trial now (its trend is null)
 * - wonDeals: opportunities converted in the period (WON_DEALS)
 * - lostDeals: opportunities that entered a LOST stage in the period (the stage history)
 * - revenueWonCents: `value_cents` of the deals won in the period (REVENUE_WON)
 * - projectedMrrCents: the monthly price of the linked subscriptions of the deals won or trials
 *   started in the period (its negotiated price, or its plan's price with purchased seats and
 *   locations; an annual price divided by 12, rounded down). A prospect with no linked
 *   subscription adds nothing.
 */
export const SalesCenterSummary = z.object({
  from: Day,
  to: Day,
  previousFrom: Day,
  previousTo: Day,
  totalLeads: SalesMetric,
  demosScheduled: SalesMetric,
  trialsStarted: SalesMetric,
  activeTrials: SalesMetric,
  wonDeals: SalesMetric,
  lostDeals: SalesMetric,
  revenueWonCents: SalesMetric,
  projectedMrrCents: SalesMetric,
});
export type SalesCenterSummary = z.infer<typeof SalesCenterSummary>;

/**
 * Records per stage that were open in the period (the analytics bars): each stage's records now,
 * created on or before the last day, and (in a CLOSED or LOST stage) entered it on or after the
 * first. Active stages, and inactive ones that hold records, in board order. Lost reasons count
 * the entries into LOST stages in the period (the stage history), every reason in order.
 */
export const SalesStageCounts = z.object({
  pipelineId: Id,
  from: Day,
  to: Day,
  stages: z.array(
    z.object({
      stageId: Id,
      name: z.string(),
      type: SalesStageType,
      tone: SalesStageTone,
      count: z.number().int(),
      /** A null value adds nothing. */
      valueCents: z.number().int(),
    }),
  ),
  lostReasons: z.array(z.object({ reason: SalesLostReason, count: z.number().int() })),
});
export type SalesStageCounts = z.infer<typeof SalesStageCounts>;

/**
 * Revenue by Plan: `value_cents` of the deals won in the period (REVENUE_WON) by the plan on the
 * record. Every active plan in display order (zeros included), then "No plan" (planId null) when
 * a won deal had none.
 */
export const SalesRevenueByPlan = z.object({
  from: Day,
  to: Day,
  totalCents: z.number().int(),
  slices: z.array(
    z.object({
      planId: Id.nullable(),
      code: z.string().nullable(),
      name: z.string(),
      cents: z.number().int(),
      deals: z.number().int(),
    }),
  ),
});
export type SalesRevenueByPlan = z.infer<typeof SalesRevenueByPlan>;

/** Opportunities created in the period by lead source: largest first, zeros left out. */
export const SalesLeadSources = z.object({
  from: Day,
  to: Day,
  total: z.number().int(),
  items: z.array(
    z.object({
      source: SalesLeadSource,
      count: z.number().int(),
      /** Whole percent of `total`, rounded. */
      percent: z.number().int(),
    }),
  ),
});
export type SalesLeadSources = z.infer<typeof SalesLeadSources>;

// ---------- Tags ----------

export const SaveSalesTagRequest = z.strictObject({
  name: platformText(50, 'one', 'Enter a tag name.'),
  /** A design-token colour name from packages/ui (e.g. accent-blue); null for none. */
  colorKey: z
    .string()
    .regex(/^[a-z][a-z0-9-]{0,39}$/, 'Choose a colour from the list.')
    .nullable()
    .default(null),
});
export type SaveSalesTagRequest = z.input<typeof SaveSalesTagRequest>;

// ---------- Targets (D1) ----------

type SalesCalendarPeriod = Exclude<SalesTargetPeriod, 'CUSTOM'>;
const PERIOD_MONTHS: Readonly<Record<SalesCalendarPeriod, number>> = {
  MONTH: 1,
  QUARTER: 3,
  YEAR: 12,
};
const utcDay = (day: string) => new Date(`${day}T00:00:00.000Z`);

/** The last day of a month, quarter or year that starts on `start` (`YYYY-MM-DD`). */
export function salesTargetPeriodEnd(type: SalesCalendarPeriod, start: string): string {
  const day = utcDay(start);
  return new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth() + PERIOD_MONTHS[type], 0))
    .toISOString()
    .slice(0, 10);
}

/**
 * The database's period rule: a month, quarter or year starts and ends on its calendar
 * boundaries; a custom range is 1 to 366 days (both days count).
 */
export function isSalesTargetPeriod(type: SalesTargetPeriod, start: string, end: string): boolean {
  const first = utcDay(start);
  if (Number.isNaN(first.getTime()) || Number.isNaN(utcDay(end).getTime())) return false;
  if (type === 'CUSTOM') {
    const days = (utcDay(end).getTime() - first.getTime()) / 86_400_000;
    return days >= 0 && days <= 365;
  }
  const month = first.getUTCMonth();
  const starts =
    first.getUTCDate() === 1 &&
    (type === 'MONTH' || (type === 'QUARTER' ? month % 3 === 0 : month === 0));
  return starts && salesTargetPeriodEnd(type, start) === end;
}

/**
 * Attainment, counted from the records for the target's period and subject (D1), never stored:
 * COMPANY counts every record, TEAM the department's members' records, REP that member's.
 */
export const SalesTargetAttainment = z.object({
  /** So far: a count, cents (REVENUE_WON) or basis points (CONVERSION_RATE). */
  actual: z.number().int(),
  /** `actual` ÷ the goal in basis points (10,000 = met; more when exceeded). */
  progressBp: z.number().int(),
  /** The share of the period elapsed in basis points (0 before it starts, 10,000 once ended). */
  elapsedBp: z.number().int(),
  /** Progress at least the elapsed share; for CONVERSION_RATE, the rate at least the goal. */
  onPace: z.boolean(),
  ended: z.boolean(),
});
export type SalesTargetAttainment = z.infer<typeof SalesTargetAttainment>;

export const SalesTarget = z.object({
  id: Id,
  name: z.string(),
  scope: SalesTargetScope,
  /** TEAM: the platform department. */
  team: Person.nullable(),
  /** REP: the team member. */
  rep: Person.nullable(),
  metric: SalesTargetMetric,
  /** A count, cents (REVENUE_WON) or basis points (CONVERSION_RATE). */
  targetValue: z.number().int(),
  periodType: SalesTargetPeriod,
  periodStart: Day,
  periodEnd: Day,
  note: z.string().nullable(),
  /** Set once; an archived target never changes. */
  archivedAt: DateTime.nullable(),
  createdAt: DateTime,
  updatedAt: DateTime,
  attainment: SalesTargetAttainment,
});
export type SalesTarget = z.infer<typeof SalesTarget>;
export const SalesTargetList = z.object({ items: z.array(SalesTarget) });
export type SalesTargetList = z.infer<typeof SalesTargetList>;

/** The live targets whose period includes `on` (today when left out), with their attainment. */
export const SalesTargetsQuery = z.strictObject({
  on: Day.optional(),
  scope: SalesTargetScope.optional(),
  metric: SalesTargetMetric.optional(),
  periodType: SalesTargetPeriod.optional(),
});
export type SalesTargetsQuery = z.input<typeof SalesTargetsQuery>;

const GOAL = 'Enter a goal above 0.';
const Goal = z.number().int(GOAL).min(1, GOAL).max(2_147_483_647, 'Enter a smaller goal.');

/**
 * A new target. One live target per subject, metric and exact period (409 TARGET_EXISTS: archive
 * the old one first). The subject, metric and period never change afterwards.
 */
export const CreateSalesTargetRequest = z
  .strictObject({
    name: platformText(120, 'one', 'Enter a target name.'),
    scope: SalesTargetScope,
    /** TEAM only: an active platform department (422 TEAM_INACTIVE). */
    teamId: Id.nullable().default(null),
    /** REP only: a team member. */
    repId: Id.nullable().default(null),
    metric: SalesTargetMetric,
    /** A count, cents (REVENUE_WON) or basis points, at most 10,000 (CONVERSION_RATE). */
    targetValue: Goal,
    periodType: SalesTargetPeriod,
    periodStart: Day,
    periodEnd: Day,
    note: optionalText(1000, 'many').default(''),
  })
  .refine((body) => (body.scope === 'TEAM') === (body.teamId !== null), {
    message: 'Choose the team for a team target, and only then.',
    path: ['teamId'],
  })
  .refine((body) => (body.scope === 'REP') === (body.repId !== null), {
    message: 'Choose the sales rep for a rep target, and only then.',
    path: ['repId'],
  })
  .refine((body) => body.metric !== 'CONVERSION_RATE' || body.targetValue <= 10_000, {
    message: 'A conversion rate goal is at most 100%.',
    path: ['targetValue'],
  })
  .refine((body) => isSalesTargetPeriod(body.periodType, body.periodStart, body.periodEnd), {
    message:
      'A month, quarter or year runs between its calendar days; a custom range is 1 to 366 days.',
    path: ['periodEnd'],
  });
export type CreateSalesTargetRequest = z.input<typeof CreateSalesTargetRequest>;

/** The name, the goal and the note (409 TARGET_ARCHIVED once archived). */
export const UpdateSalesTargetRequest = z
  .strictObject({
    name: platformText(120, 'one', 'Enter a target name.').optional(),
    /** A CONVERSION_RATE goal is at most 10,000 (422 INVALID_TARGET_VALUE). */
    targetValue: Goal.optional(),
    note: optionalText(1000, 'many').optional(),
  })
  .refine(
    (body) => Object.values(body).some((value) => value !== undefined),
    'Change something first',
  );
export type UpdateSalesTargetRequest = z.input<typeof UpdateSalesTargetRequest>;

// ---------- Errors ----------

export const SalesErrorCode = z.enum([
  'NOT_FOUND',
  'FORBIDDEN',
  'CONFLICT',
  'POSSIBLE_DUPLICATE',
  'DUPLICATE_NAME',
  'INACTIVE_CHOICE',
  'STAGE_INACTIVE',
  'VALUE_REQUIRED',
  'OWNER_REQUIRED',
  'PLAN_REQUIRED',
  'TRANSACTION_REQUIRED',
  'LOST_REASON_REQUIRED',
  'LOST_NOTE_REQUIRED',
  'LOST_REASON_NOT_ALLOWED',
  'TRANSACTION_LOCKED',
  'UNLINK_UNDER_CONTRACT',
  'TRANSACTION_IN_USE',
  'FIRM_MISMATCH',
  'SYNC_STAGE_REQUIRED',
  'SHIPPED_STAGE',
  'STAGE_HAS_RECORDS',
  'RETURN_STAGE_INVALID',
  'FOLLOW_UP_CLOSED',
  'NOT_AUTHOR',
  'IN_THE_FUTURE',
  'TARGET_EXISTS',
  'TARGET_ARCHIVED',
  'TEAM_INACTIVE',
  'INVALID_TARGET_VALUE',
  'NOT_SUPPORTED_YET',
]);
export type SalesErrorCode = z.infer<typeof SalesErrorCode>;

/** Messages for `errorMessage(error, SALES_ERRORS)`. */
export const SALES_ERRORS: Readonly<Record<SalesErrorCode, string>> = {
  NOT_FOUND: "We couldn't find that sales record. Refresh to see the latest.",
  FORBIDDEN: 'Your sales role does not allow this.',
  CONFLICT: 'Someone changed this pipeline since you opened it. Refresh and try again.',
  POSSIBLE_DUPLICATE:
    'A similar record already exists. Check the matches, or confirm this is a different firm.',
  DUPLICATE_NAME: 'That name is already in use.',
  INACTIVE_CHOICE: 'That plan, stage, tag or team member is no longer available. Choose another.',
  STAGE_INACTIVE: 'This stage is switched off. Choose another stage.',
  VALUE_REQUIRED: 'This stage needs an estimated value.',
  OWNER_REQUIRED: 'This stage needs an owner.',
  PLAN_REQUIRED: 'This stage needs a plan.',
  TRANSACTION_REQUIRED: 'This stage needs a linked transaction.',
  LOST_REASON_REQUIRED: 'Choose why this record was lost.',
  LOST_NOTE_REQUIRED: 'Explain the reason.',
  LOST_REASON_NOT_ALLOWED: 'A lost reason goes only with a lost stage.',
  TRANSACTION_LOCKED:
    'This record follows its linked transaction: its stage changes when the transaction does.',
  UNLINK_UNDER_CONTRACT:
    'A transaction under contract stays linked until it is closed or terminated.',
  TRANSACTION_IN_USE: 'That subscription is already linked to another record.',
  FIRM_MISMATCH: 'That subscription belongs to another firm than the one on this record.',
  SYNC_STAGE_REQUIRED:
    'Linked transactions need an active Under Contract stage and an active Closed stage.',
  SHIPPED_STAGE: 'A stage Firmivra ships keeps its type and can be switched off, not removed.',
  STAGE_HAS_RECORDS: "Move this stage's records to another stage first.",
  RETURN_STAGE_INVALID:
    'Choose an active or converted stage for records whose transaction is terminated.',
  FOLLOW_UP_CLOSED: 'This follow-up is already completed or cancelled.',
  NOT_AUTHOR: 'Only the author can change or delete this note.',
  IN_THE_FUTURE: 'An activity cannot be dated in the future.',
  TARGET_EXISTS: 'A live target already covers this subject, metric and period. Archive it first.',
  TARGET_ARCHIVED: 'This target is archived and can no longer change.',
  TEAM_INACTIVE: 'Choose an active team.',
  INVALID_TARGET_VALUE: 'A conversion rate goal is at most 100%.',
  NOT_SUPPORTED_YET: 'This cannot be saved yet.',
};
