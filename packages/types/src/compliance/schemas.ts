import { z } from 'zod';
import { MemberRef } from '../clients/schemas.js';
import { clearable, SearchText, text } from '../clients/text.js';
import {
  DeadlineSource,
  DeadlineStatus,
  DeadlineType,
  DeliveryChannel,
  JurisdictionLevel,
  TaskPriority,
  TaskStatus,
} from '../db-enums.js';

// Compliance & Deadlines (the Compliance API): the firm's obligations for its clients, each with a
// due date. The deadline is the source of truth for the obligation and its date; Tasks is the work.
// Firm routes: /api/v1/business/compliance (and /business/clients/{id}/compliance).
// - Everyone with the permission grid's COMPLIANCE view reads and prepares (Staff only the
//   deadlines of clients assigned to them: 404 NOT_FOUND otherwise, like client records).
// - Owner and Admin (MGR) manage the calendar library, recurring definitions, applicability rules
//   and settings, and may override a government date (always with a reason).
// - Overdue and Due Soon are derived, never stored: an open deadline whose date (the extended
//   filing date when there is one) is before today is OVERDUE; one due within the firm's Due Soon
//   threshold is DUE_SOON. No data means empty lists and zeros; nothing is estimated.
// Responses are plain objects; requests are strict. Days are `YYYY-MM-DD`.

export const ComplianceDay = z.iso.date();
export const ComplianceDateTime = z.iso.datetime({ offset: true });
/** A time of day in the firm's timezone, `HH:MM`. */
export const ComplianceTimeOfDay = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use a time like 09:30');
export const ComplianceStateCode = z.string().regex(/^[A-Z]{2}$/, 'Use the two-letter state code');
const Int = z.number().int();

export const ComplianceDeadlineId = z.uuid();
export const ComplianceReminderDays = z.number().int().min(0).max(365);

export const ComplianceOk = z.object({ ok: z.literal(true) });
export type ComplianceOk = z.infer<typeof ComplianceOk>;

/** Every error code the compliance routes add to the standard ones (400, 403 and 404 are the usual). */
export const ComplianceErrorCode = z.enum([
  'NOT_A_MEMBER',
  'CLIENT_NOT_ASSIGNED',
  'DEADLINE_STATE',
  'OVERRIDE_REASON_REQUIRED',
  'OVERRIDE_NOT_ALLOWED',
  'NOT_THIS_CLIENTS',
  'DUPLICATE',
  'TEMPLATE_NOT_FOUND',
  'CALENDAR_STATE',
  'ENTRIES_NEED_VERIFICATION',
  'NO_ENTRIES',
  'RECURRENCE_STATE',
  'DUE_DATE_REQUIRED',
  'SUGGESTION_STATE',
  'RULE_INACTIVE',
]);
export type ComplianceErrorCode = z.infer<typeof ComplianceErrorCode>;

export const CompliancePage = { total: Int, page: Int, pageSize: Int };
export const compliancePageQuery = (defaultSize: number) => ({
  page: z.coerce.number().int().min(1).max(100_000).optional().default(1),
  pageSize: z.coerce.number().int().min(1).max(100).optional().default(defaultSize),
});
export const ComplianceDirection = z.enum(['asc', 'desc']);
/** A boolean in a query string. */
export const ComplianceQueryBool = z.union([
  z.boolean(),
  z.enum(['true', 'false']).transform((v) => v === 'true'),
]);

export const ComplianceClientRef = z.object({
  id: z.uuid(),
  displayName: z.string(),
  clientNumber: Int,
  accountType: z.enum(['INDIVIDUAL', 'BUSINESS']),
});
export type ComplianceClientRef = z.infer<typeof ComplianceClientRef>;

// ---------- Status ----------

