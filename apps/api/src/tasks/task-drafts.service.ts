import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { Database, Prisma, Task, TxClient } from '@firmivra/db';
import type { TaskDetail, TaskDraft, TaskDraftPage } from '@firmivra/types';
import type { z } from 'zod';
import { AuditService } from '../audit/audit.service.js';
import type { ClientsActor } from '../clients/clients.service.js';
import { DATABASE } from '../database/database.module.js';
import {
  lockClient,
  memberNames,
  notFound,
  reachesClient,
  sentFields,
} from '../workspaces/common.js';
import {
  detailInclude,
  draftRowInclude,
  keyedSave,
  keyScope,
  LIVE_TASK,
  TASK_KEY_INDEX,
  taskErrors,
  toDraft,
  toDraftRow,
} from './task-common.js';
import type {
  PublishTaskDraftRequest,
  SaveTaskDraftRequest,
  TaskDraftQuery,
  UpdateTaskDraftRequest,
} from './task-input.js';
import { mineOf, reach, TaskReadService } from './task-read.service.js';
import { TaskWriteService } from './task-write.service.js';

type DraftQuery = z.output<typeof TaskDraftQuery>;
type SaveBody = z.output<typeof SaveTaskDraftRequest>;
type UpdateBody = z.output<typeof UpdateTaskDraftRequest>;
type PublishBody = z.output<typeof PublishTaskDraftRequest>;

const FILTERS = ['search', 'clientId', 'typeId', 'priority', 'assignedUserId', 'mine'] as const;
/** The fields a draft can hold besides its title: their names go to the audit log, never values. */
const FIELDS = [
  'clientId',
  'engagementId',
  'details',
  'dueOn',
  'assignedUserId',
  'typeId',
  'priority',
  'progress',
  'serviceId',
  'startOn',
  'dueTime',
  'allDay',
  'clientVisible',
  'internalNotes',
  'blockedReason',
  'additionalAssigneeIds',
  'dependsOnTaskId',
  'reminders',
  'checklist',
  'attachments',
] as const;
const SAVE_FIELDS = [...FIELDS, 'templateId'] as const;
const CHANGE_FIELDS = ['title', ...FIELDS] as const;

const SORT: Record<
  DraftQuery['sort'],
  (d: 'asc' | 'desc') => Prisma.TaskOrderByWithRelationInput[]
> = {
  updated: (d) => [{ updatedAt: d }],
  title: (d) => [{ title: d }],
  // A draft without a due date sorts as the latest one.
  due: (d) => [{ dueOn: { sort: d, nulls: d === 'asc' ? 'last' : 'first' } }],
  // Low, Medium, High: descending puts High first.
  priority: (d) => [{ priority: d }],
  client: (d) => [{ client: { displayName: d } }],
};

const DRAFT: Prisma.TaskWhereInput = { status: 'DRAFT' };
/** A publish's audit action: "task created", as for a new task (with `fromDraft`). */
const PUBLISHED = 'task.created';

/**
 * The drafts the actor sees: their own drafts without a client (even the Owner sees no one
 * else's), and the drafts with a client they reach by the tasks' rule (Owner and Admin every
 * client, Staff those assigned to them), whoever made them. So a draft whose client is
 * reassigned, or moved to another client, leaves a creator who no longer reaches that client.
 */
const seen = (actor: ClientsActor): Prisma.TaskWhereInput => ({
  ...DRAFT,
  OR: [
    { clientId: null, createdByUserId: actor.userId },
    { clientId: { not: null }, ...reach(actor) },
  ],
});

/**
 * Task drafts (contract in packages/types/src/tasks/drafts.ts; Octavia's Tasks review A2): Save
 * as Draft, the Drafts tab (search, filters, sort, pages), reopen, edit, publish and discard. A
 * draft is a task with status DRAFT, kept as sent: only the title is required, and nothing that
 * publishing checks is checked before (TaskWriteService's `insertNew` and `editDraft` with
 * `draft`): its reminders, Custom ones (minutes, hours or days before the due time) and a
 * template's included, are only kept once each until publishing checks them against the due date
 * and time. No other read of tasks sees a draft (LIVE_TASK); publishing checks it as a new task
 * (`checkAsNew`), makes it OPEN with the same id once, and then "task created" happens as for a
 * new task. A draft out of sight is 404, as is another firm's. Save as Draft is retry-safe by the
 * request's idempotency key (keyedSave), and a publish retried after it went through answers the
 * task it made; both audit in the transaction that writes. Audited with ids and field names only,
 * never a title, details, notes, a checklist label or a file name.
 */
@Injectable()
export class TaskDraftsService {
  constructor(
    @Inject(DATABASE) private readonly database: Database,
    private readonly audit: AuditService,
    private readonly reader: TaskReadService,
    private readonly writer: TaskWriteService,
  ) {}

  private inFirm<T>(businessId: string, fn: (tx: TxClient) => Promise<T>): Promise<T> {
    return this.database.withScope({ kind: 'business', businessId }, fn);
  }

