import { z } from 'zod';
import { MemberRef } from '../clients/schemas.js';
import { text } from '../clients/text.js';

// Tasks Review Two T-C01 and T-C02 (Q36; the client's decisions in the lead's DECISIONS.md,
// Nov 16): assignment acknowledgment and the task's internal discussion.
// Routes: /business/tasks/{id}/acknowledgements, /business/tasks/{id}/acknowledge,
// /business/tasks/acknowledgements/pending and /business/tasks/{id}/comments. Firm staff who
// reach the task only; never a portal route, never shown to the client.

const DateTime = z.iso.datetime({ offset: true });

// ---------- T-C01 acknowledgment ----------

/**
 * One assignee's acknowledgment on a task. It is required only when the person who assigned the
 * task has the same firm role as the assignee and is someone else (a higher role assigns without
 * one: Owner, then Admin, then Manager, then every other role). If it is not given within one
 * business day, the assignee and the assigner get one reminder; the task stays valid either way.
 */
export const TaskAcknowledgement = z.object({
  assignee: MemberRef,
  required: z.boolean(),
  /** When the one reminder goes out if nobody has acknowledged (required only). */
  dueAt: DateTime.nullable(),
  acknowledgedAt: DateTime.nullable(),
  acknowledgedBy: MemberRef.nullable(),
  /** The reminder went out (once). */
  reminderSentAt: DateTime.nullable(),
});
export type TaskAcknowledgement = z.infer<typeof TaskAcknowledgement>;

export const TaskAcknowledgements = z.object({
  items: z.array(TaskAcknowledgement),
  /** The signed-in member has a required acknowledgment still to give on this task. */
  mine: z.enum(['NONE', 'PENDING', 'DONE']),
});
export type TaskAcknowledgements = z.infer<typeof TaskAcknowledgements>;

/** The open tasks the signed-in member still has to acknowledge (the My Tasks badge). */
export const PendingTaskAcknowledgements = z.object({
  items: z.array(z.object({ taskId: z.uuid(), dueAt: DateTime })),
});
export type PendingTaskAcknowledgements = z.infer<typeof PendingTaskAcknowledgements>;

// ---------- T-C02 discussion ----------

/** Internal only: staff who reach the task. An author edits their own comment for 15 minutes. */
export const TASK_COMMENT_EDIT_MINUTES = 15;

export const TaskComment = z.object({
  id: z.uuid(),
  author: MemberRef.nullable(),
  body: z.string(),
  createdAt: DateTime,
  updatedAt: DateTime,
  /** It was changed after it was posted. */
  edited: z.boolean(),
  /** The signed-in member wrote it and the 15 minutes are not over. */
  canEdit: z.boolean(),
  /** The signed-in member wrote it. */
  canDelete: z.boolean(),
});
export type TaskComment = z.infer<typeof TaskComment>;

export const TaskComments = z.object({ items: z.array(TaskComment) });
export type TaskComments = z.infer<typeof TaskComments>;

export const CreateTaskCommentRequest = z.strictObject({
  body: text(4000, 'many', 'Write a comment.'),
  /** Staff to notify besides the task's assignees (@mentions): active members of the firm. */
  mentionUserIds: z.array(z.uuid()).max(20, 'Mention at most 20 people.').optional(),
});
export type CreateTaskCommentRequest = z.input<typeof CreateTaskCommentRequest>;

export const UpdateTaskCommentRequest = z.strictObject({
  body: text(4000, 'many', 'Write a comment.'),
});
export type UpdateTaskCommentRequest = z.input<typeof UpdateTaskCommentRequest>;

export const TaskCommentId = z.uuid();
