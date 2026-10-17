import { Inject, Injectable } from '@nestjs/common';
import { type Database, Prisma, type TxClient } from '@firmivra/db';
import type {
  CreateTaskTemplateRequest,
  ReminderRuleOut,
  TaskTemplate,
  TaskTemplatesQuery,
  UpdateTaskTemplateRequest,
} from '@firmivra/types';
import type { z } from 'zod';
import { timeOfDayFromDb } from '../appointments/calendar.js';
import { AuditService } from '../audit/audit.service.js';
import type { ClientsActor } from '../clients/clients.service.js';
import { DATABASE } from '../database/database.module.js';
import {
  assignee,
  isUniqueViolation,
  memberNames,
  memberRef,
  notAMember,
  notFound,
  sentFields,
} from '../workspaces/common.js';
import { taskErrors } from './task-common.js';
import { reach } from './task-read.service.js';

type CreateBody = z.output<typeof CreateTaskTemplateRequest>;
type UpdateBody = z.output<typeof UpdateTaskTemplateRequest>;
type Query = z.output<typeof TaskTemplatesQuery>;
type Reminder = NonNullable<CreateBody['reminders']>[number];

const include = {
  type: { select: { id: true, name: true } },
  service: { select: { id: true, name: true } },
  assignedMember: { select: { userId: true, user: { select: { name: true } } } },
} satisfies Prisma.TaskTemplateInclude;
type Row = Prisma.TaskTemplateGetPayload<{ include: typeof include }>;

const FIELDS = [
  'name',
  'description',
  'typeId',
  'serviceId',
  'priority',
  'assignmentRule',
  'assignedUserId',
  'dueOffsetDays',
  'clientVisibleDefault',
  'checklist',
  'reminders',
  'recurrence',
] as const;

/** A template's reminders (JSON in the table) as the contract shows them. */
export function remindersOf(json: unknown): ReminderRuleOut[] {
  if (!Array.isArray(json)) return [];
  return json.map((r: Partial<ReminderRuleOut>) => ({
    id: null,
    daysBefore: r.daysBefore ?? 0,
    timeOfDay: r.timeOfDay ?? null,
    inApp: r.inApp ?? true,
    channels: r.channels ?? [],
  }));
}

export function toTemplate(row: Row, names: Map<string, string>): TaskTemplate {
  const checklist = Array.isArray(row.checklist)
    ? (row.checklist as { label: string; required?: boolean }[])
    : [];
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    type: row.type ? { id: row.type.id, name: row.type.name } : null,
    service: row.service ? { id: row.service.id, name: row.service.name } : null,
    priority: row.priority,
    assignmentRule: row.assignmentRule,
    assignedTo: assignee(row.assignedMember),
    dueOffsetDays: row.dueOffsetDays,
    clientVisibleDefault: row.clientVisibleDefault,
    checklist: checklist.map((i) => ({ label: i.label, required: i.required ?? false })),
    reminders: remindersOf(row.reminders),
    recurrence:
      row.recurrence && typeof row.recurrence === 'object' && !Array.isArray(row.recurrence)
        ? (row.recurrence as Record<string, unknown>)
        : null,
    archivedAt: row.archivedAt?.toISOString() ?? null,
    createdBy: memberRef(names, row.createdByUserId),
    updatedAt: row.updatedAt.toISOString(),
    version: row.updatedAt.toISOString(),
  };
}

/** Reminders as the JSON a template and a series keep (`timeOfDay` "HH:MM", channels listed). */
export const reminderJson = (reminders: Reminder[]) =>
  reminders.map((r) => ({
    daysBefore: r.daysBefore,
    timeOfDay: r.timeOfDay ?? null,
    inApp: r.inApp ?? true,
    channels: r.channels ?? [],
  }));

/** Two reminders at the same offset and time are one. */
export function checkReminders(reminders: Reminder[]): void {
  const seen = new Set<string>();
  for (const r of reminders) {
    const key = `${r.daysBefore}@${r.timeOfDay ?? ''}`;
    if (seen.has(key)) throw taskErrors.bad('INVALID_REMINDER', 'Each reminder can be added once');
    seen.add(key);
  }
}

/**
 * Task templates: what a new task starts with. Everyone with the Tasks view reads them (and starts
 * a task from one by `templateId`); Owner and Admin make, change, duplicate and archive them.
 * Archived, never deleted; names are unique ignoring case. Starting a task copies the template as
 * a snapshot, so a later edit never reaches a task already made. Audited with ids and field names.
 */
