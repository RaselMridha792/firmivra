import { z } from 'zod';
import { MemberRef } from '../clients/schemas.js';
import { clearable, SearchText, text } from '../clients/text.js';
import {
  DeliveryChannel,
  HolidayRule,
  RecurrenceEnd,
  RecurrenceUnit,
  TaskAssignmentRule,
  TaskOccurrenceState,
  TaskPriority,
  TaskProgress,
  TaskSeriesStatus,
} from '../db-enums.js';
import { TaskKind, TaskStatus } from './schemas.js';

// Tasks as a work-management layer (R55 contract, for the Tasks screens): the overview with its
// KPIs, filters and calendar, Create / Edit Task (checklist, reminders, dependency, attachments,
// visibility, internal notes), row and bulk actions, task types, task templates and recurring
// series with their occurrences. Designs: docs/mockups/firm-workspace/task/source/ and the
// developer guide beside them. Brief: docs/work/R55-catalog-documents-api.md.
//
// It builds on the client-record contract in ./schemas.ts and the same routes: POST and PATCH
// /business/tasks accept the extra fields below (all optional, so the older callers are
// unchanged) and answer with a TaskDetail, which holds every field of a Task. Firm routes under
// /api/v1/business, `@Access('TASKS')`: Owner and Admin reach every task; Staff only the tasks of
// clients assigned to them (404 otherwise), as in ./schemas.ts. A task is never shown to a
// client unless `clientVisible`; then the portal gets approved fields only (never internal notes,
// the dependency, the reminders or an attachment that is not approved). Seeing a task never
// grants access to a client or record the person cannot reach. Responses are plain objects;
// requests are strict. Every change is audited with ids, statuses and field names only.

const DateTime = z.iso.datetime({ offset: true });
const CalendarDate = z.iso.date();
/** A time of day in the firm's time zone, `HH:MM`. */
export const TaskTimeOfDay = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:MM');

export const TaskTypeId = z.uuid();
export const TaskTemplateId = z.uuid();
export const TaskSeriesId = z.uuid();
export const TaskOccurrenceId = z.uuid();
export const ChecklistItemId = z.uuid();
export const TaskAttachmentId = z.uuid();

/** A true/false filter: a boolean from the client, "true"/"false" in the query string. */
const QueryBool = z.union([z.boolean(), z.stringbool()]);

const Page = { total: z.number().int(), page: z.number().int(), pageSize: z.number().int() };

// ---------- Task types ----------

/** A firm-configured category ("Bookkeeping", "Tax Prep"). Archived, never deleted. */
export const TaskType = z.object({
  id: z.uuid(),
  name: z.string(),
  sortOrder: z.number().int(),
  archivedAt: DateTime.nullable(),
});
export type TaskType = z.infer<typeof TaskType>;
export const TaskTypeList = z.object({ items: z.array(TaskType) });
export type TaskTypeList = z.infer<typeof TaskTypeList>;

/** Task types are unique ignoring case (409 DUPLICATE_NAME). */
export const SaveTaskTypeRequest = z.strictObject({ name: text(80) });
export type SaveTaskTypeRequest = z.input<typeof SaveTaskTypeRequest>;

// ---------- Checklist, reminders, attachments ----------

export const ChecklistItem = z.object({
  id: z.uuid(),
  label: z.string(),
  position: z.number().int(),
  /** The task cannot be completed while a required item is open (409 REQUIRED_ITEMS_OPEN). */
  required: z.boolean(),
  completedAt: DateTime.nullable(),
  completedBy: MemberRef.nullable(),
  assignedTo: MemberRef.nullable(),
});
export type ChecklistItem = z.infer<typeof ChecklistItem>;

/** One checklist step on save. An item with an `id` of this task keeps its row and completion. */
export const ChecklistItemInput = z.strictObject({
  id: z.uuid().optional(),
  label: text(300),
  required: z.boolean().default(false),
  /** An active member of the firm; being assigned a step gives no access to the client. */
  assignedUserId: z.uuid().nullable().optional(),
});
export type ChecklistItemInput = z.input<typeof ChecklistItemInput>;

