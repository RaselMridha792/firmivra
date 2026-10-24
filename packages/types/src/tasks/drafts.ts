import { z } from 'zod';
import { MemberRef } from '../clients/schemas.js';
import { SearchText } from '../clients/text.js';
import { TaskPriority, TaskProgress } from '../db-enums.js';
import { TaskStatus } from './schemas.js';
import {
  ChecklistItem,
  CreateTaskDetailRequest,
  ReminderRuleOut,
  TaskAttachment,
  TaskLink,
  TaskTimeOfDay,
} from './work.js';

// Task drafts (Octavia's Tasks review A2, Rasel Oct 24): Save as Draft, the Drafts tab beside
// Completed Tasks (search, filters, reopen, edit) and Save Task on a draft, which publishes it.
// A draft is a task that is not live yet: no count, list, calendar, reminder, notification,
// automation or client portal sees it, and every task route in ./work.ts and ./schemas.ts answers
// 404 for it. It may have no client: then only its creator sees it, and it has no engagement or
// attachments. A draft with a client follows the tasks' reach rules (Owner and Admin: every draft
// of the firm; Staff: drafts of clients assigned to them). Publishing makes it an OPEN task with
// the same id, and that is when "task created" happens (audit, notifications, automations), once.
// Firm routes under /api/v1/business/tasks/drafts, `@Access('TASKS')` (GET views, POST creates,
// PATCH edits, DELETE deletes). Responses are plain objects; requests are strict.

const DateTime = z.iso.datetime({ offset: true });
const CalendarDate = z.iso.date();
const QueryBool = z.union([z.boolean(), z.stringbool()]);

export const TaskDraftId = z.uuid();

/** What publishing still needs. Empty when the draft can be published. */
export const TaskDraftMissing = z.enum(['clientId']);
export type TaskDraftMissing = z.infer<typeof TaskDraftMissing>;

/** One row of the Drafts tab. */
export const TaskDraftRow = z.object({
  id: z.uuid(),
  title: z.string(),
  /** Null until a client is chosen. */
  client: z.object({ id: z.uuid(), displayName: z.string() }).nullable(),
  type: TaskLink.nullable(),
  service: TaskLink.nullable(),
  priority: TaskPriority,
  dueOn: CalendarDate.nullable(),
  assignedTo: MemberRef.nullable(),
  createdBy: MemberRef.nullable(),
  missing: z.array(TaskDraftMissing),
  createdAt: DateTime,
  updatedAt: DateTime,
});
export type TaskDraftRow = z.infer<typeof TaskDraftRow>;

/** GET /business/tasks/drafts/{id}: the draft with everything the Create Task form shows. */
export const TaskDraft = TaskDraftRow.extend({
  status: z.literal('DRAFT'),
  details: z.string().nullable(),
  engagement: z.object({ id: z.uuid(), title: z.string() }).nullable(),
  progress: TaskProgress,
  startOn: CalendarDate.nullable(),
  dueTime: TaskTimeOfDay.nullable(),
  allDay: z.boolean(),
  clientVisible: z.boolean(),
  internalNotes: z.string().nullable(),
  blockedReason: z.string().nullable(),
  assignedUserId: z.uuid().nullable(),
  additionalAssignees: z.array(MemberRef),
  checklistItems: z.array(ChecklistItem),
  /** As a task's: in the order they fire. */
  reminders: z.array(ReminderRuleOut),
  attachments: z.array(TaskAttachment),
  dependsOn: z.object({ id: z.uuid(), title: z.string(), status: TaskStatus }).nullable(),
  templateId: z.uuid().nullable(),
  /** Send it back on PATCH or publish to guard against a concurrent save (409 SAVE_CONFLICT). */
  version: z.string(),
});
export type TaskDraft = z.infer<typeof TaskDraft>;

export const TaskDraftSort = z.enum(['updated', 'title', 'due', 'priority', 'client']);

/**
 * GET /business/tasks/drafts: the drafts the caller reaches, newest change first by default.
 * `search` matches the title, client name, type and service; `mine`: drafts the caller created.
 * Filters add up.
 */
