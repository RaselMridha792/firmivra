import { Inject, Injectable } from '@nestjs/common';
import type {
  Database,
  Prisma,
  Task,
  TaskStatus as StoredTaskStatus,
  TxClient,
} from '@firmivra/db';
import type {
  ReorderChecklistRequest,
  TaskAttachment,
  TaskDetail,
  TaskProgress,
  TaskStatus,
} from '@firmivra/types';
import type { z } from 'zod';
import { addDays, timeOfDayFromDb, timeOfDayToDb } from '../appointments/calendar.js';
import { AuditService } from '../audit/audit.service.js';
import type { ClientsActor } from '../clients/clients.service.js';
import { DATABASE } from '../database/database.module.js';
import {
  checkAssignee,
  checkMember,
  conflict,
  isForeignKeyViolation,
  isUniqueViolation,
  lockClient,
  notAMember,
  notFound,
  reachesClient,
  sentFields,
  toDay,
  violatedIndex,
} from '../workspaces/common.js';
import { completedAtAfter } from '../workspaces/tasks.service.js';
import {
  checkReminders,
  fitReminders,
  LIVE_TASK,
  liveClient,
  type Reminder,
  reminderErrors,
  reminderFrom,
  reminderFromRow,
  reminderRow,
  remindersFromJson,
  taskErrors,
} from './task-common.js';
import type {
  CreateTaskDetailRequest,
  SaveTaskDraftRequest,
  UpdateTaskDetailRequest,
  UpdateTaskDraftRequest,
} from './task-input.js';
import { firmClock, reach, TaskReadService } from './task-read.service.js';

type CreateBody = z.output<typeof CreateTaskDetailRequest>;
type UpdateBody = z.output<typeof UpdateTaskDetailRequest>;
/** A new task's body, or a new draft's (Save as Draft: the client may come later). */
type NewTaskBody = CreateBody | z.output<typeof SaveTaskDraftRequest>;
/** A draft's changes (PATCH, or the fields sent with publish), without `version`. */
export type DraftChanges = Omit<z.output<typeof UpdateTaskDraftRequest>, 'version'>;
/** The fields a live task's change and a draft's change have in common. */
type FieldChanges = Omit<UpdateBody, 'status' | 'version'>;
type ChecklistInput = NonNullable<CreateBody['checklist']>[number];
type Prerequisite = { id: string; status: StoredTaskStatus } | null;

const CREATE_FIELDS = [
  'details',
  'dueOn',
  'engagementId',
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
  'templateId',
] as const;
const UPDATE_FIELDS = [
  'title',
  'details',
  'dueOn',
  'assignedUserId',
  'status',
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
] as const;

const nameChangePending = () =>
  conflict('NAME_CHANGE_PENDING', 'This client already has an open name change');
const engagementMismatch = () =>
  conflict('ENGAGEMENT_MISMATCH', "The engagement is not this client's");
const taskClosed = () => conflict('TASK_CLOSED', 'Reopen or restore the task before changing it');
/** The engagement and the attachments are the client's: a draft without one takes neither. */
const chooseClientFirst = () => taskErrors.invalid('clientId', 'Choose the client first');

interface Shape {
  dueOn: string | null;
  startOn: string | null;
  dueTime: string | null;
  allDay: boolean;
  progress: TaskProgress;
  blockedReason: string | null;
  dependsOnTaskId: string | null;
  /** The prerequisite is not done yet. */
  dependencyOpen: boolean;
  reminders: Reminder[];
}

/** What a draft is read with to be checked before it goes live. */
const publishInclude = {
  assignees: { select: { userId: true } },
  taskChecklistItems: { select: { assignedUserId: true } },
  taskAttachments: { select: { documentId: true, clientVisible: true } },
} satisfies Prisma.TaskInclude;

/**
 * Creating and changing tasks (contract in packages/types/src/tasks): the older fields with the
 * older rules (Staff reach only their assigned clients' tasks, a Staff assignee only on their own
 * clients: Rasel, Oct 8, q5), and the Tasks module's: type, priority, stage, dates and time,
 * visibility, notes, collaborators, checklist, reminders, prerequisite and attachments. Every
 * change locks the client and then the task, as the older service did. Audited with ids,
 * statuses and field names only: never a title, details, notes, a checklist label or a file name.
 * Drafts (task-drafts.service.ts) are saved, edited and checked before they go live with the same
 * pieces: `insertNew`, `editDraft` and `checkAsNew`.
 */
@Injectable()
export class TaskWriteService {
  constructor(
    @Inject(DATABASE) private readonly database: Database,
    private readonly audit: AuditService,
    private readonly reader: TaskReadService,
  ) {}

  private inFirm<T>(businessId: string, fn: (tx: TxClient) => Promise<T>): Promise<T> {
    return this.database.withScope({ kind: 'business', businessId }, fn);
  }

  // ---------- Create ----------

  async create(businessId: string, actor: ClientsActor, body: CreateBody): Promise<TaskDetail> {
    const task = await this.inFirm(businessId, async (tx) => {
      const client = await lockClient(tx, businessId, body.clientId);
      if (!client || !reachesClient(actor, client)) throw notFound();
      const id = await this.insertNew(tx, businessId, actor, body, client);
      return this.reader.read(tx, businessId, null, id);
    }).catch(this.newTaskErrors(body));
    await this.audit.log(
      'task.created',
      { type: 'task', id: task.id },
      {
        clientId: task.client.id,
        engagementId: task.engagementId,
        assignedUserId: task.assignedTo?.userId ?? null,
        fields: sentFields(body, CREATE_FIELDS),
        ...(body.templateId ? { templateId: body.templateId.toLowerCase() } : {}),
      },
    );
    return task;
  }

  /** Backstop of a new task or draft: the assignee's membership went away before the insert. */
  newTaskErrors(body: { assignedUserId?: string | null | undefined }) {
    return (error: unknown): never => {
      if (body.assignedUserId && isForeignKeyViolation(error)) throw notAMember();
      throw error;
    };
  }

