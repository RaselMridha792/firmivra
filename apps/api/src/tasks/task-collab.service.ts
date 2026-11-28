import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  UnprocessableEntityException,
} from '@nestjs/common';
import type { Database, TxClient } from '@firmivra/db';
import {
  type CreateTaskCommentRequest,
  type PendingTaskAcknowledgements,
  TASK_COMMENT_EDIT_MINUTES,
  type TaskAcknowledgements,
  type TaskComment,
  type TaskComments,
  type UpdateTaskCommentRequest,
} from '@firmivra/types';
import type { z } from 'zod';
import { zonedDate } from '../appointments/calendar.js';
import { firmTimeZone } from '../appointments/calendar-data.js';
import { AuditService } from '../audit/audit.service.js';
import type { ClientsActor } from '../clients/clients.service.js';
import { DATABASE } from '../database/database.module.js';
import { errorName, Notifier } from '../notifications/notifier.js';
import { memberNames, memberRef, notFound } from '../workspaces/common.js';
import { LIVE_TASK } from './task-common.js';
import { reach } from './task-read.service.js';

type Out<S extends z.ZodType> = z.output<S>;

const DAY_MS = 86_400_000;
const EDIT_MS = TASK_COMMENT_EDIT_MINUTES * 60_000;

/**
 * T-C01: a firm role's rank for acknowledgment. The client's decision names Owner > Admin > Staff;
 * the firm's Manager role sits between Admin and the rest, and every other role ranks as Staff.
 */
export function roleRank(role: string): number {
  if (role === 'OWNER') return 4;
  if (role === 'ADMIN') return 3;
  if (role === 'MANAGER') return 2;
  return 1;
}

/** Acknowledgment is required when someone else of the same rank assigns the task. */
export const ackRequired = (
  assignerUserId: string,
  assignerRole: string,
  assigneeUserId: string,
  assigneeRole: string,
) => assignerUserId !== assigneeUserId && roleRank(assignerRole) === roleRank(assigneeRole);

/** One business day after `from` in the firm's time zone: Saturday and Sunday do not count. */
export function oneBusinessDayAfter(from: Date, timeZone: string): Date {
  let at = from.getTime() + DAY_MS;
  for (let i = 0; i < 3; i += 1) {
    const weekday = new Date(`${zonedDate(timeZone, at)}T12:00:00Z`).getUTCDay();
    if (weekday !== 0 && weekday !== 6) break;
    at += DAY_MS;
  }
  return new Date(at);
}

const commentErrors = {
  editWindow: () =>
    new ConflictException({
      code: 'EDIT_WINDOW_CLOSED',
      message: `A comment can be changed for ${TASK_COMMENT_EDIT_MINUTES} minutes after it is posted`,
    }),
  notAuthor: () =>
    new ForbiddenException({
      code: 'NOT_AUTHOR',
      message: 'Only its author can change this comment',
    }),
  mention: () =>
    new UnprocessableEntityException({
      code: 'INVALID_MENTION',
      message: 'Mention active members of the firm only',
    }),
  nothingToAcknowledge: () =>
    new ConflictException({
      code: 'NOTHING_TO_ACKNOWLEDGE',
      message: 'You have no acknowledgment to give on this task',
    }),
};

/**
 * Keeps the task's acknowledgment rows in step with its assignees (primary and additional) after
 * an assignment by `assigner`. A new assignee gets a row: required, due one business day later,
 * when the assigner is someone else of the same rank. Someone no longer assigned loses theirs.
 * A row that is already there stays as it is (an acknowledgment given is kept). Returns the
 * assignees whose acknowledgment just became required, for the audit.
 */