/** The statuses the screens show: the stored one, or OVERDUE and DUE_SOON, derived (see above). */
export const ComplianceDisplayStatus = z.enum([
  'UPCOMING',
  'DUE_SOON',
  'IN_PROGRESS',
  'WAITING_ON_CLIENT',
  'OVERDUE',
  'COMPLETED',
  'NOT_APPLICABLE',
  'CANCELLED',
]);
export type ComplianceDisplayStatus = z.infer<typeof ComplianceDisplayStatus>;

/** A reminder rule: `daysBefore` the due date (0 is the due day), in the app and by email or SMS. */
export const ComplianceReminder = z
  .strictObject({
    daysBefore: ComplianceReminderDays,
    inApp: z.boolean().optional().default(true),
    channels: z.array(DeliveryChannel).max(2).optional().default([]),
  })
  .refine((r) => r.inApp || r.channels.length > 0, 'Choose at least one way to remind');
export type ComplianceReminder = z.input<typeof ComplianceReminder>;
export const ComplianceReminderOut = z.object({
  daysBefore: Int,
  inApp: z.boolean(),
  channels: z.array(DeliveryChannel),
});
export type ComplianceReminderOut = z.infer<typeof ComplianceReminderOut>;

/** A list of reminders: at most 10, one per `daysBefore`. */
export const ComplianceReminders = z
  .array(ComplianceReminder)
  .max(10)
  .refine((rows) => new Set(rows.map((r) => r.daysBefore)).size === rows.length, {
    message: 'Use each reminder day once',
  });

// ---------- Deadline rows and detail ----------

export const ComplianceDeadlineRow = z.object({
  id: z.uuid(),
  name: z.string(),
  type: DeadlineType,
  source: DeadlineSource,
  agency: z.string().nullable(),
  client: ComplianceClientRef,
  dueOn: ComplianceDay,
  dueTime: ComplianceTimeOfDay.nullable(),
  /** The extended filing date, when an extension was filed. */
  extendedDueOn: ComplianceDay.nullable(),
  status: DeadlineStatus,
  displayStatus: ComplianceDisplayStatus,
  /** Days from today to the date the deadline is judged by (extended date when there is one); negative when past. */
  daysUntilDue: Int,
  priority: TaskPriority,
  assignedTo: MemberRef.nullable(),
  taxYear: Int.nullable(),
  filingPeriod: z.string().nullable(),
  relatedForm: z.string().nullable(),
  state: ComplianceStateCode.nullable(),
  recurring: z.boolean(),
  archived: z.boolean(),
});
export type ComplianceDeadlineRow = z.infer<typeof ComplianceDeadlineRow>;

export const ComplianceDeadlineTask = z.object({
  id: z.uuid(),
  title: z.string(),
  status: TaskStatus,
  dueOn: ComplianceDay.nullable(),
  assignedTo: MemberRef.nullable(),
});
export type ComplianceDeadlineTask = z.infer<typeof ComplianceDeadlineTask>;

export const ComplianceDeadlineDocument = z.object({
  documentId: z.uuid(),
  fileName: z.string(),
  addedAt: ComplianceDateTime,
});
export type ComplianceDeadlineDocument = z.infer<typeof ComplianceDeadlineDocument>;

export const ComplianceRelatedDeadline = z.object({
  id: z.uuid(),
  name: z.string(),
  dueOn: ComplianceDay,
  displayStatus: ComplianceDisplayStatus,
});
export type ComplianceRelatedDeadline = z.infer<typeof ComplianceRelatedDeadline>;

/** The library entry a deadline came from, with the calendar version behind its date. */
export const ComplianceEntryRef = z.object({
  id: z.uuid(),
  name: z.string(),
  calendarId: z.uuid(),
  calendarName: z.string(),
  authority: z.string(),
  effectiveYear: Int,
  version: Int,
  sourceUrl: z.string(),
  verifiedAt: ComplianceDateTime.nullable(),
});
export type ComplianceEntryRef = z.infer<typeof ComplianceEntryRef>;