@Injectable()
export class TaskTemplatesService {
  constructor(
    @Inject(DATABASE) private readonly database: Database,
    private readonly audit: AuditService,
  ) {}

  private inFirm<T>(businessId: string, fn: (tx: TxClient) => Promise<T>): Promise<T> {
    return this.database.withScope({ kind: 'business', businessId }, fn);
  }

  async list(businessId: string, q: Query): Promise<TaskTemplate[]> {
    return this.inFirm(businessId, async (tx) => {
      const rows = await tx.taskTemplate.findMany({
        where: {
          businessId,
          ...(q.status === 'active' ? { archivedAt: null } : {}),
          ...(q.status === 'archived' ? { archivedAt: { not: null } } : {}),
          ...(q.search ? { name: { contains: q.search, mode: 'insensitive' as const } } : {}),
        },
        include,
        orderBy: [{ name: 'asc' }, { id: 'asc' }],
      });
      const names = await memberNames(
        tx,
        businessId,
        rows.map((r) => r.createdByUserId),
      );
      return rows.map((r) => toTemplate(r, names));
    });
  }

  async get(businessId: string, id: string): Promise<TaskTemplate> {
    return this.inFirm(businessId, (tx) => this.read(tx, businessId, id));
  }

  async create(businessId: string, actor: ClientsActor, body: CreateBody): Promise<TaskTemplate> {
    const made = await this.write(businessId, async (tx) => {
      await this.checkName(tx, businessId, body.name);
      const rule = body.assignmentRule ?? 'UNASSIGNED';
      await this.checkParts(tx, businessId, { ...body, assignmentRule: rule });
      const row = await tx.taskTemplate.create({
        data: {
          businessId,
          name: body.name,
          description: body.description ?? null,
          typeId: body.typeId ?? null,
          serviceId: body.serviceId ?? null,
          priority: body.priority ?? 'MEDIUM',
          assignmentRule: rule,
          assignedUserId: body.assignedUserId ?? null,
          dueOffsetDays: body.dueOffsetDays ?? null,
          clientVisibleDefault: body.clientVisibleDefault ?? false,
          checklist: (body.checklist ?? []).map((i) => ({ label: i.label, required: i.required })),
          reminders: reminderJson(body.reminders ?? []),
          ...(body.recurrence ? { recurrence: body.recurrence } : {}),
          createdByUserId: actor.userId,
        },
        select: { id: true },
      });
      return this.read(tx, businessId, row.id);
    });
    await this.audit.log(
      'task_template.created',
      { type: 'task_template', id: made.id },
      {
        fields: sentFields(body, FIELDS),
      },
    );
    return made;
  }

  async update(businessId: string, id: string, body: UpdateBody): Promise<TaskTemplate> {
    const { version, ...changes } = body;
    const made = await this.write(businessId, async (tx) => {
      const cur = await tx.taskTemplate.findFirst({ where: { businessId, id } });
      if (!cur) throw notFound();
      if (version !== cur.updatedAt.toISOString()) throw taskErrors.saveConflict();
      if (changes.name !== undefined && changes.name !== cur.name) {
        await this.checkName(tx, businessId, changes.name, id);
      }
      const rule = changes.assignmentRule ?? cur.assignmentRule;
      // Off "specific person", the stored person goes; sending one with another rule is an error.
      const sent = changes.assignedUserId;
      const assigned =
        rule === 'SPECIFIC_USER'
          ? sent !== undefined
            ? sent
            : cur.assignedUserId
          : (sent ?? null);
      await this.checkParts(tx, businessId, {
        ...changes,
        assignmentRule: rule,
        assignedUserId: assigned,
      });
      const data: Prisma.TaskTemplateUncheckedUpdateInput = {};
      if (changes.name !== undefined) data.name = changes.name;
      if (changes.description !== undefined) data.description = changes.description;
      if (changes.typeId !== undefined) data.typeId = changes.typeId;
      if (changes.serviceId !== undefined) data.serviceId = changes.serviceId;
      if (changes.priority !== undefined) data.priority = changes.priority;
      data.assignmentRule = rule;
      data.assignedUserId = rule === 'SPECIFIC_USER' ? assigned : null;
      if (changes.dueOffsetDays !== undefined) data.dueOffsetDays = changes.dueOffsetDays;
      if (changes.clientVisibleDefault !== undefined)
        data.clientVisibleDefault = changes.clientVisibleDefault;
      if (changes.checklist !== undefined) {
        data.checklist = changes.checklist.map((i) => ({ label: i.label, required: i.required }));
      }
      if (changes.reminders !== undefined) data.reminders = reminderJson(changes.reminders);
      if (changes.recurrence !== undefined) {
        data.recurrence = changes.recurrence === null ? Prisma.DbNull : changes.recurrence;
      }
      await tx.taskTemplate.update({ where: { id }, data: { ...data, updatedAt: new Date() } });
      return this.read(tx, businessId, id);
    });
    await this.audit.log(
      'task_template.updated',
      { type: 'task_template', id },
      {
        fields: sentFields(changes, FIELDS),
      },
    );
    return made;
  }

