import { Inject, Injectable } from '@nestjs/common';
import type { Database, Prisma, TxClient } from '@firmivra/db';
import type {
  TaskCalendar,
  TaskDetail,
  TaskNotices,
  TaskOverviewPage,
  TaskSummary,
  TaskType,
} from '@firmivra/types';
import type { z } from 'zod';
import { zonedDate, zonedInstant } from '../appointments/calendar.js';
import { firmTimeZone } from '../appointments/calendar-data.js';
import { AuditService } from '../audit/audit.service.js';
import type { ClientsActor } from '../clients/clients.service.js';
import { likeEscape } from '../clients/clients.service.js';
import { DATABASE } from '../database/database.module.js';
import { TASK_REMINDER_LATE_MS, taskReminderAt } from '../notifications/reminder-jobs.js';
import { day, memberNames, memberRef, notFound, sentFields, toDay } from '../workspaces/common.js';
import {
  detailInclude,
  type DetailShape,
  isOverdue,
  liveClient,
  liveStatus,
  LIVE_TASK,
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
  'dueSet',
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

/**
 * Checklist progress of these tasks: steps done, steps in all, and required steps still open
 * (T-C12), by task id.
 */
export async function checklistCounts(tx: TxClient, taskIds: string[]) {
  const [all, done, requiredOpen] = await Promise.all([
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
    tx.taskChecklistItem.groupBy({
      by: ['taskId'],
      where: { taskId: { in: taskIds }, required: true, completedAt: null },
      _count: true,
    }),
  ]);
  return {
    total: new Map(all.map((r) => [r.taskId, r._count])),
    done: new Map(done.map((r) => [r.taskId, r._count])),
    requiredOpen: new Map(requiredOpen.map((r) => [r.taskId, r._count])),
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
      const base: Prisma.TaskWhereInput = {
        businessId,
        archivedAt: null,
        ...reach(actor),
        ...LIVE_TASK,
      };
      const open: Prisma.TaskWhereInput = { ...base, status: 'OPEN' };
      const [total, pending, inProgress, overdue, completedThisMonth, mine] = await Promise.all([
        tx.task.count({ where: { AND: [base, { status: { not: 'CANCELLED' } }] } }),
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
      const and: Prisma.TaskWhereInput[] = [{ businessId }, reach(actor), LIVE_TASK];
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
      if (q.dueSet === true) and.push({ dueOn: { not: null } });
      if (q.dueFrom) and.push({ dueOn: { gte: toDay(q.dueFrom) } });
      if (q.dueTo) and.push({ dueOn: { lte: toDay(q.dueTo) } });
      if (q.search) {
        // T-D03: % and _ are letters here, never wildcards; Related To is searched too.
        const has = { contains: likeEscape(q.search), mode: 'insensitive' } as const;
        and.push({
          OR: [
            { title: has },
            { client: { displayName: has } },
            { type: { name: has } },
            { service: { name: has } },
            { engagement: { title: has } },
            { relatedText: has },
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
          AND: [LIVE_TASK],
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
          status: liveStatus(t.status),
          progress: t.progress,
          overdue: isOverdue(t, clock.today, clock.nowMinutes),
          clientName: liveClient(t.client).displayName,
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

  /**
   * Dashboard Review Two §9: the task's reminder history (contract: TaskNotices), for a member who
   * reaches the task (404 otherwise), worked out as the reminder job sends: who it reaches, when
   * each reminder goes next, and what went out with each copy's delivery. Audited as a view.
   */
  async notices(businessId: string, actor: ClientsActor, id: string): Promise<TaskNotices> {
    const { clientId, out } = await this.inFirm(businessId, async (tx) => {
      const task = await tx.task.findFirst({
        where: { businessId, id, ...LIVE_TASK, ...reach(actor) },
        select: {
          id: true,
          clientId: true,
          status: true,
          archivedAt: true,
          dueOn: true,
          dueTime: true,
          allDay: true,
          assignedUserId: true,
          createdByUserId: true,
          assignees: { select: { userId: true } },
          taskReminders: {
            select: {
              id: true,
              daysBefore: true,
              timeOfDay: true,
              minutesBefore: true,
              unit: true,
              inApp: true,
              lastFiredFor: true,
            },
          },
        },
      });
      if (!task) throw notFound();
      const rows = await tx.notification.findMany({
        where: { businessId, type: 'task.reminder', entityType: 'task', entityId: task.id },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: 100,
        select: {
          id: true,
          recipientUserId: true,
          eventKey: true,
          readAt: true,
          createdAt: true,
          deliveries: {
            orderBy: { channel: 'asc' },
            select: {
              channel: true,
              status: true,
              attempts: true,
              sentAt: true,
              providerMessageId: true,
              lastError: true,
            },
          },
        },
      });
      const { timeZone } = await firmClock(tx, businessId);
      // As the reminder job: the assignees, or with none the member who made the task.
      const assignees = [task.assignedUserId, ...task.assignees.map((a) => a.userId)].filter(
        (u): u is string => !!u,
      );
      const to = [
        ...new Set(
          assignees.length ? assignees : task.createdByUserId ? [task.createdByUserId] : [],
        ),
      ];
      // Names as the task's assignees are shown (the membership's user); a removed member's none.
      const names = new Map(
        (
          await tx.membership.findMany({
            where: {
              businessId,
              userId: { in: [...new Set([...to, ...rows.map((r) => r.recipientUserId)])] },
            },
            select: { userId: true, user: { select: { name: true } } },
          })
        ).map((m): [string, string] => [m.userId, m.user.name]),
      );
      const dueOn = day(task.dueOn);
      const now = Date.now();
      const upcoming =
        task.status === 'OPEN' && !task.archivedAt && dueOn
          ? task.taskReminders
              .filter((r) => day(r.lastFiredFor) !== dueOn)
              .map((r) => ({
                reminderId: r.id,
                at: taskReminderAt(timeZone, { ...r, task }, dueOn),
              }))
              .filter((r): r is { reminderId: string; at: number } => r.at !== null)
              .filter((r) => r.at + TASK_REMINDER_LATE_MS >= now)
              .sort((a, b) => a.at - b.at)
              .map((r) => ({ reminderId: r.reminderId, at: new Date(r.at).toISOString() }))
          : [];
      const out: TaskNotices = {
        timeZone,
        recipients: to.map((u) => memberRef(names, u)).filter((m) => m !== null),
        upcoming,
        sent: rows.map((r) => ({
          id: r.id,
          at: r.createdAt.toISOString(),
          // The eventKey is `task.reminder:<reminder id>:<due moment>`; the moment may hold a time.
          dueFor: (r.eventKey ?? '').split(':').slice(2).join(':'),
          recipient: memberRef(names, r.recipientUserId),
          readAt: r.readAt?.toISOString() ?? null,
          deliveries: r.deliveries.map((d) => ({
            channel: d.channel,
            status: d.status,
            attempts: d.attempts,
            sentAt: d.sentAt?.toISOString() ?? null,
            providerMessageId: d.providerMessageId,
            error: d.lastError,
          })),
        })),
        emailOnly: task.taskReminders
          .filter((r) => !r.inApp && r.lastFiredFor)
          .map((r) => ({ reminderId: r.id, firedFor: day(r.lastFiredFor)! })),
      };
      return { clientId: task.clientId, out };
    });
    await this.audit.log('task.notices_viewed', { type: 'task', id }, { clientId });
    return out;
  }

  /** One live task the actor reaches, as a TaskDetail, inside the caller's transaction. */
  async read(tx: TxClient, businessId: string, actor: ClientsActor | null, id: string) {
    const row = await tx.task.findFirst({
      where: { businessId, id, ...LIVE_TASK, ...(actor ? reach(actor) : {}) },
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