/** GET /business/compliance/deadlines/{id} (Add / Edit Deadline, Frame 2, and its Summary). */
export const ComplianceDeadline = ComplianceDeadlineRow.extend({
  description: z.string().nullable(),
  /** Staff only. */
  internalNotes: z.string().nullable(),
  /** Shown to the client when `clientVisible`. */
  clientNotes: z.string().nullable(),
  engagementId: z.uuid().nullable(),
  entityType: z.string().nullable(),
  jurisdiction: JurisdictionLevel.nullable(),
  /** The date the rule or library gave, kept apart from the date the firm works to. */
  statutoryDueOn: ComplianceDay.nullable(),
  dueOverridden: z.boolean(),
  dueOverrideReason: z.string().nullable(),
  extensionFiledOn: ComplianceDay.nullable(),
  /** Kept separate: an extension to file is not an extension to pay. */
  paymentDueOn: ComplianceDay.nullable(),
  clientVisible: z.boolean(),
  createTask: z.boolean(),
  taskTemplateId: z.uuid().nullable(),
  completedAt: ComplianceDateTime.nullable(),
  completedBy: MemberRef.nullable(),
  filedOn: ComplianceDay.nullable(),
  confirmationNumber: z.string().nullable(),
  notApplicableReason: z.string().nullable(),
  calendarEntry: ComplianceEntryRef.nullable(),
  /** Why it applies to the client, with the rule and calendar version that made it. */
  applicabilityReason: z.string().nullable(),
  recurrence: z.object({ id: z.uuid(), name: z.string() }).nullable(),
  createdBy: MemberRef.nullable(),
  reminders: z.array(ComplianceReminderOut),
  documents: z.array(ComplianceDeadlineDocument),
  tasks: z.array(ComplianceDeadlineTask),
  relatedDeadlines: z.array(ComplianceRelatedDeadline),
  /** True when the calendar behind the date was last verified longer ago than the firm's stale limit. */
  calendarStale: z.boolean(),
  createdAt: ComplianceDateTime,
  updatedAt: ComplianceDateTime,
  archivedAt: ComplianceDateTime.nullable(),
});
export type ComplianceDeadline = z.infer<typeof ComplianceDeadline>;

// ---------- List ----------

export const ComplianceDeadlineTab = z.enum(['ALL', 'COMPLETED', 'RECURRING', 'ARCHIVED']);
export type ComplianceDeadlineTab = z.infer<typeof ComplianceDeadlineTab>;

export const ComplianceDateRange = z.enum([
  'ALL',
  'NEXT_7_DAYS',
  'NEXT_30_DAYS',
  'NEXT_90_DAYS',
  'THIS_MONTH',
  'THIS_QUARTER',
  'THIS_YEAR',
  'PAST_30_DAYS',
]);
export type ComplianceDateRange = z.infer<typeof ComplianceDateRange>;

export const ComplianceDeadlineSort = z.enum([
  'dueOn',
  'name',
  'client',
  'type',
  'agency',
  'status',
  'priority',
]);

/**
 * GET /business/compliance/deadlines (and /export, which ignores page and pageSize). `from` and
 * `to` win over `range`. ALL shows every deadline that is not archived.
 */
export const ComplianceDeadlinesQuery = z
  .strictObject({
    tab: ComplianceDeadlineTab.optional().default('ALL'),
    range: ComplianceDateRange.optional().default('ALL'),
    from: ComplianceDay.optional(),
    to: ComplianceDay.optional(),
    type: DeadlineType.optional(),
    status: ComplianceDisplayStatus.optional(),
    clientId: z.uuid().optional(),
    assignedUserId: z.uuid().optional(),
    /** The authority ("IRS", "GA DOR"), matched without regard to case. */
    agency: text(120).optional(),
    /** "Show only my deadlines". */
    mine: ComplianceQueryBool.optional(),
    /** Name, client, agency or form. */
    search: SearchText.optional(),
    sort: ComplianceDeadlineSort.optional().default('dueOn'),
    direction: ComplianceDirection.optional().default('asc'),
    ...compliancePageQuery(25),
  })
  .refine((q) => !q.from || !q.to || q.from <= q.to, {
    message: 'The end date is before the start date',
    path: ['to'],
  });
