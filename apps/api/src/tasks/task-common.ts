import { BadRequestException } from '@nestjs/common';
import type { Prisma } from '@firmivra/db';
import type {
  ChecklistItem,
  MemberRef,
  ReminderRuleOut,
  TaskAttachment,
  TaskDetail,
  TaskRow,
  TaskWorkErrorCode,
} from '@firmivra/types';
import { assignee, conflict, day, memberRef } from '../workspaces/common.js';
import { timeOfDayFromDb } from '../appointments/calendar.js';

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
  return {
    id: t.id,
    title: t.title,
    kind: t.kind,
    client: { id: t.client.id, displayName: t.client.displayName },
    type: t.type ? { id: t.type.id, name: t.type.name } : null,
    engagement: t.engagement ? { id: t.engagement.id, title: t.engagement.title } : null,
    service: t.service ? { id: t.service.id, name: t.service.name } : null,
    deadline: t.deadline ? { id: t.deadline.id, name: t.deadline.name } : null,
    priority: t.priority,
    status: t.status,
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

export function toDetail(t: DetailShape, names: Map<string, string>, ctx: RowContext): TaskDetail {
  const items: ChecklistItem[] = t.taskChecklistItems.map((i) => ({
    id: i.id,
    label: i.label,
    position: i.position,
    required: i.required,
    completedAt: i.completedAt?.toISOString() ?? null,
    completedBy: memberRef(names, i.completedByUserId),
    assignedTo: assignee(i.assignedMember),
  }));
  const reminders: ReminderRuleOut[] = t.taskReminders.map((r) => ({
    id: r.id,
    daysBefore: r.daysBefore,
    timeOfDay: r.timeOfDay ? timeOfDayFromDb(r.timeOfDay) : null,
    inApp: r.inApp,
    channels: r.channels,
  }));
  const attachments: TaskAttachment[] = t.taskAttachments.map((a) => ({
    id: a.id,
    documentId: a.documentId,
    fileName: a.document.fileName,
    contentType: a.document.contentType,
    sizeBytes: a.document.sizeBytes,
    clientVisible: a.clientVisible,
    addedBy: memberRef(names, a.addedByUserId),
    addedAt: a.createdAt.toISOString(),
  }));
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
    reminders,
    attachments,
    dependsOn: t.dependsOn
      ? { id: t.dependsOn.id, title: t.dependsOn.title, status: t.dependsOn.status }
      : null,
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
