import { Inject, Injectable } from '@nestjs/common';
import type { Database, Prisma, TxClient } from '@firmivra/db';
import type {
  TaskCalendar,
  TaskDetail,
  TaskOverviewPage,
  TaskSummary,
  TaskType,
} from '@firmivra/types';
import type { z } from 'zod';
import { zonedDate, zonedInstant } from '../appointments/calendar.js';
import { firmTimeZone } from '../appointments/calendar-data.js';
import { AuditService } from '../audit/audit.service.js';
import type { ClientsActor } from '../clients/clients.service.js';
import { DATABASE } from '../database/database.module.js';
import { memberNames, notFound, sentFields, toDay } from '../workspaces/common.js';
import {
  detailInclude,
  type DetailShape,
  isOverdue,
  type RowContext,
  rowInclude,
  toDetail,
  toRow,
} from './task-common.js';
import type { TaskCalendarQuery, TaskOverviewQuery } from './task-input.js';

type OverviewQuery = z.output<typeof TaskOverviewQuery>;
type CalendarQuery = z.output<typeof TaskCalendarQuery>;

const FILTERS = [
  'status',
  'progress',
  'priority',
  'typeId',
  'clientId',
  'engagementId',
  'assignedUserId',
  'overdue',
  'dueFrom',
  'dueTo',
  'search',
] as const;

/** Which tasks the actor reaches: Staff only those of clients assigned to them. */
export const reach = (actor: ClientsActor): Prisma.TaskWhereInput =>
  actor.role === 'STAFF' ? { client: { assignedUserId: actor.userId } } : {};

/** The tasks a person works on: theirs as the primary assignee or as a collaborator. */
export const mineOf = (userId: string): Prisma.TaskWhereInput => ({
  OR: [{ assignedUserId: userId }, { assignees: { some: { userId } } }],
});

/** The firm's "now": its date and the minutes since its midnight, in its own time zone. */
export async function firmClock(tx: TxClient, businessId: string, at = Date.now()) {
  const timeZone = await firmTimeZone(tx, businessId);
  const today = zonedDate(timeZone, at);
  const nowMinutes = Math.floor((at - zonedInstant(timeZone, today, 0)) / 60_000);
  return { timeZone, today, nowMinutes };
}

/** Checklist progress of these tasks: steps done and steps in all, by task id. */
export async function checklistCounts(tx: TxClient, taskIds: string[]) {
  const [all, done] = await Promise.all([
    tx.taskChecklistItem.groupBy({
      by: ['taskId'],
      where: { taskId: { in: taskIds } },
      _count: true,
    }),
    tx.taskChecklistItem.groupBy({
      by: ['taskId'],
      where: { taskId: { in: taskIds }, completedAt: { not: null } },
      _count: true,
    }),
  ]);
  return {
    total: new Map(all.map((r) => [r.taskId, r._count])),
    done: new Map(done.map((r) => [r.taskId, r._count])),
  };
}

const SORT: Record<
  OverviewQuery['sort'],
  (d: 'asc' | 'desc') => Prisma.TaskOrderByWithRelationInput[]
> = {
  // Open tasks first (OPEN comes first in the enum), then by date, no date last.
  due: (d) => [
    { status: 'asc' },
    { dueOn: { sort: d, nulls: 'last' } },
    { dueTime: { sort: d, nulls: 'last' } },
  ],
  priority: (d) => [
    { priority: d === 'asc' ? 'desc' : 'asc' },
    { dueOn: { sort: 'asc', nulls: 'last' } },
  ],
  status: (d) => [{ status: d }, { progress: d }],
  client: (d) => [{ client: { displayName: d } }],
  title: (d) => [{ title: d }],
  updated: (d) => [{ updatedAt: d }],
};

/**
 * The Tasks overview, summary, calendar and one task's detail (contract in
 * packages/types/src/tasks/work.ts). Staff reach only the tasks of their assigned clients; any
 * other task is 404. Reads are audited like the older list (`tasks.listed`): a count and filter
 * names only.
 */