export type ComplianceDeadlinesQuery = z.input<typeof ComplianceDeadlinesQuery>;

export const ComplianceDeadlinePage = z.object({
  items: z.array(ComplianceDeadlineRow).max(100),
  ...CompliancePage,
});
export type ComplianceDeadlinePage = z.infer<typeof ComplianceDeadlinePage>;

/** GET .../deadlines/by-client: the By Client tab. */
export const ComplianceByClientQuery = z.strictObject({
  search: SearchText.optional(),
  /** Only clients at risk. */
  atRisk: ComplianceQueryBool.optional(),
  ...compliancePageQuery(25),
});
export type ComplianceByClientQuery = z.input<typeof ComplianceByClientQuery>;

export const ComplianceAtRisk = z.object({
  client: ComplianceClientRef,
  overdueCount: Int,
  /** Open high-priority deadlines due within the firm's At Risk days. */
  highPriorityUpcomingCount: Int,
  /** Deadlines waiting on the client and due within the At Risk days (blocked work). */
  waitingOnClientCount: Int,
  nextDueOn: ComplianceDay.nullable(),
});
export type ComplianceAtRisk = z.infer<typeof ComplianceAtRisk>;

export const ComplianceClientTotals = z.object({
  client: ComplianceClientRef,
  total: Int,
  open: Int,
  overdue: Int,
  dueSoon: Int,
  completed: Int,
  nextDueOn: ComplianceDay.nullable(),
  atRisk: z.boolean(),
});
export type ComplianceClientTotals = z.infer<typeof ComplianceClientTotals>;

export const ComplianceByClientPage = z.object({
  items: z.array(ComplianceClientTotals).max(100),
  ...CompliancePage,
});
export type ComplianceByClientPage = z.infer<typeof ComplianceByClientPage>;

// ---------- Summary (the Overview) ----------

/** A KPI card: the value, the same figure a month earlier and the change (null with nothing to compare). */
export const ComplianceKpi = z.object({
  value: Int,
  previous: Int.nullable(),
  changePercent: z.number().nullable(),
});
export type ComplianceKpi = z.infer<typeof ComplianceKpi>;

/** GET /business/compliance/deadlines/summary. */
export const ComplianceSummary = z.object({
  today: ComplianceDay,
  kpis: z.object({
    /** Deadlines that are not archived, cancelled or not applicable. `previous`: those on file at the start of the month. */
    total: ComplianceKpi,
    /** Open deadlines due today through the next 30 days. */
    next30Days: Int,
    overdue: Int,
    /** Completed this calendar month; `previous` is last month. */
    completedThisMonth: ComplianceKpi,
    /** Active recurring definitions (templates excluded). */
    recurring: Int,
    clientsAtRisk: Int,
  }),
  /** The Deadline Types chart: the kpis.total deadlines by type, zero counts left out. */
  types: z.array(z.object({ type: DeadlineType, count: Int, percent: z.number() })),
  /** The five clients with the most risk first. */
  atRiskClients: z.array(ComplianceAtRisk).max(5),
  /** Published calendars last verified longer ago than the firm's stale limit (or never). */
  staleCalendars: Int,
});
export type ComplianceSummary = z.infer<typeof ComplianceSummary>;

/** GET /business/compliance/deadlines/at-risk: the whole At Risk Clients panel (View All). */
export const ComplianceAtRiskList = z.object({ items: z.array(ComplianceAtRisk) });
export type ComplianceAtRiskList = z.infer<typeof ComplianceAtRiskList>;

// ---------- Calendar (a month) ----------