/** A relative reminder: `daysBefore` the due date (0: the due day) at `timeOfDay`. */
export const ReminderRule = z
  .strictObject({
    daysBefore: z.number().int().min(0).max(365),
    /** Null: the firm's default time. */
    timeOfDay: TaskTimeOfDay.nullable().default(null),
    inApp: z.boolean().default(true),
    /** Email or SMS, as the firm's settings, the provider and the person's consent allow. */
    channels: z.array(DeliveryChannel).max(2).default([]),
  })
  .refine((r) => r.inApp || r.channels.length > 0, {
    message: 'Choose where to remind',
    path: ['channels'],
  });
export type ReminderRule = z.input<typeof ReminderRule>;
export const ReminderRuleOut = z.object({
  id: z.uuid().nullable(),
  daysBefore: z.number().int(),
  timeOfDay: TaskTimeOfDay.nullable(),
  inApp: z.boolean(),
  channels: z.array(DeliveryChannel),
});
export type ReminderRuleOut = z.infer<typeof ReminderRuleOut>;

/** A document of the task's client attached to the task. */
export const TaskAttachment = z.object({
  id: z.uuid(),
  documentId: z.uuid(),
  fileName: z.string(),
  contentType: z.string(),
  sizeBytes: z.number().int(),
  /** The client's portal shows it only when the task is client-visible AND this is true. */
  clientVisible: z.boolean(),
  addedBy: MemberRef.nullable(),
  addedAt: DateTime,
});
export type TaskAttachment = z.infer<typeof TaskAttachment>;

export const AddTaskAttachmentRequest = z.strictObject({
  documentId: z.uuid(),
  clientVisible: z.boolean().optional(),
});
export type AddTaskAttachmentRequest = z.input<typeof AddTaskAttachmentRequest>;

export const UpdateTaskAttachmentRequest = z.strictObject({ clientVisible: z.boolean() });
export type UpdateTaskAttachmentRequest = z.input<typeof UpdateTaskAttachmentRequest>;

// ---------- Tasks ----------

export const TaskLink = z.object({ id: z.uuid(), name: z.string() });

/** One row of the task table and the calendar's list. */
export const TaskRow = z.object({
  id: z.uuid(),
  title: z.string(),
  kind: TaskKind,
  client: z.object({ id: z.uuid(), displayName: z.string() }),
  type: TaskLink.nullable(),
  /** The engagement ("project") it belongs to. */
  engagement: z.object({ id: z.uuid(), title: z.string() }).nullable(),
  service: TaskLink.nullable(),
  /** The compliance deadline it works on. */
  deadline: TaskLink.nullable(),
  priority: TaskPriority,
  /** OPEN, DONE or CANCELLED. */
  status: TaskStatus,
  /** The stage of an OPEN task: Not Started, Pending, In Progress, Waiting, Blocked. */
  progress: TaskProgress,
  dueOn: CalendarDate.nullable(),
  /** With `dueOn` and not `allDay`, the firm's local time. */
  dueTime: TaskTimeOfDay.nullable(),
  allDay: z.boolean(),
  /** Derived: OPEN and past due. Never stored. */
  overdue: z.boolean(),
  assignedTo: MemberRef.nullable(),
  additionalAssigneeCount: z.number().int(),
  checklist: z.object({ done: z.number().int(), total: z.number().int() }),
  /** It depends on a task that is not done yet. */
  blocked: z.boolean(),
  /** It was made by a recurring series. */
  recurring: z.boolean(),
  clientVisible: z.boolean(),
  archivedAt: DateTime.nullable(),
  updatedAt: DateTime,
});
export type TaskRow = z.infer<typeof TaskRow>;

/** GET /business/tasks/{id}: a Task (./schemas.ts) with everything the edit form shows. */
export const TaskDetail = TaskRow.extend({
  details: z.string().nullable(),
  engagementId: z.uuid().nullable(),
  startOn: CalendarDate.nullable(),
  assignedUserId: z.uuid().nullable(),
  additionalAssignees: z.array(MemberRef),
  checklistItems: z.array(ChecklistItem),
  reminders: z.array(ReminderRuleOut),
  attachments: z.array(TaskAttachment),
  /** The one task that must be done first. */
  dependsOn: z.object({ id: z.uuid(), title: z.string(), status: TaskStatus }).nullable(),
  blockedReason: z.string().nullable(),
  /** Staff only, never client-visible. */
  internalNotes: z.string().nullable(),
  templateId: z.uuid().nullable(),
  series: z.object({ id: z.uuid(), title: z.string() }).nullable(),
  completedAt: DateTime.nullable(),
  completedBy: MemberRef.nullable(),
  createdBy: MemberRef.nullable(),
  createdAt: DateTime,
  /** Send it back on a save: 409 SAVE_CONFLICT when someone saved after it was loaded. */
  version: z.string(),
});
export type TaskDetail = z.infer<typeof TaskDetail>;

