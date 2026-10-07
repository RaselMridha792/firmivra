import { z } from 'zod';
import { MemberRef } from '../clients/schemas.js';
import { clearable, text } from '../clients/text.js';

// Tasks (R12): the firm's to-dos for a client, optionally within one of that client's engagements
// (the client record's Tasks tab and the service workspaces). Never shown to clients.
// Firm routes: /api/v1/business/tasks. Owner and Admin see and change every task of the firm.
// Staff, by the calendar's rule (R12 Decisions):
// - see and change the tasks of clients assigned to them and the tasks assigned to them; any other
//   task is 404, like client records;
// - create tasks only for clients assigned to them (404 otherwise), assigned to anyone at the firm.
// R10 creates the client's NAME_CHANGE task; it is listed and closed here like any other.
// Responses are plain objects; requests are strict.

const DateTime = z.iso.datetime({ offset: true });
const CalendarDate = z.iso.date();

export const TaskId = z.uuid();
/** GENERAL, or a client's "Request Name Change" from the portal (R10). */
export const TaskKind = z.enum(['GENERAL', 'NAME_CHANGE']);
export type TaskKind = z.infer<typeof TaskKind>;
export const TaskStatus = z.enum(['OPEN', 'DONE', 'CANCELLED']);
export type TaskStatus = z.infer<typeof TaskStatus>;

export const Task = z.object({
  id: z.uuid(),
  client: z.object({ id: z.uuid(), displayName: z.string() }),
  engagementId: z.uuid().nullable(),
  title: z.string(),
  details: z.string().nullable(),
  kind: TaskKind,
  status: TaskStatus,
  dueOn: CalendarDate.nullable(),
  assignedTo: MemberRef.nullable(),
  completedAt: DateTime.nullable(),
  createdBy: MemberRef.nullable(),
  createdAt: DateTime,
  updatedAt: DateTime,
});
export type Task = z.infer<typeof Task>;

/**
 * GET /business/tasks: open tasks first by due date (no date last), then the rest newest first.
 * Filter by client, engagement, assignee or status; pages of up to 100.
 */
export const ListTasksQuery = z.strictObject({
  clientId: z.uuid().optional(),
  engagementId: z.uuid().optional(),
  assignedUserId: z.uuid().optional(),
  status: TaskStatus.optional(),
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional().default(50),
});
export type ListTasksQuery = z.input<typeof ListTasksQuery>;

export const TaskList = z.object({
  items: z.array(Task).max(100),
  /** Null on the last page. */
  nextCursor: z.string().nullable(),
});
export type TaskList = z.infer<typeof TaskList>;

/** A new GENERAL task. The engagement, when given, must be this client's. '' or null: no details. */
export const CreateTaskRequest = z.strictObject({
  clientId: z.uuid(),
  engagementId: z.uuid().optional(),
  title: text(200),
  details: clearable(text(5_000, 'many')),
  dueOn: CalendarDate.optional(),
  assignedUserId: z.uuid().optional(),
});
export type CreateTaskRequest = z.input<typeof CreateTaskRequest>;

/** Send only what changes; `null` clears details, due date or assignee. DONE sets completedAt. */
export const UpdateTaskRequest = z
  .strictObject({
    title: text(200).optional(),
    details: clearable(text(5_000, 'many')),
    dueOn: CalendarDate.nullable().optional(),
    assignedUserId: z.uuid().nullable().optional(),
    status: TaskStatus.optional(),
  })
  .refine((o) => Object.keys(o).length > 0, 'Change at least one field');
export type UpdateTaskRequest = z.input<typeof UpdateTaskRequest>;

export const TaskErrorCode = z.enum([
  /** 409: the engagement is not this client's. */
  'ENGAGEMENT_MISMATCH',
  /** 409: the assignee is not an active member of the firm. */
  'NOT_A_MEMBER',
  /** 409: reopening a NAME_CHANGE task while the client has another open one. */
  'NAME_CHANGE_PENDING',
]);
export type TaskErrorCode = z.infer<typeof TaskErrorCode>;