export async function syncAcknowledgements(
  tx: TxClient,
  businessId: string,
  taskId: string,
  assignerUserId: string,
  now = new Date(),
): Promise<string[]> {
  const task = await tx.task.findFirst({
    where: { businessId, id: taskId },
    select: { status: true, assignedUserId: true, assignees: { select: { userId: true } } },
  });
  if (!task || task.status === 'DRAFT') return [];
  const assignees = [
    ...new Set(
      [task.assignedUserId, ...task.assignees.map((a) => a.userId)].filter(
        (id): id is string => !!id,
      ),
    ),
  ];
  await tx.taskAcknowledgement.deleteMany({
    where: { businessId, taskId, assigneeUserId: { notIn: assignees } },
  });
  if (assignees.length === 0) return [];
  const existing = new Set(
    (
      await tx.taskAcknowledgement.findMany({
        where: { businessId, taskId },
        select: { assigneeUserId: true },
      })
    ).map((r) => r.assigneeUserId),
  );
  const fresh = assignees.filter((id) => !existing.has(id));
  if (fresh.length === 0) return [];
  const roles = new Map(
    (
      await tx.membership.findMany({
        where: { businessId, userId: { in: [assignerUserId, ...fresh] } },
        select: { userId: true, role: true },
      })
    ).map((m) => [m.userId, m.role as string]),
  );
  const assignerRole = roles.get(assignerUserId);
  const dueAt = oneBusinessDayAfter(now, await firmTimeZone(tx, businessId));
  const required: string[] = [];
  for (const userId of fresh) {
    const role = roles.get(userId);
    const needs =
      !!assignerRole && !!role && ackRequired(assignerUserId, assignerRole, userId, role);
    if (needs) required.push(userId);
    await tx.taskAcknowledgement.create({
      data: {
        businessId,
        taskId,
        assigneeUserId: userId,
        required: needs,
        dueAt: needs ? dueAt : null,
      },
    });
  }
  return required;
}

/** T-C01 acknowledgment and T-C02 discussion on a task, for staff who reach the task. */
@Injectable()
export class TaskCollabService {
  private readonly logger = new Logger('TaskCollab');

  constructor(
    @Inject(DATABASE) private readonly database: Database,
    private readonly audit: AuditService,
    private readonly notifier: Notifier,
  ) {}

  private inFirm<T>(businessId: string, fn: (tx: TxClient) => Promise<T>): Promise<T> {
    return this.database.withScope({ kind: 'business', businessId }, fn);
  }

  /** A live task the actor reaches (404 otherwise). */
  private async task(tx: TxClient, businessId: string, actor: ClientsActor, id: string) {
    const t = await tx.task.findFirst({
      where: { businessId, id, ...LIVE_TASK, ...reach(actor) },
      select: {
        id: true,
        clientId: true,
        title: true,
        assignedUserId: true,
        assignees: { select: { userId: true } },
      },
    });
    if (!t) throw notFound();
    return t;
  }

  // ---------- T-C01 ----------

  async acknowledgements(
    businessId: string,
    actor: ClientsActor,
    id: string,
  ): Promise<TaskAcknowledgements> {
    return this.inFirm(businessId, async (tx) => {
      await this.task(tx, businessId, actor, id);
      return this.ackView(tx, businessId, actor, id);
    });
  }

  /** The assignee acknowledges their own assignment; the assigner gets a bell item. */
  async acknowledge(
    businessId: string,
    actor: ClientsActor,
    id: string,
  ): Promise<TaskAcknowledgements> {
    const { view, assigner } = await this.inFirm(businessId, async (tx) => {
      await this.task(tx, businessId, actor, id);
      const row = await tx.taskAcknowledgement.findUnique({
        where: {
          businessId_taskId_assigneeUserId: {
            businessId,
            taskId: id,
            assigneeUserId: actor.userId,
          },
        },
      });
      if (!row?.required || row.acknowledgedAt) throw commentErrors.nothingToAcknowledge();
      await tx.taskAcknowledgement.update({
        where: {
          businessId_taskId_assigneeUserId: {
            businessId,
            taskId: id,
            assigneeUserId: actor.userId,
          },
        },
        data: { acknowledgedAt: new Date(), acknowledgedByUserId: actor.userId },
      });
      return {
        view: await this.ackView(tx, businessId, actor, id),
        assigner: await assignerOf(tx, businessId, id, actor.userId),
      };
    });
    await this.audit.log(
      'task.acknowledged',
      { type: 'task', id },
      { assigneeUserId: actor.userId },
    );
    if (assigner && assigner !== actor.userId) {
      await this.notifier
        .notify({
          businessId,
          event: 'task.acknowledged',
          recordId: id,
          actorUserId: actor.userId,
          toUserIds: [assigner],
          eventKey: `task.acknowledged:${id}:${actor.userId}`,
        })
        .catch((e: unknown) =>
          this.logger.warn(`task.acknowledged ${id} not written (${errorName(e)})`),
        );
    }
    return view;
  }

