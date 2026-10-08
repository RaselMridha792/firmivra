import { Inject, Injectable } from '@nestjs/common';
import type { Database, Prisma, TxClient } from '@firmivra/db';
import type { Task, TaskList, TaskStatus } from '@firmivra/types';
import type { z } from 'zod';
import { AuditService } from '../audit/audit.service.js';
import type { ClientsActor } from '../clients/clients.service.js';
import { DATABASE } from '../database/database.module.js';
import {
  assignee,
  checkAssignee,
  conflict,
  day,
  isForeignKeyViolation,
  isUniqueViolation,
  lockClient,
  memberNames,
  memberRef,
  notAMember,
  notFound,
  reachesClient,
  sentFields,
  toDay,
} from './common.js';
import type { CreateTaskBody, TasksQuery, UpdateTaskBody } from './input.js';
import { decodeTaskCursor, encodeTaskCursor, type TaskCursor } from './paging.js';

type ListQuery = z.output<typeof TasksQuery>;
type CreateBody = z.output<typeof CreateTaskBody>;
type UpdateBody = z.output<typeof UpdateTaskBody>;

const engagementMismatch = () =>
  conflict('ENGAGEMENT_MISMATCH', "The engagement is not this client's");
const nameChangePending = () =>
  conflict('NAME_CHANGE_PENDING', 'This client already has an open name change');

const select = {
  id: true,
  engagementId: true,
  title: true,
  details: true,
  kind: true,
  status: true,
  dueOn: true,
  completedAt: true,
  createdByUserId: true,
  createdAt: true,
  updatedAt: true,
  client: { select: { id: true, displayName: true } },
  assignedMember: { select: { userId: true, user: { select: { name: true } } } },
} satisfies Prisma.TaskSelect;
type Row = Prisma.TaskGetPayload<{ select: typeof select }>;

