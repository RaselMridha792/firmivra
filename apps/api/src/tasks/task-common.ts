import { BadRequestException } from '@nestjs/common';
import type { Prisma, TaskStatus as StoredTaskStatus } from '@firmivra/db';
import type {
  ChecklistItem,
  MemberRef,
  ReminderRuleOut,
  TaskAttachment,
  TaskDetail,
  TaskDraft,
  TaskDraftRow,
  TaskRow,
  TaskStatus,
  TaskWorkErrorCode,
} from '@firmivra/types';
import { assignee, conflict, day, memberRef } from '../workspaces/common.js';
import { timeOfDayFromDb } from '../appointments/calendar.js';

// ---------- Live tasks and drafts ----------

/**
 * Every task but a draft (Save as Draft, R1 Oct 24). A draft is not live yet: only the Drafts
 * routes (task-drafts.service.ts) read it, so every other read of tasks merges this in, unless
 * its filter already pins a status that is not DRAFT.
 */
export const LIVE_TASK: Prisma.TaskWhereInput = { status: { not: 'DRAFT' } };

/** A live task's status as the contract has it: never DRAFT (see LIVE_TASK). */
export function liveStatus(status: StoredTaskStatus): TaskStatus {
  if (status === 'DRAFT') throw new Error('A draft is not a live task');
  return status;
}

/**
 * A live task's client, or its id: only a draft may have none (tasks_client_unless_draft), and
 * every read but the Drafts routes' leaves drafts out (LIVE_TASK).
 */
export function liveClient<T>(client: T | null): T {
  if (client === null) throw new Error('A live task has a client');
  return client;
}

/** The errors of the Tasks module beyond TaskErrorCode (codes in packages/types/src/tasks). */
const code = (c: TaskWorkErrorCode, message: string) => conflict(c, message);

export const taskErrors = {
  duplicateName: (what: string) =>
    code('DUPLICATE_NAME', `A ${what} with this name already exists`),
  saveConflict: () =>
    code('SAVE_CONFLICT', 'Someone saved this after you opened it. Reload and try again.'),
  requiredItemsOpen: () =>
    code('REQUIRED_ITEMS_OPEN', 'Complete the required checklist items first'),
  dependencyOpen: () => code('DEPENDENCY_OPEN', 'Complete the task this one depends on first'),
  typeArchived: () => code('TYPE_ARCHIVED', 'This task type is archived. Choose another.'),
  attachmentNotAllowed: () =>
    code(
      'ATTACHMENT_NOT_ALLOWED',
      "Attach one of this client's documents; an internal document cannot be shown to the client",
    ),
  seriesNotActive: () => code('SERIES_NOT_ACTIVE', 'This recurring task is not active'),
  occurrenceClosed: () => code('OCCURRENCE_CLOSED', 'This occurrence is already made or skipped'),
  /** 400 with one of TaskWorkErrorCode's codes (the request is well formed but cannot be kept). */
  bad: (c: 'DEPENDENCY_CYCLE' | 'INVALID_REMINDER' | 'INVALID_RECURRENCE', message: string) =>
    new BadRequestException({ code: c, message }),
  /** A request that passed the contract but names something that is not the firm's, or too long. */
  invalid: (path: string, message: string) =>
    new BadRequestException({
      code: 'VALIDATION_FAILED',
      message: 'The request is not valid',
      details: [{ path, message }],
    }),
};

// ---------- What a task is read with ----------

const memberSelect = { userId: true, user: { select: { name: true } } } as const;

export const rowInclude = {
  client: { select: { id: true, displayName: true } },
  assignedMember: { select: memberSelect },
  type: { select: { id: true, name: true } },
  service: { select: { id: true, name: true } },
  engagement: { select: { id: true, title: true } },
  deadline: { select: { id: true, name: true } },
  dependsOn: { select: { id: true, title: true, status: true } },
  taskOccurrence: { select: { seriesId: true } },
  _count: { select: { assignees: true } },
} satisfies Prisma.TaskInclude;