/** GET .../deadlines/calendar?month=2026-10: the Deadline Calendar and Tax Calendar. */
export const ComplianceCalendarMonthQuery = z.strictObject({
  month: z
    .string()
    .regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Use a month like 2026-10')
    .optional(),
  type: DeadlineType.optional(),
  clientId: z.uuid().optional(),
  assignedUserId: z.uuid().optional(),
  mine: ComplianceQueryBool.optional(),
});
export type ComplianceCalendarMonthQuery = z.input<typeof ComplianceCalendarMonthQuery>;

export const ComplianceCalendarMonth = z.object({
  month: z.string().regex(/^\d{4}-\d{2}$/),
  days: z.array(
    z.object({
      date: ComplianceDay,
      /** The legend's dots: upcoming, overdue, due soon, completed. */
      counts: z.object({ upcoming: Int, overdue: Int, dueSoon: Int, completed: Int }),
      deadlines: z.array(
        z.object({
          id: z.uuid(),
          name: z.string(),
          type: DeadlineType,
          displayStatus: ComplianceDisplayStatus,
          clientName: z.string(),
        }),
      ),
    }),
  ),
  /** More deadlines fall in the month than are listed (the first 1000 by date are). */
  truncated: z.boolean(),
});
export type ComplianceCalendarMonth = z.infer<typeof ComplianceCalendarMonth>;

// ---------- Create and edit ----------

const DeadlineFields = {
  name: text(200),
  type: DeadlineType,
  source: DeadlineSource,
  description: clearable(text(2000, 'many')),
  internalNotes: clearable(text(5000, 'many')),
  clientNotes: clearable(text(2000, 'many')),
  entityType: clearable(text(60)),
  taxYear: z.number().int().min(2000).max(2100).nullable(),
  filingPeriod: clearable(text(60)),
  relatedForm: clearable(text(60)),
  agency: clearable(text(120)),
  jurisdiction: JurisdictionLevel.nullable(),
  state: ComplianceStateCode.nullable(),
  statutoryDueOn: ComplianceDay.nullable(),
  dueOn: ComplianceDay,
  dueTime: ComplianceTimeOfDay.nullable(),
  /** Needed (and only kept) when the date differs from the statutory date. Owner and Admin only. */
  dueOverrideReason: clearable(text(500, 'many')),
  paymentDueOn: ComplianceDay.nullable(),
  priority: TaskPriority,
  status: z.enum(['UPCOMING', 'IN_PROGRESS', 'WAITING_ON_CLIENT']),
  assignedUserId: z.uuid().nullable(),
  clientVisible: z.boolean(),
  engagementId: z.uuid().nullable(),
};

/**
 * POST /business/compliance/deadlines. `clientId` is the client's, who must be reachable by the
 * caller. Leave `reminders` out for the firm's default reminders. `createTask` makes one task
 * from `taskTemplateId` (once: asking again finds the first); the date and client are the
 * deadline's. A government or imported date that is moved needs `dueOverrideReason` and Owner or Admin.
 */
export const CreateComplianceDeadlineRequest = z
  .strictObject({
    clientId: z.uuid(),
    name: DeadlineFields.name,
    type: DeadlineFields.type,
    source: DeadlineFields.source.optional().default('FIRM'),
    description: DeadlineFields.description,
    internalNotes: DeadlineFields.internalNotes,
    clientNotes: DeadlineFields.clientNotes,
    entityType: DeadlineFields.entityType,
    taxYear: DeadlineFields.taxYear.optional(),
    filingPeriod: DeadlineFields.filingPeriod,
    relatedForm: DeadlineFields.relatedForm,
    agency: DeadlineFields.agency,
    jurisdiction: DeadlineFields.jurisdiction.optional(),
    state: DeadlineFields.state.optional(),
    statutoryDueOn: DeadlineFields.statutoryDueOn.optional(),
    dueOn: DeadlineFields.dueOn,
    dueTime: DeadlineFields.dueTime.optional(),
    dueOverrideReason: DeadlineFields.dueOverrideReason,
    paymentDueOn: DeadlineFields.paymentDueOn.optional(),
    priority: DeadlineFields.priority.optional().default('MEDIUM'),
    status: DeadlineFields.status.optional().default('UPCOMING'),
    assignedUserId: DeadlineFields.assignedUserId.optional(),
    clientVisible: DeadlineFields.clientVisible.optional().default(false),
    engagementId: DeadlineFields.engagementId.optional(),
    reminders: ComplianceReminders.optional(),
    createTask: z.boolean().optional().default(false),
    taskTemplateId: z.uuid().optional(),
  })
  .refine((b) => b.createTask || b.taskTemplateId === undefined, {
    message: 'Choose "create a task" to use a task template',
    path: ['taskTemplateId'],
  });
