import { Inject, Injectable } from '@nestjs/common';
import type { Database, Prisma, TxClient } from '@firmivra/db';
import type {
  ReorderChecklistRequest,
  TaskAttachment,
  TaskDetail,
  TaskProgress,
  TaskStatus,
} from '@firmivra/types';
import type { z } from 'zod';
import { addDays, timeOfDayToDb } from '../appointments/calendar.js';
import { AuditService } from '../audit/audit.service.js';
import type { ClientsActor } from '../clients/clients.service.js';
import { DATABASE } from '../database/database.module.js';
import {
  checkAssignee,
  conflict,
  isForeignKeyViolation,
  isUniqueViolation,
  lockClient,
  notAMember,
  notFound,
  reachesClient,
  sentFields,
  toDay,
} from '../workspaces/common.js';
import { completedAtAfter } from '../workspaces/tasks.service.js';
import { taskErrors } from './task-common.js';
import type { CreateTaskDetailRequest, UpdateTaskDetailRequest } from './task-input.js';
import { firmClock, reach, TaskReadService } from './task-read.service.js';

type CreateBody = z.output<typeof CreateTaskDetailRequest>;
type UpdateBody = z.output<typeof UpdateTaskDetailRequest>;
type Reminder = NonNullable<CreateBody['reminders']>[number];
type ChecklistInput = NonNullable<CreateBody['checklist']>[number];

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