@Injectable()
export class TaskReadService {
  constructor(
    @Inject(DATABASE) private readonly database: Database,
    private readonly audit: AuditService,
  ) {}

  private inFirm<T>(businessId: string, fn: (tx: TxClient) => Promise<T>): Promise<T> {
    return this.database.withScope({ kind: 'business', businessId }, fn);
  }

  async summary(businessId: string, actor: ClientsActor): Promise<TaskSummary> {
    return this.inFirm(businessId, async (tx) => {
      const clock = await firmClock(tx, businessId);
      const monthStart = new Date(zonedInstant(clock.timeZone, `${clock.today.slice(0, 7)}-01`, 0));
      const base: Prisma.TaskWhereInput = { businessId, archivedAt: null, ...reach(actor) };
      const open: Prisma.TaskWhereInput = { ...base, status: 'OPEN' };
      const [total, pending, inProgress, overdue, completedThisMonth, mine] = await Promise.all([
        tx.task.count({ where: { ...base, status: { not: 'CANCELLED' } } }),
        tx.task.count({ where: { ...open, progress: 'PENDING' } }),
        tx.task.count({ where: { ...open, progress: 'IN_PROGRESS' } }),
        tx.task.count({ where: { AND: [open, this.overdueWhere(clock)] } }),
        tx.task.count({ where: { ...base, status: 'DONE', completedAt: { gte: monthStart } } }),
        tx.task.count({ where: { AND: [open, mineOf(actor.userId)] } }),
      ]);
      return { total, pending, inProgress, overdue, completedThisMonth, mine };
    });
  }

  /** OPEN tasks past due: an earlier date, or today with a time already gone. */
  private overdueWhere(clock: { today: string; nowMinutes: number }): Prisma.TaskWhereInput {
    const hh = String(Math.floor(clock.nowMinutes / 60)).padStart(2, '0');
    const mm = String(clock.nowMinutes % 60).padStart(2, '0');
    return {
      OR: [
        { dueOn: { lt: toDay(clock.today) } },
        {
          dueOn: toDay(clock.today),
          allDay: false,
          dueTime: { lt: new Date(`1970-01-01T${hh}:${mm}:00.000Z`) },
        },
      ],
    };
  }

  async overview(
    businessId: string,
    actor: ClientsActor,
    q: OverviewQuery,
  ): Promise<TaskOverviewPage> {
    const page = await this.inFirm(businessId, async (tx) => {
      const clock = await firmClock(tx, businessId);
      const and: Prisma.TaskWhereInput[] = [{ businessId }, reach(actor)];
      if (q.view === 'archived') and.push({ archivedAt: { not: null } });
      else and.push({ archivedAt: null });
      if (q.view === 'all') and.push({ status: { not: 'CANCELLED' } });
      if (q.view === 'mine') and.push({ status: 'OPEN' }, mineOf(actor.userId));
      if (q.view === 'completed') and.push({ status: 'DONE' });
      if (q.status) and.push({ status: q.status });
      if (q.progress) and.push({ progress: q.progress });
      if (q.priority) and.push({ priority: q.priority });
      if (q.typeId) and.push({ typeId: q.typeId });
      if (q.clientId) and.push({ clientId: q.clientId });
      if (q.engagementId) and.push({ engagementId: q.engagementId });
      if (q.assignedUserId) and.push(mineOf(q.assignedUserId));
      if (q.overdue === true) and.push({ status: 'OPEN' }, this.overdueWhere(clock));
      if (q.dueFrom) and.push({ dueOn: { gte: toDay(q.dueFrom) } });
      if (q.dueTo) and.push({ dueOn: { lte: toDay(q.dueTo) } });
      if (q.search) {
        const has = { contains: q.search, mode: 'insensitive' } as const;
        and.push({
          OR: [
            { title: has },
            { client: { displayName: has } },
            { type: { name: has } },
            { service: { name: has } },
          ],
        });
      }
      const where: Prisma.TaskWhereInput = { AND: and };
      const orderBy = [...SORT[q.sort](q.direction), { id: 'asc' as const }];
      const [rows, total] = await Promise.all([
        tx.task.findMany({
          where,
          include: rowInclude,
          orderBy,
          skip: (q.page - 1) * q.pageSize,
          take: q.pageSize,
        }),
        tx.task.count({ where }),
      ]);
      const counts = await checklistCounts(
        tx,
        rows.map((r) => r.id),
      );
      const ctx: RowContext = { ...clock, ...counts };
      return {
        items: rows.map((r) => toRow(r, ctx)),
        total,
        page: q.page,
        pageSize: q.pageSize,
      };
    });
    await this.audit.log(
      'tasks.listed',
      { type: 'task' },
      { count: page.items.length, filters: sentFields(q, FILTERS), view: q.view },
    );
    return page;
  }