  /** The open tasks the actor still has to acknowledge (My Tasks badge). */
  async pending(businessId: string, actor: ClientsActor): Promise<PendingTaskAcknowledgements> {
    return this.inFirm(businessId, async (tx) => {
      const rows = await tx.taskAcknowledgement.findMany({
        where: {
          businessId,
          assigneeUserId: actor.userId,
          required: true,
          acknowledgedAt: null,
          task: { ...LIVE_TASK, status: 'OPEN', archivedAt: null, ...reach(actor) },
        },
        select: { taskId: true, dueAt: true },
        orderBy: [{ dueAt: 'asc' }, { taskId: 'asc' }],
        take: 500,
      });
      return { items: rows.map((r) => ({ taskId: r.taskId, dueAt: r.dueAt!.toISOString() })) };
    });
  }

  private async ackView(
    tx: TxClient,
    businessId: string,
    actor: ClientsActor,
    taskId: string,
  ): Promise<TaskAcknowledgements> {
    const rows = await tx.taskAcknowledgement.findMany({
      where: { businessId, taskId },
      orderBy: [{ createdAt: 'asc' }, { assigneeUserId: 'asc' }],
    });
    const names = await memberNames(
      tx,
      businessId,
      rows.flatMap((r) => [r.assigneeUserId, r.acknowledgedByUserId]),
    );
    const mineRow = rows.find((r) => r.assigneeUserId === actor.userId && r.required);
    return {
      items: rows.flatMap((r) => {
        const assignee = memberRef(names, r.assigneeUserId);
        return assignee
          ? [
              {
                assignee,
                required: r.required,
                dueAt: r.dueAt?.toISOString() ?? null,
                acknowledgedAt: r.acknowledgedAt?.toISOString() ?? null,
                acknowledgedBy: memberRef(names, r.acknowledgedByUserId),
                reminderSentAt: r.reminderSentAt?.toISOString() ?? null,
              },
            ]
          : [];
      }),
      mine: !mineRow ? 'NONE' : mineRow.acknowledgedAt ? 'DONE' : 'PENDING',
    };
  }

  // ---------- T-C02 ----------

  async comments(businessId: string, actor: ClientsActor, id: string): Promise<TaskComments> {
    return this.inFirm(businessId, async (tx) => {
      await this.task(tx, businessId, actor, id);
      const rows = await tx.taskComment.findMany({
        where: { businessId, taskId: id },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      });
      const names = await memberNames(
        tx,
        businessId,
        rows.map((r) => r.authorUserId),
      );
      return { items: rows.map((r) => commentView(r, names, actor.userId)) };
    });
  }