export const TaskSort = z.enum(['due', 'priority', 'status', 'client', 'title', 'updated']);

/**
 * GET /business/tasks/overview: the table. `view`: all (not cancelled or archived), mine (assigned
 * to the caller, also as an additional assignee), completed, archived. Filters add up. `search`
 * matches the title, client name, type and service. The default order is open tasks by due date
 * (no date last), then the rest newest first.
 */
export const TaskOverviewQuery = z.strictObject({
  view: z.enum(['all', 'mine', 'completed', 'archived']).optional().default('all'),
  status: TaskStatus.optional(),
  progress: TaskProgress.optional(),
  priority: TaskPriority.optional(),
  typeId: z.uuid().optional(),
  clientId: z.uuid().optional(),
  engagementId: z.uuid().optional(),
  assignedUserId: z.uuid().optional(),
  /** Only OPEN tasks past due (`true`). */
  overdue: QueryBool.optional(),
  dueFrom: CalendarDate.optional(),
  dueTo: CalendarDate.optional(),
  search: SearchText.optional(),
  sort: TaskSort.optional().default('due'),
  direction: z.enum(['asc', 'desc']).optional().default('asc'),
  page: z.coerce.number().int().min(1).optional().default(1),
  pageSize: z.coerce.number().int().min(1).max(100).optional().default(10),
});
export type TaskOverviewQuery = z.input<typeof TaskOverviewQuery>;

export const TaskOverviewPage = z.object({ items: z.array(TaskRow).max(100), ...Page });
export type TaskOverviewPage = z.infer<typeof TaskOverviewPage>;

/**
 * GET /business/tasks/summary: the KPI cards, over the tasks the caller reaches. `total` counts
 * tasks that are not archived or cancelled; `pending` and `inProgress` count OPEN tasks by their
 * progress; `overdue` OPEN tasks past due; `completedThisMonth` tasks done in the firm's current
 * month; `mine` OPEN tasks assigned to the caller.
 */
export const TaskSummary = z.object({
  total: z.number().int(),
  pending: z.number().int(),
  inProgress: z.number().int(),
  overdue: z.number().int(),
  completedThisMonth: z.number().int(),
  mine: z.number().int(),
});
export type TaskSummary = z.infer<typeof TaskSummary>;

/** GET /business/tasks/calendar?from&to: the due tasks of a range of at most 62 days. */
export const TaskCalendarQuery = z
  .strictObject({
    from: CalendarDate,
    to: CalendarDate,
    mine: QueryBool.optional(),
    clientId: z.uuid().optional(),
    assignedUserId: z.uuid().optional(),
  })
  .refine((q) => q.from <= q.to, { message: 'End after the start', path: ['to'] })
  .refine((q) => Date.parse(q.to) - Date.parse(q.from) <= 62 * 86_400_000, {
    message: 'Use at most 62 days',
    path: ['to'],
  });
export type TaskCalendarQuery = z.input<typeof TaskCalendarQuery>;

export const TaskCalendarItem = z.object({
  id: z.uuid(),
  title: z.string(),
  dueOn: CalendarDate,
  dueTime: TaskTimeOfDay.nullable(),
  allDay: z.boolean(),
  priority: TaskPriority,
  status: TaskStatus,
  progress: TaskProgress,
  overdue: z.boolean(),
  clientName: z.string(),
});
export const TaskCalendar = z.object({ items: z.array(TaskCalendarItem).max(500) });
export type TaskCalendar = z.infer<typeof TaskCalendar>;