  /**
   * A new task, or with `draft` a new draft (Save as Draft), from the request and its template:
   * the template fills every field the request leaves out, then the fields are checked in
   * create's order and the task is saved with its collaborators, checklist, reminders and
   * attachments. `client`: the request's client, locked and reached by the actor; a draft may
   * have none yet. A draft is kept as sent: its ids must be the firm's and it must be storable,
   * but what only publishing checks (the assignee's reach, an archived type, the reminders and
   * stage a live task needs) waits for `checkAsNew`. The template's reminders are never refused:
   * a new task leaves out the ones that do not fit it, a draft keeps them all for publishing to
   * check. The new task's id.
   */
  async insertNew(
    tx: TxClient,
    businessId: string,
    actor: ClientsActor,
    body: NewTaskBody,
    client: { assignedUserId: string | null } | null,
    draft = false,
  ): Promise<string> {
    const clientId = body.clientId ?? null;
    const clock = await firmClock(tx, businessId);
    const tpl = body.templateId ? await this.template(tx, businessId, body.templateId) : null;
    await this.checkEngagement(tx, businessId, clientId, body.engagementId);
    const typeId = body.typeId !== undefined ? body.typeId : await this.liveType(tx, tpl?.typeId);
    const serviceId = body.serviceId !== undefined ? body.serviceId : (tpl?.serviceId ?? null);
    await this.checkType(tx, businessId, typeId, draft);
    await this.checkService(tx, businessId, serviceId);
    const assignedUserId =
      body.assignedUserId ?? (await this.templateAssignee(tx, businessId, tpl, client));
    if (body.assignedUserId) {
      await this.checkAssigned(tx, businessId, body.assignedUserId, client, draft);
    }
    const dueOn =
      body.dueOn ?? (tpl?.dueOffsetDays != null ? addDays(clock.today, tpl.dueOffsetDays) : null);
    const dueTime = body.dueTime ?? null;
    const allDay = body.allDay ?? dueTime === null;
    const prerequisite = await this.prerequisite(tx, businessId, actor, null, body.dependsOnTaskId);
    const reminders = body.reminders
      ? body.reminders.map(reminderFrom)
      : templateReminders(tpl?.reminders, { dueOn, dueTime: allDay ? null : dueTime }, draft);
    const checklist = body.checklist ?? checklistRules(tpl?.checklist);
    const shape: Shape = {
      dueOn,
      startOn: body.startOn ?? null,
      dueTime,
      allDay,
      progress:
        body.progress ?? (prerequisite?.status === 'DONE' || !prerequisite ? 'PENDING' : 'BLOCKED'),
      blockedReason: body.blockedReason ?? null,
      dependsOnTaskId: prerequisite?.id ?? null,
      dependencyOpen: prerequisite !== null && prerequisite.status !== 'DONE',
      reminders,
    };
    this.checkShape(shape, draft);
    const attachments = body.attachments ?? [];
    if (attachments.length > 0 && !clientId) throw chooseClientFirst();
    const created = await tx.task.create({
      data: {
        businessId,
        clientId,
        ...(draft ? { status: 'DRAFT' as const } : {}),
        engagementId: body.engagementId ?? null,
        title: body.title,
        details: body.details !== undefined ? body.details : (tpl?.description ?? null),
        dueOn: dueOn ? toDay(dueOn) : null,
        assignedUserId: assignedUserId ?? null,
        createdByUserId: actor.userId,
        typeId,
        serviceId,
        priority: body.priority ?? tpl?.priority ?? 'MEDIUM',
        progress: shape.progress,
        startOn: shape.startOn ? toDay(shape.startOn) : null,
        dueTime: dueTime ? timeOfDayToDb(dueTime) : null,
        allDay: shape.allDay,
        clientVisible: body.clientVisible ?? tpl?.clientVisibleDefault ?? false,
        internalNotes: body.internalNotes ?? null,
        blockedReason: shape.blockedReason,
        dependsOnTaskId: shape.dependsOnTaskId,
        templateId: tpl?.id ?? null,
      },
      select: { id: true },
    });
    await this.saveAssignees(
      tx,
      businessId,
      created.id,
      body.additionalAssigneeIds,
      assignedUserId,
    );
    await this.saveChecklist(tx, businessId, created.id, checklist);
    await this.saveReminders(tx, businessId, created.id, reminders);
    if (clientId) {
      await this.addAttachments(tx, businessId, actor, created.id, clientId, attachments);
    }
    return created.id;
  }

  // ---------- Update ----------