  /** Posts a comment; the task's assignees and the mentioned staff get a bell item. */
  async comment(
    businessId: string,
    actor: ClientsActor,
    id: string,
    body: Out<typeof CreateTaskCommentRequest>,
  ): Promise<TaskComment> {
    const { view, notify } = await this.inFirm(businessId, async (tx) => {
      const task = await this.task(tx, businessId, actor, id);
      const mentions = [...new Set(body.mentionUserIds ?? [])];
      if (mentions.length > 0) {
        const active = await tx.membership.count({
          where: { businessId, userId: { in: mentions }, status: 'ACTIVE' },
        });
        if (active !== mentions.length) throw commentErrors.mention();
      }
      const row = await tx.taskComment.create({
        data: { businessId, taskId: id, authorUserId: actor.userId, body: body.body },
      });
      const names = await memberNames(tx, businessId, [actor.userId]);
      const to = [task.assignedUserId, ...task.assignees.map((a) => a.userId), ...mentions].filter(
        (u): u is string => !!u && u !== actor.userId,
      );
      return { view: commentView(row, names, actor.userId), notify: [...new Set(to)] };
    });
    await this.audit.log(
      'task.comment.created',
      { type: 'task', id },
      { commentId: view.id, mentions: body.mentionUserIds?.length ?? 0 },
    );
    if (notify.length > 0) {
      await this.notifier
        .notify({
          businessId,
          event: 'task.comment',
          recordId: id,
          actorUserId: actor.userId,
          toUserIds: notify.slice(0, 50),
          eventKey: `task.comment:${view.id}`,
        })
        .catch((e: unknown) =>
          this.logger.warn(`task.comment ${view.id} not written (${errorName(e)})`),
        );
    }
    return view;
  }

  /** The author changes their own comment within 15 minutes of posting it. */
  async editComment(
    businessId: string,
    actor: ClientsActor,
    id: string,
    commentId: string,
    body: Out<typeof UpdateTaskCommentRequest>,
  ): Promise<TaskComment> {
    const view = await this.inFirm(businessId, async (tx) => {
      await this.task(tx, businessId, actor, id);
      const row = await tx.taskComment.findFirst({
        where: { businessId, taskId: id, id: commentId },
      });
      if (!row) throw notFound();
      if (row.authorUserId !== actor.userId) throw commentErrors.notAuthor();
      if (Date.now() - row.createdAt.getTime() > EDIT_MS) throw commentErrors.editWindow();
      const saved = await tx.taskComment.update({
        where: { id: commentId },
        data: { body: body.body },
      });
      return commentView(saved, await memberNames(tx, businessId, [actor.userId]), actor.userId);
    });
    await this.audit.log('task.comment.updated', { type: 'task', id }, { commentId });
    return view;
  }

  /** The author deletes their own comment; the audit keeps that it was there. */
  async deleteComment(
    businessId: string,
    actor: ClientsActor,
    id: string,
    commentId: string,
  ): Promise<void> {
    const length = await this.inFirm(businessId, async (tx) => {
      await this.task(tx, businessId, actor, id);
      const row = await tx.taskComment.findFirst({
        where: { businessId, taskId: id, id: commentId },
      });
      if (!row) throw notFound();
      if (row.authorUserId !== actor.userId) throw commentErrors.notAuthor();
      await tx.taskComment.delete({ where: { id: commentId } });
      return row.body.length;
    });
    await this.audit.log('task.comment.deleted', { type: 'task', id }, { commentId, length });
  }
}

function commentView(
  r: { id: string; authorUserId: string; body: string; createdAt: Date; updatedAt: Date },
  names: Map<string, string>,
  me: string,
): TaskComment {
  const mine = r.authorUserId === me;
  return {
    id: r.id,
    author: memberRef(names, r.authorUserId),
    body: r.body,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
    edited: r.updatedAt.getTime() - r.createdAt.getTime() > 1_000,
    canEdit: mine && Date.now() - r.createdAt.getTime() <= EDIT_MS,
    canDelete: mine,
  };
}

/**
 * Who made an assignee's acknowledgment required: the audit row the assignment wrote
 * (`task.acknowledgement.required`), newest first. Null when there is none.
 */
export async function assignerOf(
  tx: TxClient,
  businessId: string,
  taskId: string,
  assigneeUserId: string,
): Promise<string | null> {
  const row = await tx.auditLog.findFirst({
    where: {
      businessId,
      action: 'task.acknowledgement.required',
      entityType: 'task',
      entityId: taskId,
      metadata: { path: ['assigneeUserId'], equals: assigneeUserId },
    },
    orderBy: { createdAt: 'desc' },
    select: { actorUserId: true },
  });
  return row?.actorUserId ?? null;
}