const taskFields = {
  typeId: z.uuid().nullable().optional(),
  priority: TaskPriority.optional(),
  /** The stage of an OPEN task. BLOCKED needs `blockedReason` or a dependency. */
  progress: TaskProgress.optional(),
  serviceId: z.uuid().nullable().optional(),
  startOn: CalendarDate.nullable().optional(),
  /** Needs `dueOn` and `allDay: false`. */
  dueTime: TaskTimeOfDay.nullable().optional(),
  allDay: z.boolean().optional(),
  clientVisible: z.boolean().optional(),
  internalNotes: clearable(text(5_000, 'many')),
  blockedReason: clearable(text(500, 'many')),
  /** Collaborators; none gets access to the client by it. */
  additionalAssigneeIds: z.array(z.uuid()).max(20).optional(),
  /** The one task that must be done first (400 DEPENDENCY_CYCLE when it would loop). */
  dependsOnTaskId: z.uuid().nullable().optional(),
  /** Replaces the reminders. A reminder after the due date is refused (400 INVALID_REMINDER). */
  reminders: z.array(ReminderRule).max(10).optional(),
};

/**
 * POST /business/tasks: a new GENERAL task. The fields of ./schemas.ts CreateTaskRequest plus
 * these. `templateId` starts the task from a template: every field the request leaves out comes
 * from the template (type, service, priority, assignment rule, due date offset, checklist,
 * reminders, visibility), as a snapshot; the request's own fields win.
 */
export const CreateTaskDetailRequest = z.strictObject({
  clientId: z.uuid(),
  engagementId: z.uuid().optional(),
  title: text(200),
  details: clearable(text(2_000, 'many')),
  dueOn: CalendarDate.optional(),
  assignedUserId: z.uuid().optional(),
  ...taskFields,
  /** The checklist, in order. */
  checklist: z.array(ChecklistItemInput).max(50).optional(),
  /** Documents of the client to attach. */
  attachments: z.array(AddTaskAttachmentRequest).max(20).optional(),
  templateId: TaskTemplateId.optional(),
});
export type CreateTaskDetailRequest = z.input<typeof CreateTaskDetailRequest>;

/**
 * PATCH /business/tasks/{id}: only the fields sent change; `null` clears. A list sent replaces
 * the stored one (a checklist item with its `id` keeps its row and completion). `version` from
 * the TaskDetail guards against a concurrent save (409 SAVE_CONFLICT).
 */
export const UpdateTaskDetailRequest = z
  .strictObject({
    title: text(200).optional(),
    details: clearable(text(2_000, 'many')),
    dueOn: CalendarDate.nullable().optional(),
    assignedUserId: z.uuid().nullable().optional(),
    status: TaskStatus.optional(),
    ...taskFields,
    checklist: z.array(ChecklistItemInput).max(50).optional(),
    version: z.string().min(1).max(100).optional(),
  })
  .refine(
    (o) => Object.keys(o).filter((k) => k !== 'version').length > 0,
    'Change at least one field',
  );
export type UpdateTaskDetailRequest = z.input<typeof UpdateTaskDetailRequest>;

/** POST /business/tasks/{id}/progress: the stage of an OPEN task, nothing else. */
export const SetTaskProgressRequest = z.strictObject({ progress: TaskProgress });
export type SetTaskProgressRequest = z.input<typeof SetTaskProgressRequest>;

/** POST /business/tasks/{id}/checklist/{itemId}/complete or reopen needs no body. */

/** POST /business/tasks/{id}/checklist/order: every item id, in the new order. */
export const ReorderChecklistRequest = z.strictObject({ ids: z.array(z.uuid()).min(1).max(50) });
export type ReorderChecklistRequest = z.input<typeof ReorderChecklistRequest>;

/**
 * POST /business/tasks/bulk: one action on up to 100 tasks. Tasks the caller does not reach are
 * left out like any 404 (counted in `skipped` with the reason NOT_FOUND). A task the action does
 * not fit (completing a task with an open required item or prerequisite, reassigning to someone
 * who cannot take the client) is skipped with a safe reason code, the rest still change. When
 * none of the tasks is found, the answer is 404 NOT_FOUND, as for one task that is not found.
 */