  /**
   * Changes only what is sent; `null` clears. A list sent (reminders, collaborators, checklist)
   * replaces the stored one. `version` guards a concurrent save (409 SAVE_CONFLICT). Reopening a
   * NAME_CHANGE task while the client has another open one is 409 NAME_CHANGE_PENDING.
   */
  async update(
    businessId: string,
    actor: ClientsActor,
    id: string,
    body: UpdateBody,
  ): Promise<TaskDetail> {
    const { version, ...changes } = body;
    const task = await this.inFirm(businessId, async (tx) => {
      const { client, current } = await this.open(tx, businessId, actor, id);
      if (version !== undefined && version !== current.updatedAt.toISOString()) {
        throw taskErrors.saveConflict();
      }
      if (current.archivedAt && changes.status === undefined) throw taskClosed();
      if (changes.assignedUserId) {
        await checkAssignee(tx, businessId, changes.assignedUserId, client);
      }
      if (changes.typeId !== undefined && changes.typeId !== current.typeId) {
        await this.checkType(tx, businessId, changes.typeId);
      }
      if (changes.serviceId) await this.checkService(tx, businessId, changes.serviceId);
      const prerequisite =
        changes.dependsOnTaskId === undefined
          ? await this.currentPrerequisite(tx, businessId, current.dependsOnTaskId)
          : await this.prerequisite(tx, businessId, actor, id, changes.dependsOnTaskId);
      const shape = await this.shapeAfter(tx, current, changes, prerequisite);
      // A task cannot be worked while its prerequisite is open.
      if (
        shape.dependencyOpen &&
        changes.progress !== undefined &&
        changes.progress !== 'BLOCKED' &&
        changes.progress !== 'NOT_STARTED' &&
        changes.progress !== 'PENDING'
      ) {
        throw taskErrors.dependencyOpen();
      }
      this.checkShape(shape);
      if (
        changes.status === 'OPEN' &&
        current.kind === 'NAME_CHANGE' &&
        current.status !== 'OPEN'
      ) {
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
      const data = this.fieldsOf(changes, shape);
      if (changes.status !== undefined) {
        await this.checkCanSet(tx, businessId, current, changes.status);
        data.status = changes.status;
        data.completedAt = completedAtAfter(current, changes.status, new Date());
        data.completedByUserId = changes.status === 'DONE' ? actor.userId : null;
        if (
          changes.status === 'OPEN' &&
          current.status !== 'OPEN' &&
          changes.progress === undefined
        ) {
          data.progress = shape.dependencyOpen ? 'BLOCKED' : 'PENDING';
        }
      }
      await tx.task.update({
        where: { id },
        data: { ...data, updatedAt: new Date() },
        select: { id: true },
      });
      if (changes.additionalAssigneeIds !== undefined) {
        await this.saveAssignees(
          tx,
          businessId,
          id,
          changes.additionalAssigneeIds,
          changes.assignedUserId !== undefined ? changes.assignedUserId : current.assignedUserId,
        );
      }
      if (changes.checklist !== undefined) {
        await this.saveChecklist(tx, businessId, id, changes.checklist, true);
      }
      if (changes.reminders !== undefined) {
        await this.saveReminders(tx, businessId, id, shape.reminders);
      }
      if (changes.status === 'DONE' && current.status !== 'DONE')
        await this.unblock(tx, businessId, id);
      return this.reader.read(tx, businessId, null, id);
    }).catch(this.mapErrors(changes));
    // The stored id, not the URL's spelling (see the older service).
    await this.audit.log(
      'task.updated',
      { type: 'task', id: task.id },
      {
        clientId: task.client.id,
        fields: sentFields(changes, UPDATE_FIELDS),
        ...(changes.status === undefined ? {} : { status: changes.status }),
        ...(changes.assignedUserId === undefined
          ? {}
          : { assignedUserId: task.assignedTo?.userId ?? null }),
      },
    );
    return task;
  }

  /**
   * The dates, time, stage and reminders a stored task has once `changes` apply: the reminders
   * sent, or the stored ones, so a change of the due date or time (all-day, or none) is checked
   * against the reminders the task keeps.
   */
  private async shapeAfter(
    tx: TxClient,
    current: Task,
    changes: FieldChanges,
    prerequisite: Prerequisite,
  ): Promise<Shape> {
    const dueOn = changes.dueOn !== undefined ? changes.dueOn : day(current.dueOn);
    const allDayAsked = changes.allDay;
    const dueTime =
      changes.dueTime !== undefined
        ? changes.dueTime
        : dueOn === null
          ? null
          : current.dueTime
            ? current.dueTime.toISOString().slice(11, 16)
            : null;
    const shape: Shape = {
      dueOn,
      startOn: changes.startOn !== undefined ? changes.startOn : day(current.startOn),
      dueTime: dueOn === null ? null : dueTime,
      allDay:
        allDayAsked ??
        (changes.dueTime !== undefined ? changes.dueTime === null : current.allDay) ??
        true,
      progress: changes.progress ?? current.progress,
      blockedReason:
        changes.blockedReason !== undefined ? changes.blockedReason : current.blockedReason,
      dependsOnTaskId: prerequisite?.id ?? null,
      dependencyOpen: prerequisite !== null && prerequisite.status !== 'DONE',
      reminders: changes.reminders
        ? changes.reminders.map(reminderFrom)
        : await this.storedReminders(tx, current.id),
    };
    if (dueOn === null) shape.allDay = true;
    return shape;
  }

  /** The columns `changes` set; `null` clears. */
  private fieldsOf(changes: FieldChanges, shape: Shape): Prisma.TaskUncheckedUpdateInput {
    const data: Prisma.TaskUncheckedUpdateInput = {};
    if (changes.title !== undefined) data.title = changes.title;
    if (changes.details !== undefined) data.details = changes.details;
    if (changes.dueOn !== undefined)
      data.dueOn = changes.dueOn === null ? null : toDay(changes.dueOn);
    if (changes.assignedUserId !== undefined) data.assignedUserId = changes.assignedUserId;
    if (changes.typeId !== undefined) data.typeId = changes.typeId;
    if (changes.priority !== undefined) data.priority = changes.priority;
    if (changes.serviceId !== undefined) data.serviceId = changes.serviceId;
    if (changes.startOn !== undefined)
      data.startOn = changes.startOn === null ? null : toDay(changes.startOn);
    if (changes.clientVisible !== undefined) data.clientVisible = changes.clientVisible;
    if (changes.internalNotes !== undefined) data.internalNotes = changes.internalNotes;
    if (changes.blockedReason !== undefined) data.blockedReason = changes.blockedReason;
    if (changes.dependsOnTaskId !== undefined) data.dependsOnTaskId = shape.dependsOnTaskId;
    if (changes.progress !== undefined) data.progress = changes.progress;
    if (
      changes.dueOn !== undefined ||
      changes.dueTime !== undefined ||
      changes.allDay !== undefined
    ) {
      data.dueTime = shape.dueTime ? timeOfDayToDb(shape.dueTime) : null;
      data.allDay = shape.allDay;
    }
    return data;
  }

  // ---------- Drafts ----------

  /**
   * A draft's changes (PATCH, and the fields sent with publish), kept as sent as on Save as
   * Draft: only what is sent changes, `null` clears, a list replaces the stored one (a checklist
   * step with its `id` keeps its row). The ids must be the firm's and the draft storable; what
   * only publishing checks waits for `checkAsNew`. Setting, changing or clearing the client
   * clears the engagement and the attachments unless new ones (the new client's) are sent; a
   * Staff member sets only a client they reach (404). `current`: the draft, locked.
   */
  async editDraft(
    tx: TxClient,
    businessId: string,
    actor: ClientsActor,
    current: Task,
    changes: DraftChanges,
  ): Promise<void> {
    const id = current.id;
    const clientId =
      changes.clientId === undefined ? current.clientId : (changes.clientId?.toLowerCase() ?? null);
    const clientChanged = clientId !== current.clientId;
    if (clientChanged && clientId) {
      const client = await lockClient(tx, businessId, clientId);
      if (!client || !reachesClient(actor, client)) throw notFound();
    }
    if (changes.engagementId !== undefined) {
      await this.checkEngagement(tx, businessId, clientId, changes.engagementId);
    }
    if (changes.attachments?.length && !clientId) throw chooseClientFirst();
    if (changes.assignedUserId) await checkMember(tx, businessId, changes.assignedUserId);
    if (changes.typeId !== undefined && changes.typeId !== current.typeId) {
      await this.checkType(tx, businessId, changes.typeId, true);
    }
    if (changes.serviceId) await this.checkService(tx, businessId, changes.serviceId);
    const prerequisite =
      changes.dependsOnTaskId === undefined
        ? await this.currentPrerequisite(tx, businessId, current.dependsOnTaskId)
        : await this.prerequisite(tx, businessId, actor, id, changes.dependsOnTaskId);
    const shape = await this.shapeAfter(tx, current, changes, prerequisite);
    this.checkShape(shape, true);
    const data = this.fieldsOf(changes, shape);
    if (clientChanged) data.clientId = clientId;
    if (clientChanged || changes.engagementId !== undefined) {
      data.engagementId = changes.engagementId ?? null;
    }
    // The old client's documents go before the task takes another client.
    if (clientChanged || changes.attachments !== undefined) {
      await tx.taskAttachment.deleteMany({ where: { businessId, taskId: id } });
    }
    await tx.task.update({
      where: { id },
      data: { ...data, updatedAt: new Date() },
      select: { id: true },
    });
    if (changes.additionalAssigneeIds !== undefined) {
      await this.saveAssignees(
        tx,
        businessId,
        id,
        changes.additionalAssigneeIds,
        changes.assignedUserId !== undefined ? changes.assignedUserId : current.assignedUserId,
      );
    }
    if (changes.checklist !== undefined) {
      await this.saveChecklist(tx, businessId, id, changes.checklist, true);
    }
    if (changes.reminders !== undefined) {
      await this.saveReminders(tx, businessId, id, shape.reminders);
    }
    if (clientId && changes.attachments?.length) {
      await this.addAttachments(tx, businessId, actor, id, clientId, changes.attachments);
    }
  }

  /**
   * A draft about to go live, checked as `create` checks a new task and in its order: a client
   * (400 VALIDATION_FAILED naming `clientId` without one) the actor reaches (404), its
   * engagement, type, service, assignee, prerequisite and shape, then its collaborators,
   * checklist assignees and attachments. The draft as checked (its `updatedAt` guards the flip).
   */
  async checkAsNew(tx: TxClient, businessId: string, actor: ClientsActor, id: string) {
    const draft = await tx.task.findFirst({
      where: { businessId, id, status: 'DRAFT' },
      include: publishInclude,
    });
    if (!draft) throw notFound();
    if (!draft.clientId) throw taskErrors.invalid('clientId', 'Choose a client');
    const client = await lockClient(tx, businessId, draft.clientId);
    if (!client || !reachesClient(actor, client)) throw notFound();
    await this.checkEngagement(tx, businessId, draft.clientId, draft.engagementId);
    await this.checkType(tx, businessId, draft.typeId);
    await this.checkService(tx, businessId, draft.serviceId);
    if (draft.assignedUserId) {
      await this.checkAssigned(tx, businessId, draft.assignedUserId, client, false);
    }
    const prerequisite = await this.prerequisite(
      tx,
      businessId,
      actor,
      draft.id,
      draft.dependsOnTaskId,
    );
    this.checkShape({
      dueOn: day(draft.dueOn),
      startOn: day(draft.startOn),
      dueTime: draft.dueTime ? timeOfDayFromDb(draft.dueTime) : null,
      allDay: draft.allDay,
      progress: draft.progress,
      blockedReason: draft.blockedReason,
      dependsOnTaskId: prerequisite?.id ?? null,
      dependencyOpen: prerequisite !== null && prerequisite.status !== 'DONE',
      reminders: await this.storedReminders(tx, draft.id),
    });
    await this.checkMembers(
      tx,
      businessId,
      draft.assignees.map((a) => a.userId),
    );
    for (const item of draft.taskChecklistItems) {
      if (item.assignedUserId) await this.checkMembers(tx, businessId, [item.assignedUserId]);
    }
    await this.checkAttachments(tx, businessId, draft.clientId, draft.taskAttachments);
    return draft;
  }

  // ---------- Actions ----------

  complete(businessId: string, actor: ClientsActor, id: string) {
    return this.setStatus(businessId, actor, id, 'DONE', 'task.completed');
  }
  reopen(businessId: string, actor: ClientsActor, id: string) {
    return this.setStatus(businessId, actor, id, 'OPEN', 'task.reopened');
  }
  cancel(businessId: string, actor: ClientsActor, id: string) {
    return this.setStatus(businessId, actor, id, 'CANCELLED', 'task.cancelled');
  }

  private async setStatus(
    businessId: string,
    actor: ClientsActor,
    id: string,
    next: TaskStatus,
    action: string,
  ): Promise<TaskDetail> {
    const { task, from } = await this.inFirm(businessId, async (tx) => {
      const { current } = await this.open(tx, businessId, actor, id);
      if (current.archivedAt) throw taskClosed();
      if (current.status === next) {
        return { task: await this.reader.read(tx, businessId, null, id), from: current.status };
      }
      if (next === 'OPEN' && current.kind === 'NAME_CHANGE') {
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
      await this.checkCanSet(tx, businessId, current, next);
      const blocked = current.dependsOnTaskId
        ? ((
            await tx.task.findFirst({
              where: { businessId, id: current.dependsOnTaskId, ...LIVE_TASK },
              select: { status: true },
            })
          )?.status ?? 'DONE') !== 'DONE'
        : false;
      await tx.task.update({
        where: { id },
        data: {
          status: next,
          completedAt: completedAtAfter(current, next, new Date()),
          completedByUserId: next === 'DONE' ? actor.userId : null,
          ...(next === 'OPEN' ? { progress: blocked ? 'BLOCKED' : 'PENDING' } : {}),
          updatedAt: new Date(),
        },
        select: { id: true },
      });
      if (next === 'DONE') await this.unblock(tx, businessId, id);
      return { task: await this.reader.read(tx, businessId, null, id), from: current.status };
    }).catch(this.mapErrors({}));
    if (from !== next) {
      await this.audit.log(
        action,
        { type: 'task', id: task.id },
        { clientId: task.client.id, from, to: next },
      );
    }
    return task;
  }

  async setProgress(
    businessId: string,
    actor: ClientsActor,
    id: string,
    progress: TaskProgress,
  ): Promise<TaskDetail> {
    const { task, from } = await this.inFirm(businessId, async (tx) => {
      const { current } = await this.open(tx, businessId, actor, id);
      if (current.status !== 'OPEN' || current.archivedAt) throw taskClosed();
      if (progress === 'IN_PROGRESS' || progress === 'WAITING') {
        const prerequisite = await this.currentPrerequisite(
          tx,
          businessId,
          current.dependsOnTaskId,
        );
        if (prerequisite && prerequisite.status !== 'DONE') throw taskErrors.dependencyOpen();
      }
      if (progress === 'BLOCKED' && !current.blockedReason && !current.dependsOnTaskId) {
        throw taskErrors.invalid('progress', 'Say why it is blocked, or choose a prerequisite');
      }
      await tx.task.update({
        where: { id },
        data: { progress, updatedAt: new Date() },
        select: { id: true },
      });
      return { task: await this.reader.read(tx, businessId, null, id), from: current.progress };
    });
    if (from !== progress) {
      await this.audit.log(
        'task.progress_changed',
        { type: 'task', id: task.id },
        { clientId: task.client.id, from, to: progress },
      );
    }
    return task;
  }

  async duplicate(businessId: string, actor: ClientsActor, id: string): Promise<TaskDetail> {
    const task = await this.inFirm(businessId, async (tx) => {
      const { client, current } = await this.open(tx, businessId, actor, id);
      const [items, reminders, extra] = await Promise.all([
        tx.taskChecklistItem.findMany({
          where: { businessId, taskId: id },
          orderBy: { position: 'asc' },
        }),
        tx.taskReminder.findMany({ where: { businessId, taskId: id } }),
        tx.taskAssignee.findMany({ where: { businessId, taskId: id }, select: { userId: true } }),
      ]);
      // A copy keeps the assignee only while that person may still take this client's tasks.
      let assignedUserId = current.assignedUserId;
      if (assignedUserId) {
        try {
          await checkAssignee(tx, businessId, assignedUserId, client);
        } catch {
          assignedUserId = null;
        }
      }
      const type = await this.liveType(tx, current.typeId);
      const created = await tx.task.create({
        data: {
          businessId,
          clientId: current.clientId,
          engagementId: current.engagementId,
          title: `${current.title.slice(0, 193)} (Copy)`,
          details: current.details,
          dueOn: current.dueOn,
          startOn: current.startOn,
          dueTime: current.dueTime,
          allDay: current.allDay,
          assignedUserId,
          createdByUserId: actor.userId,
          typeId: type,
          serviceId: current.serviceId,
          priority: current.priority,
          clientVisible: current.clientVisible,
          internalNotes: current.internalNotes,
          templateId: current.templateId,
        },
        select: { id: true },
      });
      await tx.taskChecklistItem.createMany({
        data: items.map((i, position) => ({
          businessId,
          taskId: created.id,
          label: i.label,
          position,
          required: i.required,
          assignedUserId: i.assignedUserId,
        })),
      });
      // Days rules and Custom ones alike (the copy keeps the due date and time).
      await tx.taskReminder.createMany({
        data: reminders.map((r) => ({
          businessId,
          taskId: created.id,
          ...reminderRow(reminderFromRow(r)),
        })),
      });
      await tx.taskAssignee.createMany({
        data: extra
          .filter((e) => e.userId !== assignedUserId)
          .map((e) => ({ businessId, taskId: created.id, userId: e.userId })),
      });
      return { task: await this.reader.read(tx, businessId, null, created.id), source: id };
    }).catch(this.mapErrors({}));
    await this.audit.log(
      'task.duplicated',
      { type: 'task', id: task.task.id },
      { clientId: task.task.client.id, from: task.source },
    );
    return task.task;
  }

  archive(businessId: string, actor: ClientsActor, id: string) {
    return this.setArchived(businessId, actor, id, true);
  }
  restore(businessId: string, actor: ClientsActor, id: string) {
    return this.setArchived(businessId, actor, id, false);
  }

  private async setArchived(
    businessId: string,
    actor: ClientsActor,
    id: string,
    archive: boolean,
  ): Promise<TaskDetail> {
    const { task, changed } = await this.inFirm(businessId, async (tx) => {
      const { current } = await this.open(tx, businessId, actor, id);
      if ((current.archivedAt !== null) === archive) {
        return { task: await this.reader.read(tx, businessId, null, id), changed: false };
      }
      await tx.task.update({
        where: { id },
        data: { archivedAt: archive ? new Date() : null, updatedAt: new Date() },
        select: { id: true },
      });
      return { task: await this.reader.read(tx, businessId, null, id), changed: true };
    });
    if (changed) {
      await this.audit.log(
        archive ? 'task.archived' : 'task.restored',
        { type: 'task', id: task.id },
        { clientId: task.client.id },
      );
    }
    return task;
  }

  // ---------- Checklist ----------

  completeItem(businessId: string, actor: ClientsActor, id: string, itemId: string) {
    return this.toggleItem(businessId, actor, id, itemId, true);
  }
  reopenItem(businessId: string, actor: ClientsActor, id: string, itemId: string) {
    return this.toggleItem(businessId, actor, id, itemId, false);
  }

  private async toggleItem(
    businessId: string,
    actor: ClientsActor,
    id: string,
    itemId: string,
    done: boolean,
  ): Promise<TaskDetail> {
    const { task, changed } = await this.inFirm(businessId, async (tx) => {
      const { current } = await this.open(tx, businessId, actor, id);
      if (current.archivedAt) throw taskClosed();
      const item = await tx.taskChecklistItem.findFirst({
        where: { businessId, taskId: id, id: itemId },
        select: { id: true, completedAt: true },
      });
      if (!item) throw notFound();
      if ((item.completedAt !== null) === done) {
        return { task: await this.reader.read(tx, businessId, null, id), changed: false };
      }
      await tx.taskChecklistItem.update({
        where: { id: itemId },
        data: done
          ? { completedAt: new Date(), completedByUserId: actor.userId }
          : { completedAt: null, completedByUserId: null },
      });
      await tx.task.update({
        where: { id },
        data: { updatedAt: new Date() },
        select: { id: true },
      });
      return { task: await this.reader.read(tx, businessId, null, id), changed: true };
    });
    if (changed) {
      await this.audit.log(
        done ? 'task.checklist_item_completed' : 'task.checklist_item_reopened',
        { type: 'task', id: task.id },
        { clientId: task.client.id, itemId: itemId.toLowerCase() },
      );
    }
    return task;
  }

  async reorderChecklist(
    businessId: string,
    actor: ClientsActor,
    id: string,
    body: ReorderChecklistRequest,
  ): Promise<TaskDetail> {
    const ids = (body as { ids: string[] }).ids.map((i) => i.toLowerCase());
    const task = await this.inFirm(businessId, async (tx) => {
      const { current } = await this.open(tx, businessId, actor, id);
      if (current.archivedAt) throw taskClosed();
      const items = await tx.taskChecklistItem.findMany({
        where: { businessId, taskId: id },
        select: { id: true },
      });
      const known = new Set(items.map((i) => i.id));
      if (
        ids.length !== items.length ||
        new Set(ids).size !== ids.length ||
        !ids.every((i) => known.has(i))
      ) {
        throw taskErrors.invalid('ids', 'List each step of the checklist once');
      }
      for (const [position, itemId] of ids.entries()) {
        await tx.taskChecklistItem.update({ where: { id: itemId }, data: { position } });
      }
      await tx.task.update({
        where: { id },
        data: { updatedAt: new Date() },
        select: { id: true },
      });
      return this.reader.read(tx, businessId, null, id);
    });
    await this.audit.log(
      'task.checklist_reordered',
      { type: 'task', id: task.id },
      { clientId: task.client.id },
    );
    return task;
  }

  // ---------- Attachments ----------

  async addAttachment(
    businessId: string,
    actor: ClientsActor,
    id: string,
    body: { documentId: string; clientVisible?: boolean },
  ): Promise<TaskAttachment> {
    const attachment = await this.inFirm(businessId, async (tx) => {
      const { clientId, current } = await this.open(tx, businessId, actor, id);
      if (current.archivedAt) throw taskClosed();
      await this.addAttachments(tx, businessId, actor, id, clientId, [body]);
      await tx.task.update({
        where: { id },
        data: { updatedAt: new Date() },
        select: { id: true },
      });
      const detail = await this.reader.read(tx, businessId, null, id);
      return detail.attachments.find(
        (a) => a.documentId.toLowerCase() === body.documentId.toLowerCase(),
      )!;
    });
    await this.audit.log(
      'task.attachment_added',
      { type: 'task', id },
      {
        attachmentId: attachment.id,
        documentId: attachment.documentId,
        clientVisible: attachment.clientVisible,
      },
    );
    return attachment;
  }

  async updateAttachment(
    businessId: string,
    actor: ClientsActor,
    id: string,
    attachmentId: string,
    body: { clientVisible: boolean },
  ): Promise<TaskAttachment> {
    const attachment = await this.inFirm(businessId, async (tx) => {
      await this.open(tx, businessId, actor, id);
      const row = await tx.taskAttachment.findFirst({
        where: { businessId, taskId: id, id: attachmentId },
        select: { id: true },
      });
      if (!row) throw notFound();
      try {
        await tx.taskAttachment.update({
          where: { id: attachmentId },
          data: { clientVisible: body.clientVisible },
        });
      } catch (e) {
        if (isCheckViolation(e)) throw taskErrors.attachmentNotAllowed();
        throw e;
      }
      await tx.task.update({
        where: { id },
        data: { updatedAt: new Date() },
        select: { id: true },
      });
      const detail = await this.reader.read(tx, businessId, null, id);
      return detail.attachments.find((a) => a.id.toLowerCase() === attachmentId.toLowerCase())!;
    });
    await this.audit.log(
      'task.attachment_updated',
      { type: 'task', id },
      { attachmentId: attachment.id, clientVisible: attachment.clientVisible },
    );
    return attachment;
  }

  async removeAttachment(
    businessId: string,
    actor: ClientsActor,
    id: string,
    attachmentId: string,
  ): Promise<void> {
    const documentId = await this.inFirm(businessId, async (tx) => {
      await this.open(tx, businessId, actor, id);
      const row = await tx.taskAttachment.findFirst({
        where: { businessId, taskId: id, id: attachmentId },
        select: { documentId: true },
      });
      if (!row) throw notFound();
      await tx.taskAttachment.delete({ where: { id: attachmentId } });
      await tx.task.update({
        where: { id },
        data: { updatedAt: new Date() },
        select: { id: true },
      });
      return row.documentId;
    });
    await this.audit.log(
      'task.attachment_removed',
      { type: 'task', id },
      { attachmentId: attachmentId.toLowerCase(), documentId },
    );
  }

  // ---------- Pieces shared with bulk and the series ----------

  /**
   * The client, then the task, both locked: the one order everywhere. 404 when out of reach, and
   * for a draft (only the Drafts routes change a draft).
   */
  async open(tx: TxClient, businessId: string, actor: ClientsActor, id: string) {
    const owner = await tx.task.findFirst({
      where: { businessId, id, ...LIVE_TASK },
      select: { clientId: true },
    });
    if (!owner) throw notFound();
    const clientId = liveClient(owner.clientId);
    const client = await lockClient(tx, businessId, clientId);
    if (!client || !reachesClient(actor, client)) throw notFound();
    const [locked] = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM tasks WHERE business_id = ${businessId}::uuid AND id = ${id}::uuid FOR UPDATE`;
    if (!locked) throw notFound();
    const current = await tx.task.findFirst({ where: { businessId, id, ...LIVE_TASK } });
    if (!current || current.clientId !== clientId) throw notFound();
    return { client, clientId, current };
  }

  /** What the task needs before it can take this status: done needs its steps and prerequisite. */
  async checkCanSet(
    tx: TxClient,
    businessId: string,
    current: { id: string; status: StoredTaskStatus; dependsOnTaskId: string | null },
    next: TaskStatus,
  ): Promise<void> {
    if (next !== 'DONE' || current.status === 'DONE') return;
    const open = await tx.taskChecklistItem.count({
      where: { businessId, taskId: current.id, required: true, completedAt: null },
    });
    if (open > 0) throw taskErrors.requiredItemsOpen();
    const prerequisite = await this.currentPrerequisite(tx, businessId, current.dependsOnTaskId);
    if (prerequisite && prerequisite.status !== 'DONE') throw taskErrors.dependencyOpen();
  }

  /** The tasks that waited for this one are no longer blocked by it. */
  private async unblock(tx: TxClient, businessId: string, id: string): Promise<void> {
    await tx.task.updateMany({
      where: {
        businessId,
        dependsOnTaskId: id,
        status: 'OPEN',
        progress: 'BLOCKED',
        blockedReason: null,
      },
      data: { progress: 'PENDING' },
    });
  }

  mapErrors(changes: { assignedUserId?: string | null }) {
    return (error: unknown): never => {
      if (isUniqueViolation(error)) {
        // task_reminders_*: each rule once (only a backstop: the rules are checked first).
        if (violatedIndex(error)?.startsWith('task_reminders')) throw reminderErrors.once();
        // tasks_one_open_name_change: another name change of this client opened at the same time.
        throw nameChangePending();
      }
      if (changes.assignedUserId && isForeignKeyViolation(error)) throw notAMember();
      if (isCheckViolation(error)) {
        const text = String((error as { message?: unknown }).message ?? '');
        if (/required checklist/.test(text)) throw taskErrors.requiredItemsOpen();
        if (/depend on itself|through other tasks/.test(text)) {
          throw taskErrors.bad('DEPENDENCY_CYCLE', 'That would make the tasks wait for each other');
        }
      }
      throw error;
    };
  }

  // ---------- Checks ----------

  /**
   * The shape a task must have. A draft (`draft`) only needs what the database can hold (the
   * start before the due date, a time with a due date and "all day" off, each reminder once);
   * the stage and the reminders' timing (a due date, a due time for a Custom one, never after
   * the due time or two at one moment) are checked when it is published.
   */
  private checkShape(s: Shape, draft = false): void {
    if (s.startOn && s.dueOn && s.startOn > s.dueOn) {
      throw taskErrors.invalid('startOn', 'Start on or before the due date');
    }
    if (s.dueTime && (s.dueOn === null || s.allDay)) {
      throw taskErrors.invalid('dueTime', 'A time needs a due date and "all day" off');
    }
    if (!draft && s.progress === 'BLOCKED' && !s.blockedReason && !s.dependencyOpen) {
      throw taskErrors.invalid('progress', 'Say why it is blocked, or choose a prerequisite');
    }
    if (!draft && s.reminders.length > 0 && s.dueOn === null) throw reminderErrors.needsDueDate();
    checkReminders(s.reminders, timedDue(s), !draft);
  }

  /** The engagement must be the client's (409 ENGAGEMENT_MISMATCH); without a client, none. */
  private async checkEngagement(
    tx: TxClient,
    businessId: string,
    clientId: string | null,
    engagementId: string | null | undefined,
  ): Promise<void> {
    if (!engagementId) return;
    if (!clientId) throw chooseClientFirst();
    const engagement = await tx.engagement.findFirst({
      where: { businessId, id: engagementId, clientId },
      select: { id: true },
    });
    if (!engagement) throw engagementMismatch();
  }

  /**
   * The type must be the firm's (400) and in use (409 TYPE_ARCHIVED); a draft may keep an
   * archived one until it is published.
   */
  private async checkType(
    tx: TxClient,
    businessId: string,
    typeId: string | null | undefined,
    draft = false,
  ) {
    if (!typeId) return;
    const type = await tx.taskType.findFirst({
      where: { businessId, id: typeId },
      select: { archivedAt: true },
    });
    if (!type) throw taskErrors.invalid('typeId', 'Choose a task type');
    if (type.archivedAt && !draft) throw taskErrors.typeArchived();
  }

  private async checkService(
    tx: TxClient,
    businessId: string,
    serviceId: string | null | undefined,
  ) {
    if (!serviceId) return;
    const service = await tx.service.findFirst({
      where: { businessId, id: serviceId },
      select: { id: true },
    });
    if (!service) throw taskErrors.invalid('serviceId', 'Choose a service');
  }

  /**
   * The assignee a request names: an active member who may take the client's tasks; a draft's
   * (or one with no client yet) only an active member, the client's reach waiting for publishing.
   */
  private async checkAssigned(
    tx: TxClient,
    businessId: string,
    userId: string,
    client: { assignedUserId: string | null } | null,
    draft: boolean,
  ): Promise<void> {
    if (draft || !client) await checkMember(tx, businessId, userId);
    else await checkAssignee(tx, businessId, userId, client);
  }

  /** Active members of the firm, every one (409 NOT_A_MEMBER otherwise). */
  private async checkMembers(tx: TxClient, businessId: string, ids: string[]): Promise<void> {
    const wanted = [...new Set(ids.map((i) => i.toLowerCase()))];
    if (wanted.length === 0) return;
    const members = await tx.membership.count({
      where: { businessId, userId: { in: wanted }, status: 'ACTIVE' },
    });
    if (members !== wanted.length) throw notAMember();
  }

  /** The type when it is still in use (a template's archived type is dropped, not an error). */
  private async liveType(tx: TxClient, typeId: string | null | undefined): Promise<string | null> {
    if (!typeId) return null;
    const type = await tx.taskType.findFirst({
      where: { id: typeId },
      select: { archivedAt: true },
    });
    return type && !type.archivedAt ? typeId : null;
  }

  /**
   * The prerequisite: a live task the actor reaches (else 400; never a draft), checked for a
   * loop. Null clears it.
   */
  private async prerequisite(
    tx: TxClient,
    businessId: string,
    actor: ClientsActor,
    taskId: string | null,
    prerequisiteId: string | null | undefined,
  ): Promise<Prerequisite> {
    if (!prerequisiteId) return null;
    if (taskId && prerequisiteId.toLowerCase() === taskId.toLowerCase()) {
      throw taskErrors.bad('DEPENDENCY_CYCLE', 'A task cannot wait for itself');
    }
    const found = await tx.task.findFirst({
      where: { businessId, id: prerequisiteId, ...LIVE_TASK, ...reach(actor) },
      select: { id: true, status: true },
    });
    if (!found) throw taskErrors.invalid('dependsOnTaskId', 'Choose a task of this firm');
    // Walk the chain: reaching this task would close a loop (the database refuses it too).
    let next: string | null = found.id;
    for (let steps = 0; taskId && next && steps < 100; steps++) {
      if (next.toLowerCase() === taskId.toLowerCase()) {
        throw taskErrors.bad('DEPENDENCY_CYCLE', 'That would make the tasks wait for each other');
      }
      const link: { dependsOnTaskId: string | null } | null = await tx.task.findFirst({
        where: { businessId, id: next },
        select: { dependsOnTaskId: true },
      });
      next = link?.dependsOnTaskId ?? null;
    }
    return found;
  }

  private async currentPrerequisite(tx: TxClient, businessId: string, id: string | null) {
    if (!id) return null;
    return tx.task.findFirst({
      where: { businessId, id, ...LIVE_TASK },
      select: { id: true, status: true },
    });
  }

  private async storedReminders(tx: TxClient, taskId: string): Promise<Reminder[]> {
    const rows = await tx.taskReminder.findMany({ where: { taskId } });
    return rows.map(reminderFromRow);
  }

  private async template(tx: TxClient, businessId: string, id: string) {
    const tpl = await tx.taskTemplate.findFirst({ where: { businessId, id } });
    if (!tpl || tpl.archivedAt) throw taskErrors.invalid('templateId', 'Choose a template');
    return tpl;
  }

  /**
   * A template's assignment rule: its person, or the client's own assignee, if they can take it.
   * A draft with no client yet keeps its person while they are an active member (publishing
   * checks the client's reach) and has no client assignee.
   */
  private async templateAssignee(
    tx: TxClient,
    businessId: string,
    tpl: { assignmentRule: string; assignedUserId: string | null } | null,
    client: { assignedUserId: string | null } | null,
  ): Promise<string | null> {
    const wanted =
      tpl?.assignmentRule === 'SPECIFIC_USER'
        ? tpl.assignedUserId
        : tpl?.assignmentRule === 'CLIENT_TEAM'
          ? (client?.assignedUserId ?? null)
          : null;
    if (!wanted) return null;
    try {
      if (client) await checkAssignee(tx, businessId, wanted, client);
      else await checkMember(tx, businessId, wanted);
      return wanted;
    } catch {
      return null;
    }
  }

  // ---------- The lists of a task ----------

  /** Collaborators: active members of the firm; the primary assignee is not repeated. */
  private async saveAssignees(
    tx: TxClient,
    businessId: string,
    taskId: string,
    ids: string[] | undefined,
    primary: string | null | undefined,
  ): Promise<void> {
    if (ids === undefined) return;
    const wanted = [...new Set(ids.map((i) => i.toLowerCase()))].filter(
      (i) => i !== primary?.toLowerCase(),
    );
    await this.checkMembers(tx, businessId, wanted);
    await tx.taskAssignee.deleteMany({ where: { taskId, userId: { notIn: wanted } } });
    await tx.taskAssignee.createMany({
      data: wanted.map((userId) => ({ businessId, taskId, userId })),
      skipDuplicates: true,
    });
  }

  /**
   * Sets the checklist. An item with an `id` of this task keeps its row and completion; the others
   * are new; items left out are removed. `replace`: for an update, else the task is new.
   */
  private async saveChecklist(
    tx: TxClient,
    businessId: string,
    taskId: string,
    items: ChecklistInput[] | { label: string; required: boolean }[],
    replace = false,
  ): Promise<void> {
    const stored = replace
      ? await tx.taskChecklistItem.findMany({ where: { taskId }, select: { id: true } })
      : [];
    const known = new Set(stored.map((s) => s.id));
    const keep: string[] = [];
    for (const [position, raw] of items.entries()) {
      const item = raw as ChecklistInput;
      if (item.assignedUserId) await this.checkMembers(tx, businessId, [item.assignedUserId]);
      if (item.id && !known.has(item.id.toLowerCase())) {
        throw taskErrors.invalid(`checklist.${position}.id`, 'Unknown step');
      }
      const data = {
        label: item.label,
        required: item.required ?? false,
        position,
        ...(item.assignedUserId !== undefined ? { assignedUserId: item.assignedUserId } : {}),
      };
      if (item.id) {
        keep.push(item.id.toLowerCase());
        await tx.taskChecklistItem.update({ where: { id: item.id }, data });
      } else {
        const made = await tx.taskChecklistItem.create({
          data: { businessId, taskId, ...data },
          select: { id: true },
        });
        keep.push(made.id);
      }
    }
    if (replace) await tx.taskChecklistItem.deleteMany({ where: { taskId, id: { notIn: keep } } });
  }

  private async saveReminders(
    tx: TxClient,
    businessId: string,
    taskId: string,
    reminders: Reminder[],
  ): Promise<void> {
    await tx.taskReminder.deleteMany({ where: { taskId } });
    await tx.taskReminder.createMany({
      data: reminders.map((r) => ({ businessId, taskId, ...reminderRow(r) })),
    });
  }

  /** The client's own documents only; an internal one is never client-visible. */
  private async checkAttachments(
    tx: TxClient,
    businessId: string,
    clientId: string,
    list: { documentId: string; clientVisible?: boolean }[],
  ): Promise<void> {
    if (list.length === 0) return;
    const ids = [...new Set(list.map((a) => a.documentId.toLowerCase()))];
    const docs = await tx.document.findMany({
      where: { businessId, clientId, id: { in: ids } },
      select: { id: true, direction: true },
    });
    const byId = new Map(docs.map((d) => [d.id, d]));
    for (const a of list) {
      const doc = byId.get(a.documentId.toLowerCase());
      if (!doc || (a.clientVisible && doc.direction === 'INTERNAL')) {
        throw taskErrors.attachmentNotAllowed();
      }
    }
  }

  private async addAttachments(
    tx: TxClient,
    businessId: string,
    actor: ClientsActor,
    taskId: string,
    clientId: string,
    list: { documentId: string; clientVisible?: boolean }[],
  ): Promise<void> {
    if (list.length === 0) return;
    await this.checkAttachments(tx, businessId, clientId, list);
    for (const a of list) {
      try {
        await tx.taskAttachment.create({
          data: {
            businessId,
            taskId,
            documentId: a.documentId,
            clientVisible: a.clientVisible ?? false,
            addedByUserId: actor.userId,
          },
        });
      } catch (e) {
        if (isUniqueViolation(e))
          throw taskErrors.invalid('attachments', 'Attach each document once');
        throw e;
      }
    }
  }
}

const isCheckViolation = (e: unknown) =>
  (e as { code?: unknown } | null)?.code === 'P2004' ||
  /check_violation|violates check|tasks: |task attachments: /.test(
    String((e as { message?: unknown } | null)?.message ?? ''),
  );

function day(d: Date | null): string | null {
  return d ? d.toISOString().slice(0, 10) : null;
}

/** The due time a task's reminders count back from: none when it has no date or is all-day. */
const timedDue = (s: { dueOn: string | null; dueTime: string | null; allDay: boolean }) =>
  s.dueOn !== null && !s.allDay ? s.dueTime : null;

/**
 * A template's reminders (JSON) for a new task: never refused. A live task leaves out the ones
 * that do not fit it (all of them without a due date); a draft keeps them all for publishing to
 * check, as if sent.
 */
function templateReminders(
  json: unknown,
  due: { dueOn: string | null; dueTime: string | null },
  draft: boolean,
): Reminder[] {
  const rules = remindersFromJson(json);
  if (draft) return rules;
  return due.dueOn === null ? [] : fitReminders(rules, due.dueTime);
}

/** A template's checklist (JSON) as steps. */
function checklistRules(json: unknown): { label: string; required: boolean }[] {
  if (!Array.isArray(json)) return [];
  return json.map((i: { label: string; required?: boolean }) => ({
    label: i.label,
    required: i.required ?? false,
  }));
}