/**
 * Creating and changing tasks (contract in packages/types/src/tasks): the older fields with the
 * older rules (Staff reach only their assigned clients' tasks, a Staff assignee only on their own
 * clients: Rasel, Oct 8, q5), and the Tasks module's: type, priority, stage, dates and time,
 * visibility, notes, collaborators, checklist, reminders, prerequisite and attachments. Every
 * change locks the client and then the task, as the older service did. Audited with ids,
 * statuses and field names only: never a title, details, notes, a checklist label or a file name.
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
      const clock = await firmClock(tx, businessId);
      const tpl = body.templateId ? await this.template(tx, businessId, body.templateId) : null;
      if (body.engagementId) {
        const engagement = await tx.engagement.findFirst({
          where: { businessId, id: body.engagementId, clientId: body.clientId },
          select: { id: true },
        });
        if (!engagement) throw engagementMismatch();
      }
      const typeId = body.typeId !== undefined ? body.typeId : await this.liveType(tx, tpl?.typeId);
      const serviceId = body.serviceId !== undefined ? body.serviceId : (tpl?.serviceId ?? null);
      await this.checkType(tx, businessId, typeId);
      await this.checkService(tx, businessId, serviceId);
      const assignedUserId =
        body.assignedUserId ?? (await this.templateAssignee(tx, businessId, tpl, client));
      if (body.assignedUserId) await checkAssignee(tx, businessId, body.assignedUserId, client);
      const dueOn =
        body.dueOn ?? (tpl?.dueOffsetDays != null ? addDays(clock.today, tpl.dueOffsetDays) : null);
      const dueTime = body.dueTime ?? null;
      const prerequisite = await this.prerequisite(
        tx,
        businessId,
        actor,
        null,
        body.dependsOnTaskId,
      );
      const reminders = body.reminders ?? reminderRules(tpl?.reminders);
      const checklist = body.checklist ?? checklistRules(tpl?.checklist);
      const shape: Shape = {
        dueOn,
        startOn: body.startOn ?? null,
        dueTime,
        allDay: body.allDay ?? dueTime === null,
        progress:
          body.progress ??
          (prerequisite?.status === 'DONE' || !prerequisite ? 'PENDING' : 'BLOCKED'),
        blockedReason: body.blockedReason ?? null,
        dependsOnTaskId: prerequisite?.id ?? null,
        dependencyOpen: prerequisite !== null && prerequisite.status !== 'DONE',
        reminders,
      };
      this.checkShape(shape);
      const created = await tx.task.create({
        data: {
          businessId,
          clientId: body.clientId,
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
      await this.addAttachments(
        tx,
        businessId,
        actor,
        created.id,
        body.clientId,
        body.attachments ?? [],
      );
      return this.reader.read(tx, businessId, null, created.id);
    }).catch((error: unknown) => {
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
        fields: sentFields(body, CREATE_FIELDS),
        ...(body.templateId ? { templateId: body.templateId.toLowerCase() } : {}),
      },
    );
    return task;
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
        reminders: changes.reminders ?? (await this.storedReminders(tx, id)),
      };
      if (dueOn === null) shape.allDay = true;
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
        await this.saveReminders(tx, businessId, id, changes.reminders);
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
              where: { businessId, id: current.dependsOnTaskId },
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
      await tx.taskReminder.createMany({
        data: reminders.map((r) => ({
          businessId,
          taskId: created.id,
          daysBefore: r.daysBefore,
          timeOfDay: r.timeOfDay,
          inApp: r.inApp,
          channels: r.channels,
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
      const { current } = await this.open(tx, businessId, actor, id);
      if (current.archivedAt) throw taskClosed();
      await this.addAttachments(tx, businessId, actor, id, current.clientId, [body]);
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

  /** The client, then the task, both locked: the one order everywhere. 404 when out of reach. */
  async open(tx: TxClient, businessId: string, actor: ClientsActor, id: string) {
    const owner = await tx.task.findFirst({
      where: { businessId, id },
      select: { clientId: true },
    });
    if (!owner) throw notFound();
    const client = await lockClient(tx, businessId, owner.clientId);
    if (!client || !reachesClient(actor, client)) throw notFound();
    const [locked] = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM tasks WHERE business_id = ${businessId}::uuid AND id = ${id}::uuid FOR UPDATE`;
    if (!locked) throw notFound();
    const current = await tx.task.findFirst({ where: { businessId, id } });
    if (!current || current.clientId !== owner.clientId) throw notFound();
    return { client, current };
  }

  /** What the task needs before it can take this status: done needs its steps and prerequisite. */
  async checkCanSet(
    tx: TxClient,
    businessId: string,
    current: { id: string; status: TaskStatus; dependsOnTaskId: string | null },
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
      // tasks_one_open_name_change: another name change of this client opened at the same time.
      if (isUniqueViolation(error)) throw nameChangePending();
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

  private checkShape(s: Shape): void {
    if (s.startOn && s.dueOn && s.startOn > s.dueOn) {
      throw taskErrors.invalid('startOn', 'Start on or before the due date');
    }
    if (s.dueTime && (s.dueOn === null || s.allDay)) {
      throw taskErrors.invalid('dueTime', 'A time needs a due date and "all day" off');
    }
    if (s.progress === 'BLOCKED' && !s.blockedReason && !s.dependencyOpen) {
      throw taskErrors.invalid('progress', 'Say why it is blocked, or choose a prerequisite');
    }
    if (s.reminders.length > 0 && s.dueOn === null) {
      throw taskErrors.bad('INVALID_REMINDER', 'Set a due date before adding reminders');
    }
    const seen = new Set<string>();
    for (const r of s.reminders) {
      const key = `${r.daysBefore}@${r.timeOfDay ?? ''}`;
      if (seen.has(key))
        throw taskErrors.bad('INVALID_REMINDER', 'Each reminder can be added once');
      seen.add(key);
      // On the due day itself, a reminder after the due time is too late.
      if (r.daysBefore === 0 && r.timeOfDay && s.dueTime && r.timeOfDay > s.dueTime) {
        throw taskErrors.bad('INVALID_REMINDER', 'A reminder cannot be after the due time');
      }
    }
  }

  private async checkType(tx: TxClient, businessId: string, typeId: string | null | undefined) {
    if (!typeId) return;
    const type = await tx.taskType.findFirst({
      where: { businessId, id: typeId },
      select: { archivedAt: true },
    });
    if (!type) throw taskErrors.invalid('typeId', 'Choose a task type');
    if (type.archivedAt) throw taskErrors.typeArchived();
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

  /** The type when it is still in use (a template's archived type is dropped, not an error). */
  private async liveType(tx: TxClient, typeId: string | null | undefined): Promise<string | null> {
    if (!typeId) return null;
    const type = await tx.taskType.findFirst({
      where: { id: typeId },
      select: { archivedAt: true },
    });
    return type && !type.archivedAt ? typeId : null;
  }

  /** The prerequisite the actor reaches (else 400), checked for a loop. Null clears it. */
  private async prerequisite(
    tx: TxClient,
    businessId: string,
    actor: ClientsActor,
    taskId: string | null,
    prerequisiteId: string | null | undefined,
  ): Promise<{ id: string; status: TaskStatus } | null> {
    if (!prerequisiteId) return null;
    if (taskId && prerequisiteId.toLowerCase() === taskId.toLowerCase()) {
      throw taskErrors.bad('DEPENDENCY_CYCLE', 'A task cannot wait for itself');
    }
    const found = await tx.task.findFirst({
      where: { businessId, id: prerequisiteId, ...reach(actor) },
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
    return tx.task.findFirst({ where: { businessId, id }, select: { id: true, status: true } });
  }

  private async storedReminders(tx: TxClient, taskId: string): Promise<Reminder[]> {
    const rows = await tx.taskReminder.findMany({ where: { taskId } });
    return rows.map((r) => ({
      daysBefore: r.daysBefore,
      timeOfDay: r.timeOfDay ? r.timeOfDay.toISOString().slice(11, 16) : null,
      inApp: r.inApp,
      channels: r.channels,
    }));
  }

  private async template(tx: TxClient, businessId: string, id: string) {
    const tpl = await tx.taskTemplate.findFirst({ where: { businessId, id } });
    if (!tpl || tpl.archivedAt) throw taskErrors.invalid('templateId', 'Choose a template');
    return tpl;
  }

  /** A template's assignment rule: its person, or the client's own assignee, if they can take it. */
  private async templateAssignee(
    tx: TxClient,
    businessId: string,
    tpl: { assignmentRule: string; assignedUserId: string | null } | null,
    client: { assignedUserId: string | null },
  ): Promise<string | null> {
    const wanted =
      tpl?.assignmentRule === 'SPECIFIC_USER'
        ? tpl.assignedUserId
        : tpl?.assignmentRule === 'CLIENT_TEAM'
          ? client.assignedUserId
          : null;
    if (!wanted) return null;
    try {
      await checkAssignee(tx, businessId, wanted, client);
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
    if (wanted.length > 0) {
      const members = await tx.membership.count({
        where: { businessId, userId: { in: wanted }, status: 'ACTIVE' },
      });
      if (members !== wanted.length) throw notAMember();
    }
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
      if (item.assignedUserId) {
        const member = await tx.membership.count({
          where: { businessId, userId: item.assignedUserId, status: 'ACTIVE' },
        });
        if (member === 0) throw notAMember();
      }
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
      data: reminders.map((r) => ({
        businessId,
        taskId,
        daysBefore: r.daysBefore,
        timeOfDay: r.timeOfDay ? timeOfDayToDb(r.timeOfDay) : null,
        inApp: r.inApp ?? true,
        channels: r.channels ?? [],
      })),
    });
  }

  /** The client's own documents only; an internal one is never client-visible. */
  private async addAttachments(
    tx: TxClient,
    businessId: string,
    actor: ClientsActor,
    taskId: string,
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

/** A template's reminders (JSON) as rules. */
function reminderRules(json: unknown): Reminder[] {
  if (!Array.isArray(json)) return [];
  return json.map(
    (r: {
      daysBefore: number;
      timeOfDay?: string | null;
      inApp?: boolean;
      channels?: ('EMAIL' | 'SMS')[];
    }) => ({
      daysBefore: r.daysBefore,
      timeOfDay: r.timeOfDay ?? null,
      inApp: r.inApp ?? true,
      channels: r.channels ?? [],
    }),
  );
}

/** A template's checklist (JSON) as steps. */
function checklistRules(json: unknown): { label: string; required: boolean }[] {
  if (!Array.isArray(json)) return [];
  return json.map((i: { label: string; required?: boolean }) => ({
    label: i.label,
    required: i.required ?? false,
  }));
}