export const BulkTaskRequest = z
  .discriminatedUnion('action', [
    z.strictObject({
      action: z.literal('REASSIGN'),
      ids: z.array(z.uuid()).min(1).max(100),
      assignedUserId: z.uuid().nullable(),
    }),
    z.strictObject({
      action: z.literal('SET_PROGRESS'),
      ids: z.array(z.uuid()).min(1).max(100),
      progress: TaskProgress,
    }),
    z.strictObject({
      action: z.literal('SET_DUE_DATE'),
      ids: z.array(z.uuid()).min(1).max(100),
      /** Set every task to this date, or move each by `shiftDays` (one of the two). */
      dueOn: CalendarDate.optional(),
      shiftDays: z.number().int().min(-3650).max(3650).optional(),
    }),
    z.strictObject({
      action: z.literal('SET_PRIORITY'),
      ids: z.array(z.uuid()).min(1).max(100),
      priority: TaskPriority,
    }),
    z.strictObject({ action: z.literal('COMPLETE'), ids: z.array(z.uuid()).min(1).max(100) }),
    z.strictObject({
      action: z.literal('CANCEL'),
      ids: z.array(z.uuid()).min(1).max(100),
      /** Cancelling and archiving ask for confirmation first. */
      confirm: z.literal(true),
    }),
    z.strictObject({
      action: z.literal('ARCHIVE'),
      ids: z.array(z.uuid()).min(1).max(100),
      confirm: z.literal(true),
    }),
  ])
  .refine(
    (b) => b.action !== 'SET_DUE_DATE' || (b.dueOn === undefined) !== (b.shiftDays === undefined),
    {
      message: 'Send a date or a number of days to shift',
      path: ['dueOn'],
    },
  );
export type BulkTaskRequest = z.input<typeof BulkTaskRequest>;

export const BulkTaskResult = z.object({
  updated: z.number().int(),
  skipped: z.array(z.object({ id: z.uuid(), reason: z.string() })),
});
export type BulkTaskResult = z.infer<typeof BulkTaskResult>;

// ---------- Recurrence (series and templates) ----------

/**
 * Where a series repeats within its unit: `weekdays` (0 Sunday to 6) for a weekly series;
 * `monthly: 'DAY_OF_MONTH'` (the start date's day; a 31st in a short month falls on the month's
 * last day) or `'NTH_WEEKDAY'` with `nth` (1 to 5, 5 meaning the last) and `weekday` for a
 * monthly one. Quarterly is every 3 months and yearly the start date's day each year.
 */
export const RecurrencePattern = z
  .strictObject({
    weekdays: z.array(z.number().int().min(0).max(6)).min(1).max(7).optional(),
    monthly: z.enum(['DAY_OF_MONTH', 'NTH_WEEKDAY']).optional(),
    nth: z.number().int().min(1).max(5).optional(),
    weekday: z.number().int().min(0).max(6).optional(),
  })
  .refine((p) => p.monthly !== 'NTH_WEEKDAY' || (p.nth !== undefined && p.weekday !== undefined), {
    message: 'Choose which weekday of the month',
    path: ['nth'],
  });
export type RecurrencePattern = z.infer<typeof RecurrencePattern>;

const recurrenceShape = {
  /** Repeat every N units. */
  interval: z.number().int().min(1).max(365).default(1),
  unit: RecurrenceUnit,
  pattern: RecurrencePattern.default({}),
  endMode: RecurrenceEnd.default('NEVER'),
  /** With `AFTER_COUNT`: exactly this many scheduled occurrences. */
  endAfterCount: z.number().int().min(1).max(1000).nullable().default(null),
  /** With `ON_DATE`: none after it. */
  endOn: CalendarDate.nullable().default(null),
  /** Move a date that falls on a weekend or holiday. */
  holidayRule: HolidayRule.default('NEXT_BUSINESS_DAY'),
};

/** How a series ends must agree with its count and end date; `startOn` when the schema has one. */
function endRules<
  T extends z.ZodType<{
    endMode: 'NEVER' | 'AFTER_COUNT' | 'ON_DATE';
    endAfterCount: number | null;
    endOn: string | null;
    startOn?: string;
  }>,
>(schema: T) {
  return schema
    .refine((r) => r.endMode !== 'AFTER_COUNT' || r.endAfterCount !== null, {
      message: 'Enter how many',
      path: ['endAfterCount'],
    })
    .refine((r) => r.endMode !== 'ON_DATE' || r.endOn !== null, {
      message: 'Choose the end date',
      path: ['endOn'],
    })
    .refine((r) => r.endOn === null || r.startOn === undefined || r.endOn >= r.startOn, {
      message: 'End on or after the start',
      path: ['endOn'],
    })
    .refine((r) => r.endMode === 'AFTER_COUNT' || r.endAfterCount === null, {
      message: 'Use a count only with "end after"',
      path: ['endAfterCount'],
    })
    .refine((r) => r.endMode === 'ON_DATE' || r.endOn === null, {
      message: 'Use an end date only with "end on"',
      path: ['endOn'],
    });
}