export const TaskDraftQuery = z.strictObject({
  search: SearchText.optional(),
  clientId: z.uuid().optional(),
  typeId: z.uuid().optional(),
  priority: TaskPriority.optional(),
  assignedUserId: z.uuid().optional(),
  mine: QueryBool.optional(),
  sort: TaskDraftSort.optional().default('updated'),
  direction: z.enum(['asc', 'desc']).optional().default('desc'),
  page: z.coerce.number().int().min(1).optional().default(1),
  pageSize: z.coerce.number().int().min(1).max(100).optional().default(10),
});
export type TaskDraftQuery = z.input<typeof TaskDraftQuery>;

export const TaskDraftPage = z.object({
  items: z.array(TaskDraftRow).max(100),
  total: z.number().int(),
  page: z.number().int(),
  pageSize: z.number().int(),
});
export type TaskDraftPage = z.infer<typeof TaskDraftPage>;

/** Without a client a draft takes no engagement and no attachment (they are the client's). */
const clientFirst = (o: {
  clientId?: string | null;
  engagementId?: string | null;
  attachments?: unknown[];
}) => o.clientId != null || (o.engagementId == null && !o.attachments?.length);
const clientFirstError = {
  message: 'Choose the client first',
  path: ['clientId'],
};

/**
 * POST /business/tasks/drafts: Save as Draft. The fields of CreateTaskDetailRequest, all kept as
 * sent, but only the title is required: the client may come later. Nothing is checked that
 * publishing checks (an assignee's reach, an archived type, reminders without a due date or time,
 * after the due time or at the same moment); the ids sent must still be the firm's (400
 * VALIDATION_FAILED otherwise), and the same reminder twice (or two Custom ones of one length) is
 * 400 INVALID_REMINDER. `templateId` fills the fields the request leaves out, as for a new task,
 * except that the draft keeps all the template's reminders: publishing checks them as if sent.
 */
export const SaveTaskDraftRequest = CreateTaskDetailRequest.extend({
  clientId: z.uuid().optional(),
}).refine(clientFirst, clientFirstError);
export type SaveTaskDraftRequest = z.input<typeof SaveTaskDraftRequest>;

const draftChanges = CreateTaskDetailRequest.omit({ templateId: true })
  .partial()
  .extend({
    /** Setting, changing or clearing the client also clears the engagement and attachments
     * unless the request sends new ones of the new client. */
    clientId: z.uuid().nullable().optional(),
    engagementId: z.uuid().nullable().optional(),
    dueOn: CalendarDate.nullable().optional(),
    assignedUserId: z.uuid().nullable().optional(),
    /** Replaces the attachments. */
    attachments: CreateTaskDetailRequest.shape.attachments,
    version: z.string().min(1).max(100).optional(),
  });

/**
 * PATCH /business/tasks/drafts/{id}: edit a draft; it stays a draft. Only the fields sent change;
 * `null` clears; a list sent replaces the stored one (a checklist item with its `id` keeps its
 * row).
 */
export const UpdateTaskDraftRequest = draftChanges
  .refine(
    (o) => Object.keys(o).filter((k) => k !== 'version').length > 0,
    'Change at least one field',
  )
  .refine(
    (o) => o.clientId !== null || (o.engagementId == null && !o.attachments?.length),
    clientFirstError,
  );
export type UpdateTaskDraftRequest = z.input<typeof UpdateTaskDraftRequest>;

/**
 * POST /business/tasks/drafts/{id}/publish: Save Task on a draft. Applies the fields sent, as
 * PATCH does, then checks the draft as a new task is checked (a client, the engagement, the
 * assignee's reach, an active type, reminders) and makes it an OPEN task with the same id.
 * Answers the TaskDetail (./work.ts). 400 VALIDATION_FAILED naming `clientId` when it has none;
 * the task errors of a new task otherwise. An empty body publishes the draft as saved.
 */
export const PublishTaskDraftRequest = draftChanges.refine(
  (o) => o.clientId !== null || (o.engagementId == null && !o.attachments?.length),
  clientFirstError,
);
export type PublishTaskDraftRequest = z.input<typeof PublishTaskDraftRequest>;

/** DELETE /business/tasks/drafts/{id} discards the draft (with its checklist and reminders). */