export type CreateComplianceDeadlineRequest = z.input<typeof CreateComplianceDeadlineRequest>;

/** PATCH /business/compliance/deadlines/{id}: any of the fields; the client never changes. */
export const UpdateComplianceDeadlineRequest = z
  .strictObject({
    name: DeadlineFields.name,
    type: DeadlineFields.type,
    source: DeadlineFields.source,
    description: DeadlineFields.description,
    internalNotes: DeadlineFields.internalNotes,
    clientNotes: DeadlineFields.clientNotes,
    entityType: DeadlineFields.entityType,
    taxYear: DeadlineFields.taxYear,
    filingPeriod: DeadlineFields.filingPeriod,
    relatedForm: DeadlineFields.relatedForm,
    agency: DeadlineFields.agency,
    jurisdiction: DeadlineFields.jurisdiction,
    state: DeadlineFields.state,
    dueOn: DeadlineFields.dueOn,
    dueTime: DeadlineFields.dueTime,
    dueOverrideReason: DeadlineFields.dueOverrideReason,
    paymentDueOn: DeadlineFields.paymentDueOn,
    priority: DeadlineFields.priority,
    status: DeadlineFields.status,
    assignedUserId: DeadlineFields.assignedUserId,
    clientVisible: DeadlineFields.clientVisible,
    engagementId: DeadlineFields.engagementId,
  })
  .partial()
  .refine((b) => Object.keys(b).length > 0, 'Change at least one field');
export type UpdateComplianceDeadlineRequest = z.input<typeof UpdateComplianceDeadlineRequest>;

// ---------- Actions ----------

/** POST .../deadlines/{id}/complete: the evidence is optional. Marks the deadline filed or paid, not its tasks. */
export const CompleteComplianceDeadlineRequest = z.strictObject({
  filedOn: ComplianceDay.optional(),
  confirmationNumber: text(100).optional(),
});
export type CompleteComplianceDeadlineRequest = z.input<typeof CompleteComplianceDeadlineRequest>;

/** POST .../deadlines/{id}/not-applicable: the reason is kept with the row. */
export const NotApplicableRequest = z.strictObject({ reason: text(500, 'many') });
export type NotApplicableRequest = z.input<typeof NotApplicableRequest>;

/** POST .../deadlines/{id}/reassign: `null` unassigns. */
export const ReassignRequest = z.strictObject({ assignedUserId: z.uuid().nullable() });
export type ReassignRequest = z.input<typeof ReassignRequest>;

/** POST .../deadlines/{id}/extension: the filing extension (Form 4868 or 7004). The payment date never moves. */
export const ExtensionRequest = z.strictObject({
  filedOn: ComplianceDay,
  extendedDueOn: ComplianceDay,
});
export type ExtensionRequest = z.input<typeof ExtensionRequest>;

/** PUT .../deadlines/{id}/reminders: replaces the rules. */
export const SaveRemindersRequest = z.strictObject({ reminders: ComplianceReminders });
export type SaveRemindersRequest = z.input<typeof SaveRemindersRequest>;