export const Recurrence = endRules(
  z.strictObject({
    ...recurrenceShape,
    /** The first due date. Fixed once the series is made. */
    startOn: CalendarDate,
  }),
);
export type Recurrence = z.input<typeof Recurrence>;
export type RecurrenceOut = z.output<typeof Recurrence>;

/** POST /business/task-series/preview: the next due dates for unsaved settings. Saves nothing. */
export const SeriesPreviewRequest = z.strictObject({
  recurrence: Recurrence,
  /** How many dates to show (default 6). */
  count: z.number().int().min(1).max(24).default(6),
});
export type SeriesPreviewRequest = z.input<typeof SeriesPreviewRequest>;
export const SeriesPreview = z.object({
  dates: z.array(z.object({ scheduledOn: CalendarDate, dueOn: CalendarDate })),
  /** The series ends before `count` dates: how many there are. */
  endsAfter: z.number().int().nullable(),
});
export type SeriesPreview = z.infer<typeof SeriesPreview>;

// ---------- Task templates ----------

export const TemplateChecklistItem = z.strictObject({
  label: text(300),
  required: z.boolean().default(false),
});

export const TaskTemplate = z.object({
  id: z.uuid(),
  name: z.string(),
  description: z.string().nullable(),
  type: TaskLink.nullable(),
  service: TaskLink.nullable(),
  priority: TaskPriority,
  assignmentRule: TaskAssignmentRule,
  /** With `SPECIFIC_USER`. */
  assignedTo: MemberRef.nullable(),
  /** The due date is this many days after the task is made. */
  dueOffsetDays: z.number().int().nullable(),
  clientVisibleDefault: z.boolean(),
  checklist: z.array(z.object({ label: z.string(), required: z.boolean() })),
  reminders: z.array(ReminderRuleOut),
  recurrence: z.record(z.string(), z.unknown()).nullable(),
  archivedAt: DateTime.nullable(),
  createdBy: MemberRef.nullable(),
  updatedAt: DateTime,
  version: z.string(),
});
export type TaskTemplate = z.infer<typeof TaskTemplate>;
export const TaskTemplateList = z.object({ items: z.array(TaskTemplate) });
export type TaskTemplateList = z.infer<typeof TaskTemplateList>;

export const TaskTemplatesQuery = z.strictObject({
  status: z.enum(['active', 'archived', 'all']).optional().default('active'),
  search: SearchText.optional(),
});
export type TaskTemplatesQuery = z.input<typeof TaskTemplatesQuery>;

const templateFields = {
  name: text(120),
  description: clearable(text(2_000, 'many')),
  typeId: z.uuid().nullable().optional(),
  serviceId: z.uuid().nullable().optional(),
  priority: TaskPriority.optional(),
  assignmentRule: TaskAssignmentRule.optional(),
  /** Required with `SPECIFIC_USER`, refused otherwise. */
  assignedUserId: z.uuid().nullable().optional(),
  dueOffsetDays: z.number().int().min(0).max(730).nullable().optional(),
  clientVisibleDefault: z.boolean().optional(),
  checklist: z.array(TemplateChecklistItem).max(50).optional(),
  reminders: z.array(ReminderRule).max(10).optional(),
  recurrence: Recurrence.nullable().optional(),
};

/** Names are unique ignoring case (409 DUPLICATE_NAME). */
export const CreateTaskTemplateRequest = z.strictObject(templateFields);
export type CreateTaskTemplateRequest = z.input<typeof CreateTaskTemplateRequest>;
export const UpdateTaskTemplateRequest = z
  .strictObject(templateFields)
  .partial()
  .extend({ version: z.string().min(1).max(100) });
export type UpdateTaskTemplateRequest = z.input<typeof UpdateTaskTemplateRequest>;

/** POST /business/tasks/{id}/save-as-template: a template from the task's current settings. */
export const SaveTaskAsTemplateRequest = z.strictObject({ name: text(120) });
export type SaveTaskAsTemplateRequest = z.input<typeof SaveTaskAsTemplateRequest>;

// ---------- Recurring series ----------