  /** A copy named "name (Copy)", unarchived. */
  async duplicate(businessId: string, actor: ClientsActor, id: string): Promise<TaskTemplate> {
    const made = await this.write(businessId, async (tx) => {
      const src = await tx.taskTemplate.findFirst({ where: { businessId, id } });
      if (!src) throw notFound();
      const taken = new Set(
        (
          await tx.taskTemplate.findMany({
            where: {
              businessId,
              name: { startsWith: src.name.slice(0, 100), mode: 'insensitive' },
            },
            select: { name: true },
          })
        ).map((t) => t.name.toLowerCase()),
      );
      const base = `${src.name.slice(0, 100)} (Copy)`;
      let name = base;
      for (let n = 2; taken.has(name.toLowerCase()); n++) name = `${base} ${n}`;
      // An archived type is not carried to the copy.
      const type = src.typeId
        ? await tx.taskType.findFirst({
            where: { id: src.typeId, archivedAt: null },
            select: { id: true },
          })
        : null;
      const row = await tx.taskTemplate.create({
        data: {
          businessId,
          name,
          description: src.description,
          typeId: type?.id ?? null,
          serviceId: src.serviceId,
          priority: src.priority,
          assignmentRule: src.assignmentRule,
          assignedUserId: src.assignedUserId,
          dueOffsetDays: src.dueOffsetDays,
          clientVisibleDefault: src.clientVisibleDefault,
          checklist: src.checklist as Prisma.InputJsonValue,
          reminders: src.reminders as Prisma.InputJsonValue,
          ...(src.recurrence ? { recurrence: src.recurrence as Prisma.InputJsonValue } : {}),
          createdByUserId: actor.userId,
        },
        select: { id: true },
      });
      return this.read(tx, businessId, row.id);
    });
    await this.audit.log(
      'task_template.duplicated',
      { type: 'task_template', id: made.id },
      { from: id },
    );
    return made;
  }

  archive(businessId: string, id: string) {
    return this.setArchived(businessId, id, true);
  }
  restore(businessId: string, id: string) {
    return this.setArchived(businessId, id, false);
  }

  private async setArchived(
    businessId: string,
    id: string,
    archive: boolean,
  ): Promise<TaskTemplate> {
    const { made, changed } = await this.inFirm(businessId, async (tx) => {
      const cur = await tx.taskTemplate.findFirst({ where: { businessId, id } });
      if (!cur) throw notFound();
      if ((cur.archivedAt !== null) === archive) {
        return { made: await this.read(tx, businessId, id), changed: false };
      }
      await tx.taskTemplate.update({
        where: { id },
        data: { archivedAt: archive ? new Date() : null, updatedAt: new Date() },
      });
      return { made: await this.read(tx, businessId, id), changed: true };
    });
    if (changed) {
      await this.audit.log(archive ? 'task_template.archived' : 'task_template.restored', {
        type: 'task_template',
        id,
      });
    }
    return made;
  }