  async list(businessId: string, actor: ClientsActor, q: DraftQuery): Promise<TaskDraftPage> {
    const page = await this.inFirm(businessId, async (tx) => {
      const and: Prisma.TaskWhereInput[] = [{ businessId }, seen(actor)];
      if (q.clientId) and.push({ clientId: q.clientId });
      if (q.typeId) and.push({ typeId: q.typeId });
      if (q.priority) and.push({ priority: q.priority });
      if (q.assignedUserId) and.push(mineOf(q.assignedUserId));
      if (q.mine === true) and.push({ createdByUserId: actor.userId });
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
      const [rows, total] = await Promise.all([
        tx.task.findMany({
          where,
          include: draftRowInclude,
          orderBy: [...SORT[q.sort](q.direction), { id: 'asc' }],
          skip: (q.page - 1) * q.pageSize,
          take: q.pageSize,
        }),
        tx.task.count({ where }),
      ]);
      const names = await memberNames(
        tx,
        businessId,
        rows.map((r) => r.createdByUserId),
      );
      return {
        items: rows.map((r) => toDraftRow(r, names)),
        total,
        page: q.page,
        pageSize: q.pageSize,
      };
    });
    await this.audit.log(
      'tasks.drafts_listed',
      { type: 'task' },
      { count: page.items.length, filters: sentFields(q, FILTERS) },
    );
    return page;
  }

  async get(businessId: string, actor: ClientsActor, id: string): Promise<TaskDraft> {
    const draft = await this.inFirm(businessId, (tx) => this.read(tx, businessId, actor, id));
    await this.audit.log(
      'task.draft_viewed',
      { type: 'task', id: draft.id },
      { clientId: draft.client?.id ?? null },
    );
    return draft;
  }

  /**
   * Save as Draft: a new draft of the caller's, with or without a client they reach. With
   * `idempotencyKey`, a retry returns the draft the first save made while it is still a draft
   * (409 once it is published).
   */
  async save(businessId: string, actor: ClientsActor, body: SaveBody): Promise<TaskDraft> {
    return keyedSave(
      this.database,
      businessId,
      actor,
      { key: body.idempotencyKey, scope: keyScope.draft, index: TASK_KEY_INDEX },
      (tx, id) => this.read(tx, businessId, actor, id),
      async (tx) => {
        let client: { assignedUserId: string | null } | null = null;
        if (body.clientId) {
          // As for a new task: a client the caller does not reach is not found.
          client = await lockClient(tx, businessId, body.clientId);
          if (!client || !reachesClient(actor, client)) throw notFound();
        }
        const id = await this.writer.insertNew(tx, businessId, actor, body, client, true);
        const draft = await this.read(tx, businessId, null, id);
        await this.audit.logIn(
          tx,
          'task.draft_saved',
          { type: 'task', id: draft.id },
          {
            clientId: draft.client?.id ?? null,
            fields: sentFields(body, SAVE_FIELDS),
            ...(body.templateId ? { templateId: body.templateId.toLowerCase() } : {}),
          },
        );
        return draft;
      },
      this.writer.newTaskErrors(body),
    );
  }

  /** Edits a draft; it stays a draft. `version` guards a concurrent save (409 SAVE_CONFLICT). */
  async update(
    businessId: string,
    actor: ClientsActor,
    id: string,
    body: UpdateBody,
  ): Promise<TaskDraft> {
    const { version, ...changes } = body;
    const draft = await this.inFirm(businessId, async (tx) => {
      const current = await this.open(tx, businessId, actor, id);
      if (version !== undefined && version !== current.updatedAt.toISOString()) {
        throw taskErrors.saveConflict();
      }
      await this.writer.editDraft(tx, businessId, actor, current, changes);
      // The draft as saved, also when the change took it out of the caller's sight (a client
      // cleared on another member's draft).
      return this.read(tx, businessId, null, current.id);
    }).catch(this.writer.mapErrors(changes));
    await this.audit.log(
      'task.draft_updated',
      { type: 'task', id: draft.id },
      { clientId: draft.client?.id ?? null, fields: sentFields(changes, CHANGE_FIELDS) },
    );
    return draft;
  }