/** What every task of the series starts with, a snapshot taken when the task is made. */
const seriesDefaults = {
  title: text(200),
  details: clearable(text(2_000, 'many')),
  engagementId: z.uuid().nullable().optional(),
  serviceId: z.uuid().nullable().optional(),
  typeId: z.uuid().nullable().optional(),
  priority: TaskPriority.optional(),
  assignmentRule: TaskAssignmentRule.optional(),
  /** Required with `SPECIFIC_USER`, refused otherwise. */
  assignedUserId: z.uuid().nullable().optional(),
  extraAssigneeIds: z.array(z.uuid()).max(20).optional(),
  /** Make each task at the start of its period instead of `leadDays` before its due date. */
  createAtPeriodStart: z.boolean().optional(),
  leadDays: z.number().int().min(0).max(90).nullable().optional(),
  linkTaxCalendar: z.boolean().optional(),
  dueTime: TaskTimeOfDay.nullable().optional(),
  clientVisible: z.boolean().optional(),
  /** Needs `clientVisible`. */
  notifyClient: z.boolean().optional(),
  checklist: z.array(TemplateChecklistItem).max(50).optional(),
  reminders: z.array(ReminderRule).max(10).optional(),
};

/** POST /business/task-series. The client and the start date cannot change afterwards. */
export const CreateTaskSeriesRequest = z.strictObject({
  clientId: z.uuid(),
  ...seriesDefaults,
  recurrence: Recurrence,
  templateId: TaskTemplateId.optional(),
});
export type CreateTaskSeriesRequest = z.input<typeof CreateTaskSeriesRequest>;

export const TaskSeriesEditScope = z.enum([
  /** The definition and the occurrences not made yet; every task already made stays as it is. */
  'FUTURE',
  /** As FUTURE, and the tasks of the series that are still OPEN take the new title, details, type, service and priority. Done or cancelled tasks are never rewritten. */
  'ENTIRE',
]);
export type TaskSeriesEditScope = z.infer<typeof TaskSeriesEditScope>;

/**
 * PATCH /business/task-series/{id}: only the fields sent change. Editing one generated task is a
 * PATCH of that task ("this occurrence only"). Changing the recurrence recalculates the
 * occurrences not made yet (never the made ones).
 */
export const UpdateTaskSeriesRequest = z.strictObject({
  scope: TaskSeriesEditScope,
  version: z.string().min(1).max(100),
  ...seriesDefaults,
  title: seriesDefaults.title.optional(),
  recurrence: z
    .strictObject({
      interval: z.number().int().min(1).max(365).optional(),
      unit: RecurrenceUnit.optional(),
      pattern: RecurrencePattern.optional(),
      endMode: RecurrenceEnd.optional(),
      endAfterCount: z.number().int().min(1).max(1000).nullable().optional(),
      endOn: CalendarDate.nullable().optional(),
      holidayRule: HolidayRule.optional(),
    })
    .optional(),
});
export type UpdateTaskSeriesRequest = z.input<typeof UpdateTaskSeriesRequest>;

export const TaskSeriesRow = z.object({
  id: z.uuid(),
  title: z.string(),
  client: z.object({ id: z.uuid(), displayName: z.string() }),
  type: TaskLink.nullable(),
  priority: TaskPriority,
  assignedTo: MemberRef.nullable(),
  /** "Every 2 weeks" etc., worded by the API. */
  summary: z.string(),
  status: TaskSeriesStatus,
  /** The next due date still to be made, null when none is left. */
  nextDueOn: CalendarDate.nullable(),
  generatedCount: z.number().int(),
  updatedAt: DateTime,
});
export type TaskSeriesRow = z.infer<typeof TaskSeriesRow>;

export const TaskSeriesDetail = TaskSeriesRow.extend({
  details: z.string().nullable(),
  engagementId: z.uuid().nullable(),
  service: TaskLink.nullable(),
  assignmentRule: TaskAssignmentRule,
  extraAssignees: z.array(MemberRef),
  recurrence: z.object({
    interval: z.number().int(),
    unit: RecurrenceUnit,
    pattern: z.record(z.string(), z.unknown()),
    startOn: CalendarDate,
    endMode: RecurrenceEnd,
    endAfterCount: z.number().int().nullable(),
    endOn: CalendarDate.nullable(),
    holidayRule: HolidayRule,
  }),
  createAtPeriodStart: z.boolean(),
  leadDays: z.number().int().nullable(),
  linkTaxCalendar: z.boolean(),
  dueTime: TaskTimeOfDay.nullable(),
  clientVisible: z.boolean(),
  notifyClient: z.boolean(),
  checklist: z.array(z.object({ label: z.string(), required: z.boolean() })),
  reminders: z.array(ReminderRuleOut),
  /** The next few due dates, calculated now (up to 6). */
  upcoming: z.array(z.object({ scheduledOn: CalendarDate, dueOn: CalendarDate })),
  pausedAt: DateTime.nullable(),
  endedAt: DateTime.nullable(),
  createdBy: MemberRef.nullable(),
  createdAt: DateTime,
  version: z.string(),
});
export type TaskSeriesDetail = z.infer<typeof TaskSeriesDetail>;