  /** "Save as Template" on a task the actor reaches: its current settings, as a new template. */
  async fromTask(
    businessId: string,
    actor: ClientsActor,
    taskId: string,
    name: string,
  ): Promise<TaskTemplate> {
    const made = await this.write(businessId, async (tx) => {
      const task = await tx.task.findFirst({
        where: { businessId, id: taskId, ...reach(actor) },
        include: {
          taskChecklistItems: { orderBy: { position: 'asc' } },
          taskReminders: { orderBy: [{ daysBefore: 'desc' }, { timeOfDay: 'asc' }] },
        },
      });
      if (!task) throw notFound();
      await this.checkName(tx, businessId, name);
      const type = task.typeId
        ? await tx.taskType.findFirst({
            where: { id: task.typeId, archivedAt: null },
            select: { id: true },
          })
        : null;
      // The due date becomes "this many days after the task is made".
      const offset = task.dueOn
        ? Math.round(
            (task.dueOn.getTime() -
              Date.UTC(
                task.createdAt.getUTCFullYear(),
                task.createdAt.getUTCMonth(),
                task.createdAt.getUTCDate(),
              )) /
              86_400_000,
          )
        : null;
      const row = await tx.taskTemplate.create({
        data: {
          businessId,
          name,
          description: task.details,
          typeId: type?.id ?? null,
          serviceId: task.serviceId,
          priority: task.priority,
          assignmentRule: task.assignedUserId ? 'SPECIFIC_USER' : 'UNASSIGNED',
          assignedUserId: task.assignedUserId,
          dueOffsetDays: offset !== null && offset >= 0 && offset <= 730 ? offset : null,
          clientVisibleDefault: task.clientVisible,
          checklist: task.taskChecklistItems.map((i) => ({ label: i.label, required: i.required })),
          reminders: task.taskReminders.map((r) => ({
            daysBefore: r.daysBefore,
            timeOfDay: r.timeOfDay ? timeOfDayFromDb(r.timeOfDay) : null,
            inApp: r.inApp,
            channels: r.channels,
          })),
          createdByUserId: actor.userId,
        },
        select: { id: true },
      });
      return this.read(tx, businessId, row.id);
    });
    await this.audit.log(
      'task_template.created',
      { type: 'task_template', id: made.id },
      { fromTask: taskId.toLowerCase() },
    );
    return made;
  }

  // ---------- Checks ----------

  private async read(tx: TxClient, businessId: string, id: string): Promise<TaskTemplate> {
    const row = await tx.taskTemplate.findFirst({ where: { businessId, id }, include });
    if (!row) throw notFound();
    return toTemplate(row, await memberNames(tx, businessId, [row.createdByUserId]));
  }

  private async checkName(tx: TxClient, businessId: string, name: string, exceptId?: string) {
    const clash = await tx.taskTemplate.findFirst({
      where: {
        businessId,
        name: { equals: name, mode: 'insensitive' },
        ...(exceptId ? { id: { not: exceptId } } : {}),
      },
      select: { id: true },
    });
    if (clash) throw taskErrors.duplicateName('template');
  }

  /** The type, service and person must be this firm's; the person only with SPECIFIC_USER. */
  private async checkParts(
    tx: TxClient,
    businessId: string,
    t: {
      typeId?: string | null;
      serviceId?: string | null;
      assignmentRule: 'UNASSIGNED' | 'SPECIFIC_USER' | 'CLIENT_TEAM';
      assignedUserId?: string | null;
      reminders?: Reminder[];
    },
  ) {
    if (t.typeId) {
      const type = await tx.taskType.findFirst({
        where: { businessId, id: t.typeId },
        select: { archivedAt: true },
      });
      if (!type) throw taskErrors.invalid('typeId', 'Choose a task type');
      if (type.archivedAt) throw taskErrors.typeArchived();
    }
    if (t.serviceId) {
      const service = await tx.service.findFirst({
        where: { businessId, id: t.serviceId },
        select: { id: true },
      });
      if (!service) throw taskErrors.invalid('serviceId', 'Choose a service');
    }
    if (t.assignmentRule === 'SPECIFIC_USER') {
      if (!t.assignedUserId) throw taskErrors.invalid('assignedUserId', 'Choose who it goes to');
      const member = await tx.membership.count({
        where: { businessId, userId: t.assignedUserId, status: 'ACTIVE' },
      });
      if (member === 0) throw notAMember();
    } else if (t.assignedUserId) {
      throw taskErrors.invalid('assignedUserId', 'Use a person only with "specific person"');
    }
    if (t.reminders) checkReminders(t.reminders);
  }

  private async write<T>(businessId: string, fn: (tx: TxClient) => Promise<T>): Promise<T> {
    try {
      return await this.inFirm(businessId, fn);
    } catch (e) {
      if (isUniqueViolation(e)) throw taskErrors.duplicateName('template');
      throw e;
    }
  }
}