  async calendar(businessId: string, actor: ClientsActor, q: CalendarQuery): Promise<TaskCalendar> {
    return this.inFirm(businessId, async (tx) => {
      const clock = await firmClock(tx, businessId);
      const rows = await tx.task.findMany({
        where: {
          businessId,
          archivedAt: null,
          status: { not: 'CANCELLED' },
          dueOn: { gte: toDay(q.from), lte: toDay(q.to) },
          ...reach(actor),
          ...(q.clientId ? { clientId: q.clientId } : {}),
          ...(q.assignedUserId ? mineOf(q.assignedUserId) : {}),
          ...(q.mine === true ? mineOf(actor.userId) : {}),
        },
        select: {
          id: true,
          title: true,
          dueOn: true,
          dueTime: true,
          allDay: true,
          priority: true,
          status: true,
          progress: true,
          client: { select: { displayName: true } },
        },
        orderBy: [{ dueOn: 'asc' }, { dueTime: { sort: 'asc', nulls: 'first' } }, { id: 'asc' }],
        take: 500,
      });
      return {
        items: rows.map((t) => ({
          id: t.id,
          title: t.title,
          dueOn: t.dueOn!.toISOString().slice(0, 10),
          dueTime: t.dueTime ? t.dueTime.toISOString().slice(11, 16) : null,
          allDay: t.allDay,
          priority: t.priority,
          status: t.status,
          progress: t.progress,
          overdue: isOverdue(t, clock.today, clock.nowMinutes),
          clientName: t.client.displayName,
        })),
      };
    });
  }

  async detail(businessId: string, actor: ClientsActor, id: string): Promise<TaskDetail> {
    const task = await this.inFirm(businessId, (tx) => this.read(tx, businessId, actor, id));
    await this.audit.log(
      'task.viewed',
      { type: 'task', id: task.id },
      { clientId: task.client.id },
    );
    return task;
  }

  /** One task the actor reaches, as a TaskDetail, inside the caller's transaction. */
  async read(tx: TxClient, businessId: string, actor: ClientsActor | null, id: string) {
    const row = await tx.task.findFirst({
      where: { businessId, id, ...(actor ? reach(actor) : {}) },
      include: detailInclude,
    });
    if (!row) throw notFound();
    return this.toDetail(tx, businessId, row);
  }

  async toDetail(tx: TxClient, businessId: string, row: DetailShape): Promise<TaskDetail> {
    const names = await memberNames(tx, businessId, [
      row.createdByUserId,
      row.completedByUserId,
      ...row.taskChecklistItems.map((i) => i.completedByUserId),
      ...row.taskAttachments.map((a) => a.addedByUserId),
    ]);
    const clock = await firmClock(tx, businessId);
    return toDetail(row, names, { ...clock, done: new Map(), total: new Map() });
  }

  /** The firm's task types, for the filters and the form. */
  async types(businessId: string): Promise<TaskType[]> {
    const rows = await this.inFirm(businessId, (tx) =>
      tx.taskType.findMany({
        where: { businessId },
        orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }, { id: 'asc' }],
      }),
    );
    return rows.map((t) => ({
      id: t.id,
      name: t.name,
      sortOrder: t.sortOrder,
      archivedAt: t.archivedAt?.toISOString() ?? null,
    }));
  }
}