  /**
   * Save Task on a draft, in one transaction: the fields sent apply as on PATCH, then the draft
   * is checked as a new task is (400 VALIDATION_FAILED naming `clientId` without one; the errors
   * of a new task otherwise, and then it stays a draft) and becomes an OPEN task with the same
   * id, made now. Only while it is still this draft, so "task created" (create's audit row,
   * written in the same transaction; create sends no notification and starts no automation)
   * happens once. A publish retried after it went through (its answer lost, or two at once)
   * finds no draft: it answers the task as it is now when the caller published it and still
   * reaches it, without publishing or auditing again (`published`); anyone else gets 404.
   */
  async publish(
    businessId: string,
    actor: ClientsActor,
    id: string,
    body: PublishBody,
  ): Promise<TaskDetail> {
    const { version, ...changes } = body;
    return this.inFirm(businessId, async (tx) => {
      let current: Task;
      try {
        current = await this.open(tx, businessId, actor, id);
      } catch (error) {
        const live =
          error instanceof NotFoundException
            ? await this.published(tx, businessId, actor, id)
            : null;
        if (live) return live;
        throw error;
      }
      if (version !== undefined && version !== current.updatedAt.toISOString()) {
        throw taskErrors.saveConflict();
      }
      // A missing client is named first, whatever else the body sends.
      if (!(changes.clientId === undefined ? current.clientId : changes.clientId)) {
        throw taskErrors.invalid('clientId', 'Choose a client');
      }
      if (Object.keys(changes).length > 0) {
        await this.writer.editDraft(tx, businessId, actor, current, changes);
      }
      const draft = await this.writer.checkAsNew(tx, businessId, actor, current.id);
      const now = new Date();
      const { count } = await tx.task.updateMany({
        where: { businessId, id: draft.id, status: 'DRAFT', updatedAt: draft.updatedAt },
        data: { status: 'OPEN', createdAt: now, updatedAt: now },
      });
      if (count !== 1) throw notFound();
      const task = await this.reader.read(tx, businessId, null, draft.id);
      // With the publish: `published` reads who published from this row.
      await this.audit.logIn(
        tx,
        PUBLISHED,
        { type: 'task', id: task.id },
        {
          clientId: task.client.id,
          engagementId: task.engagementId,
          assignedUserId: task.assignedTo?.userId ?? null,
          fields: sentFields(changes, CHANGE_FIELDS),
          fromDraft: true,
          ...(task.templateId ? { templateId: task.templateId } : {}),
        },
      );
      return task;
    }).catch(this.writer.mapErrors(changes));
  }

  /**
   * The task a draft became, for a publish retried after it went through: when the caller
   * published it (the publish's audit row, written with it, says who did) and still reaches it.
   * Null otherwise, so the 404 stands.
   */
  private async published(
    tx: TxClient,
    businessId: string,
    actor: ClientsActor,
    id: string,
  ): Promise<TaskDetail | null> {
    const live = await tx.task.findFirst({
      where: { businessId, id, ...LIVE_TASK, ...reach(actor) },
      select: { id: true },
    });
    if (!live) return null;
    const mine = await tx.auditLog.findFirst({
      where: {
        businessId,
        entityType: 'task',
        entityId: live.id,
        action: PUBLISHED,
        actorUserId: actor.userId,
        metadata: { path: ['fromDraft'], equals: true },
      },
      select: { id: true },
    });
    return mine ? this.reader.read(tx, businessId, actor, live.id) : null;
  }

  /** Discards a draft: its checklist, reminders, collaborators and attachments go with it. */
  async discard(businessId: string, actor: ClientsActor, id: string): Promise<void> {
    const gone = await this.inFirm(businessId, async (tx) => {
      const current = await this.open(tx, businessId, actor, id);
      const { count } = await tx.task.deleteMany({
        where: { businessId, id: current.id, ...DRAFT },
      });
      if (count !== 1) throw notFound();
      return current;
    });
    await this.audit.log(
      'task.draft_discarded',
      { type: 'task', id: gone.id },
      { clientId: gone.clientId },
    );
  }

  /**
   * The draft the actor sees, locked: its client first (FOR SHARE, so its assignee holds), then
   * the task (FOR UPDATE), the one order everywhere. 404 when it is out of sight or no longer a
   * draft (published meanwhile).
   */
  private async open(
    tx: TxClient,
    businessId: string,
    actor: ClientsActor,
    id: string,
  ): Promise<Task> {
    const found = await tx.task.findFirst({
      where: { businessId, id, ...seen(actor) },
      select: { clientId: true },
    });
    if (!found) throw notFound();
    if (found.clientId) await lockClient(tx, businessId, found.clientId);
    const [locked] = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM tasks WHERE business_id = ${businessId}::uuid AND id = ${id}::uuid FOR UPDATE`;
    if (!locked) throw notFound();
    const current = await tx.task.findFirst({ where: { businessId, id, ...seen(actor) } });
    if (!current || current.clientId !== found.clientId) throw notFound();
    return current;
  }

  /** One draft with everything the form shows; `actor` null: after the caller's own write. */
  private async read(
    tx: TxClient,
    businessId: string,
    actor: ClientsActor | null,
    id: string,
  ): Promise<TaskDraft> {
    const row = await tx.task.findFirst({
      where: { businessId, id, ...(actor ? seen(actor) : DRAFT) },
      include: detailInclude,
    });
    if (!row) throw notFound();
    const names = await memberNames(tx, businessId, [
      row.createdByUserId,
      ...row.taskChecklistItems.map((i) => i.completedByUserId),
      ...row.taskAttachments.map((a) => a.addedByUserId),
    ]);
    return toDraft(row, names);
  }
}