export const detailInclude = {
  ...rowInclude,
  assignees: { select: { member: { select: memberSelect } }, orderBy: { createdAt: 'asc' } },
  taskChecklistItems: {
    orderBy: [{ position: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
    include: { assignedMember: { select: memberSelect } },
  },
  taskReminders: { orderBy: [{ daysBefore: 'desc' }, { timeOfDay: 'asc' }, { id: 'asc' }] },
  taskAttachments: {
    orderBy: { createdAt: 'asc' },
    include: { document: { select: { fileName: true, contentType: true, sizeBytes: true } } },
  },
  taskOccurrence: {
    select: { seriesId: true, series: { select: { id: true, title: true } } },
  },
} satisfies Prisma.TaskInclude;

export type RowShape = Prisma.TaskGetPayload<{ include: typeof rowInclude }>;
export type DetailShape = Prisma.TaskGetPayload<{ include: typeof detailInclude }>;

/** What a row of the Drafts tab is read with. */
export const draftRowInclude = {
  client: { select: { id: true, displayName: true } },
  assignedMember: { select: memberSelect },
  type: { select: { id: true, name: true } },
  service: { select: { id: true, name: true } },
} satisfies Prisma.TaskInclude;

export type DraftRowShape = Prisma.TaskGetPayload<{ include: typeof draftRowInclude }>;

/** Whether an OPEN task is past due in the firm's time zone (`today` is the firm's date). */
export function isOverdue(
  t: { status: string; dueOn: Date | null; dueTime: Date | null; allDay: boolean },
  today: string,
  nowMinutes: number,
): boolean {
  if (t.status !== 'OPEN' || !t.dueOn) return false;
  const due = day(t.dueOn)!;
  if (due !== today) return due < today;
  if (t.allDay || !t.dueTime) return false;
  const [h, m] = timeOfDayFromDb(t.dueTime).split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0) < nowMinutes;
}

export interface RowContext {
  today: string;
  nowMinutes: number;
  /** Checklist steps done, by task id (those with none are missing). */
  done: Map<string, number>;
  /** Checklist steps in all, by task id. */
  total: Map<string, number>;
}

export function toRow(t: RowShape, ctx: RowContext): TaskRow {
  const client = liveClient(t.client);
  return {
    id: t.id,
    title: t.title,
    kind: t.kind,
    client: { id: client.id, displayName: client.displayName },
    type: t.type ? { id: t.type.id, name: t.type.name } : null,
    engagement: t.engagement ? { id: t.engagement.id, title: t.engagement.title } : null,
    service: t.service ? { id: t.service.id, name: t.service.name } : null,
    deadline: t.deadline ? { id: t.deadline.id, name: t.deadline.name } : null,
    priority: t.priority,
    status: liveStatus(t.status),
    progress: t.progress,
    dueOn: day(t.dueOn),
    dueTime: t.dueTime ? timeOfDayFromDb(t.dueTime) : null,
    allDay: t.allDay,
    overdue: isOverdue(t, ctx.today, ctx.nowMinutes),
    assignedTo: assignee(t.assignedMember),
    additionalAssigneeCount: t._count.assignees,
    checklist: { done: ctx.done.get(t.id) ?? 0, total: ctx.total.get(t.id) ?? 0 },
    blocked: t.dependsOn !== null && t.dependsOn.status !== 'DONE',
    recurring: t.taskOccurrence !== null,
    clientVisible: t.clientVisible,
    archivedAt: t.archivedAt?.toISOString() ?? null,
    updatedAt: t.updatedAt.toISOString(),
  };
}

/** A task's checklist, reminders and attachments, as a TaskDetail or a TaskDraft has them. */
function checklistOut(t: DetailShape, names: Map<string, string>): ChecklistItem[] {
  return t.taskChecklistItems.map((i) => ({
    id: i.id,
    label: i.label,
    position: i.position,
    required: i.required,
    completedAt: i.completedAt?.toISOString() ?? null,
    completedBy: memberRef(names, i.completedByUserId),
    assignedTo: assignee(i.assignedMember),
  }));
}

function remindersOut(t: DetailShape): ReminderRuleOut[] {
  return t.taskReminders.map((r) => ({
    id: r.id,
    daysBefore: r.daysBefore,
    timeOfDay: r.timeOfDay ? timeOfDayFromDb(r.timeOfDay) : null,
    inApp: r.inApp,
    channels: r.channels,
  }));
}

function attachmentsOut(t: DetailShape, names: Map<string, string>): TaskAttachment[] {
  return t.taskAttachments.map((a) => ({
    id: a.id,
    documentId: a.documentId,
    fileName: a.document.fileName,
    contentType: a.document.contentType,
    sizeBytes: a.document.sizeBytes,
    clientVisible: a.clientVisible,
    addedBy: memberRef(names, a.addedByUserId),
    addedAt: a.createdAt.toISOString(),
  }));
}

/** The prerequisite: always a live task (a draft is never one). */
const dependsOnOut = (t: DetailShape) =>
  t.dependsOn
    ? { id: t.dependsOn.id, title: t.dependsOn.title, status: liveStatus(t.dependsOn.status) }
    : null;

export function toDetail(t: DetailShape, names: Map<string, string>, ctx: RowContext): TaskDetail {
  const items = checklistOut(t, names);
  const withTotals: RowContext = {
    ...ctx,
    done: new Map([[t.id, items.filter((i) => i.completedAt).length]]),
    total: new Map([[t.id, items.length]]),
  };
  return {
    ...toRow(t, withTotals),
    details: t.details,
    engagementId: t.engagementId,
    startOn: day(t.startOn),
    assignedUserId: t.assignedUserId,
    additionalAssignees: t.assignees.map((a): MemberRef => assignee(a.member)!),
    checklistItems: items,
    reminders: remindersOut(t),
    attachments: attachmentsOut(t, names),
    dependsOn: dependsOnOut(t),
    blockedReason: t.blockedReason,
    internalNotes: t.internalNotes,
    templateId: t.templateId,
    series: t.taskOccurrence?.series
      ? { id: t.taskOccurrence.series.id, title: t.taskOccurrence.series.title }
      : null,
    completedAt: t.completedAt?.toISOString() ?? null,
    completedBy: memberRef(names, t.completedByUserId),
    createdBy: memberRef(names, t.createdByUserId),
    createdAt: t.createdAt.toISOString(),
    version: t.updatedAt.toISOString(),
  };
}

/** One row of the Drafts tab (contract in packages/types/src/tasks/drafts.ts). */
export function toDraftRow(t: DraftRowShape, names: Map<string, string>): TaskDraftRow {
  return {
    id: t.id,
    title: t.title,
    client: t.client ? { id: t.client.id, displayName: t.client.displayName } : null,
    type: t.type ? { id: t.type.id, name: t.type.name } : null,
    service: t.service ? { id: t.service.id, name: t.service.name } : null,
    priority: t.priority,
    dueOn: day(t.dueOn),
    assignedTo: assignee(t.assignedMember),
    createdBy: memberRef(names, t.createdByUserId),
    // Publishing needs a client; everything else a draft holds can be published as it is checked.
    missing: t.clientId ? [] : ['clientId'],
    createdAt: t.createdAt.toISOString(),
    updatedAt: t.updatedAt.toISOString(),
  };
}

/** A draft with everything the Create Task form shows. */
export function toDraft(t: DetailShape, names: Map<string, string>): TaskDraft {
  return {
    ...toDraftRow(t, names),
    status: 'DRAFT',
    details: t.details,
    engagement: t.engagement ? { id: t.engagement.id, title: t.engagement.title } : null,
    progress: t.progress,
    startOn: day(t.startOn),
    dueTime: t.dueTime ? timeOfDayFromDb(t.dueTime) : null,
    allDay: t.allDay,
    clientVisible: t.clientVisible,
    internalNotes: t.internalNotes,
    blockedReason: t.blockedReason,
    assignedUserId: t.assignedUserId,
    additionalAssignees: t.assignees.map((a): MemberRef => assignee(a.member)!),
    checklistItems: checklistOut(t, names),
    reminders: remindersOut(t),
    attachments: attachmentsOut(t, names),
    dependsOn: dependsOnOut(t),
    templateId: t.templateId,
    version: t.updatedAt.toISOString(),
  };
}