export const TaskSeriesQuery = z.strictObject({
  status: TaskSeriesStatus.optional(),
  clientId: z.uuid().optional(),
  search: SearchText.optional(),
  page: z.coerce.number().int().min(1).optional().default(1),
  pageSize: z.coerce.number().int().min(1).max(100).optional().default(10),
});
export type TaskSeriesQuery = z.input<typeof TaskSeriesQuery>;
export const TaskSeriesPage = z.object({ items: z.array(TaskSeriesRow).max(100), ...Page });
export type TaskSeriesPage = z.infer<typeof TaskSeriesPage>;

export const TaskOccurrence = z.object({
  id: z.uuid(),
  scheduledOn: CalendarDate,
  dueOn: CalendarDate,
  state: TaskOccurrenceState,
  /** The task made, with GENERATED. */
  taskId: z.uuid().nullable(),
  skipReason: z.string().nullable(),
  generatedAt: DateTime.nullable(),
});
export type TaskOccurrence = z.infer<typeof TaskOccurrence>;

export const TaskOccurrencesQuery = z.strictObject({
  state: TaskOccurrenceState.optional(),
  page: z.coerce.number().int().min(1).optional().default(1),
  pageSize: z.coerce.number().int().min(1).max(100).optional().default(20),
});
export type TaskOccurrencesQuery = z.input<typeof TaskOccurrencesQuery>;
export const TaskOccurrencePage = z.object({ items: z.array(TaskOccurrence), ...Page });
export type TaskOccurrencePage = z.infer<typeof TaskOccurrencePage>;

export const SkipOccurrenceRequest = z.strictObject({ reason: clearable(text(500, 'many')) });
export type SkipOccurrenceRequest = z.input<typeof SkipOccurrenceRequest>;

/** POST /business/task-series/{id}/skip-future: skips every occurrence not made yet. */
export const SkipFutureRequest = z.strictObject({ confirm: z.literal(true) });
export type SkipFutureRequest = z.input<typeof SkipFutureRequest>;

/** POST /business/tasks/{id}/convert-to-recurring: the task becomes the first occurrence. */
export const ConvertToRecurringRequest = z.strictObject({
  recurrence: endRules(z.strictObject(recurrenceShape)),
});
export type ConvertToRecurringRequest = z.input<typeof ConvertToRecurringRequest>;

export const TaskWorkErrorCode = z.enum([
  /** 409: another task, type, template or series has this name. */
  'DUPLICATE_NAME',
  /** 409: someone saved after it was loaded. */
  'SAVE_CONFLICT',
  /** 409: completing a task with a required checklist item still open. */
  'REQUIRED_ITEMS_OPEN',
  /** 409: completing a task whose prerequisite is not done. */
  'DEPENDENCY_OPEN',
  /** 400: the prerequisite would make a loop. */
  'DEPENDENCY_CYCLE',
  /** 409: the task type is archived. */
  'TYPE_ARCHIVED',
  /** 400: a reminder after the due date, or a reminder on a task with no due date. */
  'INVALID_REMINDER',
  /** 400: the recurrence settings conflict (the message says how). */
  'INVALID_RECURRENCE',
  /** 409: the series is paused, ended or archived. */
  'SERIES_NOT_ACTIVE',
  /** 409: the occurrence is already made or skipped. */
  'OCCURRENCE_CLOSED',
  /** 409: the task is done, cancelled or archived: reopen or restore it before this change. */
  'TASK_CLOSED',
  /** 409: the document is not one of the task's client's, or is internal and made visible. */
  'ATTACHMENT_NOT_ALLOWED',
]);
export type TaskWorkErrorCode = z.infer<typeof TaskWorkErrorCode>;