/** POST .../deadlines/{id}/tasks: makes a task of the deadline, from a template (once: asking again finds the first). */
export const CreateDeadlineTaskRequest = z.strictObject({
  templateId: z.uuid().optional(),
  title: text(200).optional(),
});
export type CreateDeadlineTaskRequest = z.input<typeof CreateDeadlineTaskRequest>;

/** POST .../deadlines/{id}/tasks/link: links one of the deadline client's tasks. */
export const LinkDeadlineTaskRequest = z.strictObject({ taskId: z.uuid() });
export type LinkDeadlineTaskRequest = z.input<typeof LinkDeadlineTaskRequest>;

export const AddDeadlineDocumentRequest = z.strictObject({ documentId: z.uuid() });
export type AddDeadlineDocumentRequest = z.input<typeof AddDeadlineDocumentRequest>;

export const AddDeadlineLinkRequest = z.strictObject({ relatedDeadlineId: z.uuid() });
export type AddDeadlineLinkRequest = z.input<typeof AddDeadlineLinkRequest>;

/** POST .../deadlines/{id}/save-as-template: Save as Template (Frame 2). */
export const SaveDeadlineAsTemplateRequest = z.strictObject({ name: text(200) });
export type SaveDeadlineAsTemplateRequest = z.input<typeof SaveDeadlineAsTemplateRequest>;

/** POST .../deadlines/bulk: up to 100 deadlines; each is changed or skipped with its reason. */
export const BulkDeadlinesRequest = z
  .strictObject({
    ids: z.array(z.uuid()).min(1).max(100),
    action: z.enum(['REASSIGN', 'STATUS', 'ARCHIVE']),
    /** REASSIGN: the new assignee (null unassigns). */
    assignedUserId: z.uuid().nullable().optional(),
    /** STATUS: the new status. NOT_APPLICABLE needs `reason`. */
    status: z
      .enum(['UPCOMING', 'IN_PROGRESS', 'WAITING_ON_CLIENT', 'COMPLETED', 'NOT_APPLICABLE'])
      .optional(),
    reason: text(500, 'many').optional(),
  })
  .superRefine((b, ctx) => {
    if (b.action === 'REASSIGN' && b.assignedUserId === undefined) {
      ctx.addIssue({ code: 'custom', path: ['assignedUserId'], message: 'Choose who to assign' });
    }
    if (b.action === 'STATUS' && !b.status) {
      ctx.addIssue({ code: 'custom', path: ['status'], message: 'Choose a status' });
    }
    if (b.action === 'STATUS' && b.status === 'NOT_APPLICABLE' && !b.reason) {
      ctx.addIssue({ code: 'custom', path: ['reason'], message: 'Give the reason' });
    }
  });
export type BulkDeadlinesRequest = z.input<typeof BulkDeadlinesRequest>;

export const BulkDeadlinesResult = z.object({
  updated: z.array(z.uuid()),
  skipped: z.array(z.object({ id: z.uuid(), reason: z.string() })),
});
export type BulkDeadlinesResult = z.infer<typeof BulkDeadlinesResult>;

// ---------- A client's compliance view ----------

/** GET /business/clients/{id}/compliance. */
export const ClientComplianceQuery = z.strictObject({
  /** Include completed, not applicable and cancelled deadlines. */
  includeClosed: ComplianceQueryBool.optional(),
});
export type ClientComplianceQuery = z.input<typeof ClientComplianceQuery>;

export const ClientCompliance = z.object({
  client: ComplianceClientRef,
  totals: z.object({ open: Int, overdue: Int, dueSoon: Int, completed: Int }),
  atRisk: ComplianceAtRisk.nullable(),
  deadlines: z.array(ComplianceDeadlineRow),
  /** Applicability records waiting for staff (suggested or needing review). */
  suggestions: Int,
});
export type ClientCompliance = z.infer<typeof ClientCompliance>;