function toTask(row: Row, names: Map<string, string>): Task {
  return {
    id: row.id,
    client: { id: row.client.id, displayName: row.client.displayName },
    engagementId: row.engagementId,
    title: row.title,
    details: row.details,
    kind: row.kind,
    status: row.status,
    dueOn: day(row.dueOn),
    assignedTo: assignee(row.assignedMember),
    completedAt: row.completedAt?.toISOString() ?? null,
    createdBy: memberRef(names, row.createdByUserId),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/**
 * `completedAt` after a status change: set when the task becomes DONE, kept while it stays DONE,
 * cleared for any other status. `undefined`: the status does not change, nor does completedAt.
 */
export function completedAtAfter(
  current: { status: TaskStatus; completedAt: Date | null },
  next: TaskStatus | undefined,
  now: Date,
): Date | null | undefined {
  if (next === undefined) return undefined;
  if (next !== 'DONE') return null;
  return current.status === 'DONE' ? (current.completedAt ?? now) : now;
}

/** Where the next page starts, after `row`. */
const cursorAfter = (row: Row): TaskCursor =>
  row.status === 'OPEN'
    ? { open: true, dueOn: day(row.dueOn), id: row.id }
    : { open: false, at: row.updatedAt, id: row.id };

/** Open tasks after the cursor: a later due date, the same date and a later id, or no date. */
function afterOpen(c: TaskCursor & { open: true }): Prisma.TaskWhereInput {
  if (c.dueOn === null) return { dueOn: null, id: { gt: c.id } };
  const due = toDay(c.dueOn);
  return { OR: [{ dueOn: { gt: due } }, { dueOn: due, id: { gt: c.id } }, { dueOn: null }] };
}

/** Closed tasks after the cursor: changed earlier, or at the same time with a smaller id. */
const afterClosed = (c: TaskCursor & { open: false }): Prisma.TaskWhereInput => ({
  OR: [{ updatedAt: { lt: c.at } }, { updatedAt: c.at, id: { lt: c.id } }],
});

const LIST_FILTERS = ['clientId', 'engagementId', 'assignedUserId', 'status'] as const;
const UPDATE_FIELDS = ['title', 'details', 'dueOn', 'assignedUserId', 'status'] as const;

/**
 * R12's reassignment rule (Decisions, Oct 8), for R10's reassign path to call inside its own
 * transaction once a client's assignee changed from `fromUserId` to `toUserId` (null: nobody):
 * the client's OPEN tasks held by `fromUserId` move to `toUserId`, or become unassigned, when
 * `fromUserId` is a Staff member, since Staff reach only their assigned clients' tasks. Tasks
 * held by an Owner or Admin stay with them, and done or cancelled tasks never move. Returns how
 * many moved; the caller's audit row for the reassignment carries that count (ids only).
 */
export async function reassignClientTasks(
  tx: TxClient,
  businessId: string,
  clientId: string,
  fromUserId: string | null,
  toUserId: string | null,
): Promise<number> {
  if (!fromUserId || fromUserId.toLowerCase() === toUserId?.toLowerCase()) return 0;
  const [from] = await tx.$queryRaw<{ role: string }[]>`
    SELECT role::text AS role FROM memberships
    WHERE business_id = ${businessId}::uuid AND user_id = ${fromUserId}::uuid`;
  if (from?.role !== 'STAFF') return 0;
  const moved = await tx.task.updateMany({
    where: { businessId, clientId, status: 'OPEN', assignedUserId: fromUserId },
    data: { assignedUserId: toUserId },
  });
  return moved.count;
}

/**
 * Tasks (R12 step 6; contract in packages/types/src/tasks): the firm's to-dos for its clients,
 * never shown to clients. Owner and Admin see and change every task. Staff follow Rasel's rule of
 * Oct 8 (q5, the calendar's rule): they see, change and create a client's tasks only when that
 * client is assigned to them; any other task is 404, also one assigned to them on another
 * client. A client's task goes to a Staff member only when that client is assigned to that Staff
 * member (409 CLIENT_NOT_ASSIGNED); Owner and Admin can always be the assignee. Every query runs
 * in the firm's scope with `businessId` from TenantGuard. Audited with ids, statuses and field
 * names only, never a title or details.
 */
@Injectable()
export class TasksService {
  constructor(
    @Inject(DATABASE) private readonly database: Database,
    private readonly audit: AuditService,
  ) {}

  private inFirm<T>(businessId: string, fn: (tx: TxClient) => Promise<T>): Promise<T> {
    return this.database.withScope({ kind: 'business', businessId }, fn);
  }

  /** Which tasks the actor reaches: Staff only those of clients assigned to them. */
  private reach(actor: ClientsActor): Prisma.TaskWhereInput {
    return actor.role === 'STAFF' ? { client: { assignedUserId: actor.userId } } : {};
  }

  /** Open tasks first by due date (no date last), then the rest by last change, newest first. */
  async list(businessId: string, actor: ClientsActor, q: ListQuery): Promise<TaskList> {
    const after = q.cursor ? decodeTaskCursor(q.cursor) : undefined;
    const filters: Prisma.TaskWhereInput[] = [
      { businessId },
      this.reach(actor),
      q.clientId ? { clientId: q.clientId } : {},
      q.engagementId ? { engagementId: q.engagementId } : {},
      q.assignedUserId ? { assignedUserId: q.assignedUserId } : {},
    ];
    const closed: TaskStatus[] =
      q.status === undefined ? ['DONE', 'CANCELLED'] : q.status === 'OPEN' ? [] : [q.status];
    const { rows, names } = await this.inFirm(businessId, async (tx) => {
      const found: Row[] = [];
      // A cursor among the closed tasks is past every open one.
      if ((q.status === undefined || q.status === 'OPEN') && (!after || after.open)) {
        found.push(
          ...(await tx.task.findMany({
            where: { AND: [...filters, { status: 'OPEN' }, after?.open ? afterOpen(after) : {}] },
            orderBy: [{ dueOn: { sort: 'asc', nulls: 'last' } }, { id: 'asc' }],
            take: q.limit + 1,
            select,
          })),
        );
      }
      if (found.length <= q.limit && closed.length > 0) {
        found.push(
          ...(await tx.task.findMany({
            where: {
              AND: [
                ...filters,
                { status: { in: closed } },
                after && !after.open ? afterClosed(after) : {},
              ],
            },
            orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
            take: q.limit + 1 - found.length,
            select,
          })),
        );
      }
      const page = found.slice(0, q.limit);
      return {
        rows: found,
        names: await memberNames(
          tx,
          businessId,
          page.map((r) => r.createdByUserId),
        ),
      };
    });
    const page = rows.slice(0, q.limit);
    const last = page.at(-1);
    await this.audit.log(
      'tasks.listed',
      { type: 'task' },
      {
        count: page.length,
        filters: sentFields(q, LIST_FILTERS),
        ...(q.clientId ? { clientId: q.clientId.toLowerCase() } : {}),
        ...(q.engagementId ? { engagementId: q.engagementId.toLowerCase() } : {}),
      },
    );
    return {
      items: page.map((row) => toTask(row, names)),
      nextCursor: rows.length > q.limit && last ? encodeTaskCursor(cursorAfter(last)) : null,
    };
  }

  /** A GENERAL task for a client the actor reaches (Staff: assigned to them; else 404). */
  async create(businessId: string, actor: ClientsActor, body: CreateBody): Promise<Task> {
    const task = await this.inFirm(businessId, async (tx) => {
      const client = await lockClient(tx, businessId, body.clientId);
      if (!client || !reachesClient(actor, client)) throw notFound();
      if (body.engagementId) {
        // Another client's, another firm's (row-level security) or no engagement at all.
        const engagement = await tx.engagement.findFirst({
          where: { businessId, id: body.engagementId, clientId: body.clientId },
          select: { id: true },
        });
        if (!engagement) throw engagementMismatch();
      }
      if (body.assignedUserId) {
        await checkAssignee(tx, businessId, body.assignedUserId, client);
      }
      const created = await tx.task.create({
        data: {
          businessId,
          clientId: body.clientId,
          engagementId: body.engagementId ?? null,
          title: body.title,
          details: body.details ?? null,
          dueOn: body.dueOn ? toDay(body.dueOn) : null,
          assignedUserId: body.assignedUserId ?? null,
          createdByUserId: actor.userId,
        },
        select: { id: true },
      });
      return this.read(tx, businessId, created.id);
    }).catch((error: unknown) => {
      // Backstop: the assignee's membership went away between the check and the insert.
      if (body.assignedUserId && isForeignKeyViolation(error)) throw notAMember();
      throw error;
    });
    await this.audit.log(
      'task.created',
      { type: 'task', id: task.id },
      {
        clientId: task.client.id,
        engagementId: task.engagementId,
        assignedUserId: task.assignedTo?.userId ?? null,
        fields: sentFields(body, ['details', 'dueOn', 'engagementId', 'assignedUserId']),
      },
    );
    return task;
  }

  /**
   * Changes only what is sent; `null` clears. Reopening a NAME_CHANGE task while the client has
   * another open one is 409 NAME_CHANGE_PENDING (the database's unique index has the last word).
   */
  async update(
    businessId: string,
    actor: ClientsActor,
    id: string,
    body: UpdateBody,
  ): Promise<Task> {
    const task = await this.inFirm(businessId, async (tx) => {
      // One change of a task at a time, so the status it replaces is the one read here.
      const [locked] = await tx.$queryRaw<{ id: string }[]>`
        SELECT id FROM tasks WHERE business_id = ${businessId}::uuid AND id = ${id}::uuid
        FOR UPDATE`;
      if (!locked) throw notFound();
      const current = await tx.task.findFirst({
        where: { businessId, id },
        select: { clientId: true, kind: true, status: true, completedAt: true },
      });
      if (!current) throw notFound();
      const client = await lockClient(tx, businessId, current.clientId);
      if (!client || !reachesClient(actor, client)) throw notFound();
      if (body.assignedUserId) {
        await checkAssignee(tx, businessId, body.assignedUserId, client);
      }
      if (body.status === 'OPEN' && current.kind === 'NAME_CHANGE' && current.status !== 'OPEN') {
        const open = await tx.task.findFirst({
          where: {
            businessId,
            clientId: current.clientId,
            kind: 'NAME_CHANGE',
            status: 'OPEN',
            id: { not: id },
          },
          select: { id: true },
        });
        if (open) throw nameChangePending();
      }
      const data: Prisma.TaskUncheckedUpdateInput = {};
      if (body.title !== undefined) data.title = body.title;
      if (body.details !== undefined) data.details = body.details;
      if (body.dueOn !== undefined) data.dueOn = body.dueOn === null ? null : toDay(body.dueOn);
      if (body.assignedUserId !== undefined) data.assignedUserId = body.assignedUserId;
      if (body.status !== undefined) {
        data.status = body.status;
        data.completedAt = completedAtAfter(current, body.status, new Date());
      }
      await tx.task.update({ where: { id }, data, select: { id: true } });
      return this.read(tx, businessId, id);
    }).catch((error: unknown) => {
      // tasks_one_open_name_change: another name change of this client opened at the same time.
      if (isUniqueViolation(error)) throw nameChangePending();
      if (body.assignedUserId && isForeignKeyViolation(error)) throw notAMember();
      throw error;
    });
    // The stored id, not the URL's spelling: an upper-case id in the URL finds the same task, and
    // the audit row must still match the task's id when the firm filters its log by record.
    await this.audit.log(
      'task.updated',
      { type: 'task', id: task.id },
      {
        clientId: task.client.id,
        fields: sentFields(body, UPDATE_FIELDS),
        ...(body.status === undefined ? {} : { status: body.status }),
        ...(body.assignedUserId === undefined
          ? {}
          : { assignedUserId: task.assignedTo?.userId ?? null }),
      },
    );
    return task;
  }

  private async read(tx: TxClient, businessId: string, id: string): Promise<Task> {
    const row = await tx.task.findFirst({ where: { businessId, id }, select });
    if (!row) throw notFound();
    return toTask(row, await memberNames(tx, businessId, [row.createdByUserId]));
  }
}
