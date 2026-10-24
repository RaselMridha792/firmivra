import { Inject, Injectable } from '@nestjs/common';
import { type Database, Prisma, type TxClient } from '@firmivra/db';
import type {
  ConvertToRecurringRequest,
  CreateTaskSeriesRequest,
  SeriesPreview,
  SeriesPreviewRequest,
  SkipOccurrenceRequest,
  TaskOccurrence,
  TaskOccurrencePage,
  TaskOccurrencesQuery,
  TaskSeriesDetail,
  TaskSeriesPage,
  TaskSeriesQuery,
  UpdateTaskSeriesRequest,
} from '@firmivra/types';
import type { z } from 'zod';
import { timeOfDayFromDb, timeOfDayToDb } from '../appointments/calendar.js';
import { AuditService } from '../audit/audit.service.js';
import type { ClientsActor } from '../clients/clients.service.js';
import { DATABASE } from '../database/database.module.js';
import {
  assignee,
  day,
  lockClient,
  memberNames,
  memberRef,
  notAMember,
  notFound,
  reachesClient,
  sentFields,
  toDay,
} from '../workspaces/common.js';
import {
  checkReminders,
  fitReminders,
  inFiringOrder,
  LIVE_TASK,
  liveClient,
  type Reminder,
  reminderFrom,
  reminderFromRow,
  remindersFromJson,
  remindersJson,
  taskErrors,
} from './task-common.js';
import { remindersOf } from './task-templates.service.js';
import { firmClock } from './task-read.service.js';
import { addDays, describe, type RecurrenceRule, schedule, totalDates } from './recurrence.js';

type CreateBody = z.output<typeof CreateTaskSeriesRequest>;
type UpdateBody = z.output<typeof UpdateTaskSeriesRequest>;

/** Occurrences are made this far ahead of today (their due dates), so the list and the job see them. */
export const HORIZON_DAYS = 120;
const UPCOMING = 6;
/** The skip reason of an occurrence the firm's new settings no longer give. */
const REPLACED = 'Replaced by new settings';
const FIELDS = [
  'title',
  'details',
  'engagementId',
  'serviceId',
  'typeId',
  'priority',
  'assignmentRule',
  'assignedUserId',
  'extraAssigneeIds',
  'createAtPeriodStart',
  'leadDays',
  'linkTaxCalendar',
  'dueTime',
  'clientVisible',
  'notifyClient',
  'checklist',
  'reminders',
  'recurrence',
] as const;

const include = {
  client: { select: { id: true, displayName: true } },
  type: { select: { id: true, name: true } },
  service: { select: { id: true, name: true } },
  assignedMember: { select: { userId: true, user: { select: { name: true } } } },
} satisfies Prisma.TaskSeriesInclude;
type Row = Prisma.TaskSeriesGetPayload<{ include: typeof include }>;

/** The series columns a request sets (a subset: the client, start and unit are never in it). */
type SeriesFields = Partial<
  Omit<
    Prisma.TaskSeriesUncheckedCreateInput,
    'businessId' | 'clientId' | 'startOn' | 'unit' | 'title'
  >
> & { title?: string };

/** The rule a stored series keeps. */
export function ruleOf(s: {
  interval: number;
  unit: RecurrenceRule['unit'];
  pattern: unknown;
  startOn: Date;
  endMode: RecurrenceRule['endMode'];
  endAfterCount: number | null;
  endOn: Date | null;
  holidayRule: RecurrenceRule['holidayRule'];
}): RecurrenceRule {
  return {
    interval: s.interval,
    unit: s.unit,
    pattern: (s.pattern ?? {}) as RecurrenceRule['pattern'],
    startOn: day(s.startOn)!,
    endMode: s.endMode,
    endAfterCount: s.endAfterCount,
    endOn: day(s.endOn),
    holidayRule: s.holidayRule,
  };
}

/** Settings that cannot go together (400 INVALID_RECURRENCE), worded for the screen. */
export function checkRule(rule: RecurrenceRule): void {
  const bad = (m: string) => taskErrors.bad('INVALID_RECURRENCE', m);
  const p = rule.pattern;
  if (p.weekdays !== undefined && rule.unit !== 'WEEK') {
    throw bad('Weekdays only go with a weekly repeat');
  }
  if (p.monthly !== undefined && rule.unit !== 'MONTH' && rule.unit !== 'QUARTER') {
    throw bad('A day of the month only goes with a monthly or quarterly repeat');
  }
  if (p.monthly !== 'NTH_WEEKDAY' && (p.nth !== undefined || p.weekday !== undefined)) {
    throw bad('Choose "nth weekday" to pick which weekday of the month');
  }
  if (schedule(rule, { limit: 1 }).length === 0) {
    throw bad('These settings give no dates');
  }
}

const occurrenceOut = (o: {
  id: string;
  scheduledOn: Date;
  dueOn: Date;
  state: TaskOccurrence['state'];
  taskId: string | null;
  skipReason: string | null;
  generatedAt: Date | null;
}): TaskOccurrence => ({
  id: o.id,
  scheduledOn: day(o.scheduledOn)!,
  dueOn: day(o.dueOn)!,
  state: o.state,
  taskId: o.taskId,
  skipReason: o.skipReason,
  generatedAt: o.generatedAt?.toISOString() ?? null,
});

/**
 * Recurring series (contract in packages/types/src/tasks): a definition that makes one task per
 * due date, each from a snapshot of the defaults. The occurrence is keyed by (series, scheduled
 * date), so generation is idempotent: a retry finds the row. A later edit changes the definition
 * and the occurrences not made yet, never a task already made (and with scope ENTIRE only the
 * still-open ones, in a few fields). The client and the start date never change. Owner and Admin
 * manage series; everyone with the Tasks view reads those of the clients they reach. Audited with
 * ids, field names and the series' wording, never a title, details or a step.
 */
@Injectable()
export class TaskSeriesService {
  constructor(
    @Inject(DATABASE) private readonly database: Database,
    private readonly audit: AuditService,
  ) {}

  private inFirm<T>(businessId: string, fn: (tx: TxClient) => Promise<T>): Promise<T> {
    return this.database.withScope({ kind: 'business', businessId }, fn);
  }

  private reach(actor: ClientsActor): Prisma.TaskSeriesWhereInput {
    return actor.role === 'STAFF' ? { client: { assignedUserId: actor.userId } } : {};
  }

  // ---------- Reads ----------

  async list(
    businessId: string,
    actor: ClientsActor,
    q: z.output<typeof TaskSeriesQuery>,
  ): Promise<TaskSeriesPage> {
    return this.inFirm(businessId, async (tx) => {
      const where: Prisma.TaskSeriesWhereInput = {
        businessId,
        ...this.reach(actor),
        ...(q.status ? { status: q.status } : { status: { not: 'ARCHIVED' } }),
        ...(q.clientId ? { clientId: q.clientId } : {}),
        ...(q.search
          ? {
              OR: [
                { title: { contains: q.search, mode: 'insensitive' } },
                { client: { displayName: { contains: q.search, mode: 'insensitive' } } },
              ],
            }
          : {}),
      };
      const [rows, total] = await Promise.all([
        tx.taskSeries.findMany({
          where,
          include,
          orderBy: [{ status: 'asc' }, { title: 'asc' }, { id: 'asc' }],
          skip: (q.page - 1) * q.pageSize,
          take: q.pageSize,
        }),
        tx.taskSeries.count({ where }),
      ]);
      const stats = await this.stats(
        tx,
        businessId,
        rows.map((r) => r.id),
      );
      return {
        items: rows.map((r) => ({
          id: r.id,
          title: r.title,
          client: r.client,
          type: r.type,
          priority: r.priority,
          assignedTo: assignee(r.assignedMember),
          summary: describe(ruleOf(r)),
          status: r.status,
          nextDueOn: stats.next.get(r.id) ?? null,
          generatedCount: stats.made.get(r.id) ?? 0,
          updatedAt: r.updatedAt.toISOString(),
        })),
        total,
        page: q.page,
        pageSize: q.pageSize,
      };
    });
  }

  async get(businessId: string, actor: ClientsActor, id: string): Promise<TaskSeriesDetail> {
    return this.inFirm(businessId, (tx) => this.read(tx, businessId, actor, id));
  }

  /** The next due dates for settings not saved yet. */
  async preview(
    businessId: string,
    body: z.output<typeof SeriesPreviewRequest>,
  ): Promise<SeriesPreview> {
    const rule = body.recurrence as RecurrenceRule;
    checkRule(rule);
    const clock = await this.inFirm(businessId, (tx) => firmClock(tx, businessId));
    const dates = schedule(rule, { limit: body.count, from: clock.today });
    const finite = totalDates(rule);
    return {
      dates,
      endsAfter: dates.length < body.count && finite !== null ? finite : null,
    };
  }

  async occurrences(
    businessId: string,
    actor: ClientsActor,
    id: string,
    q: z.output<typeof TaskOccurrencesQuery>,
  ): Promise<TaskOccurrencePage> {
    return this.inFirm(businessId, async (tx) => {
      await this.find(tx, businessId, actor, id);
      const where: Prisma.TaskOccurrenceWhereInput = {
        businessId,
        seriesId: id,
        ...(q.state ? { state: q.state } : {}),
      };
      const [rows, total] = await Promise.all([
        tx.taskOccurrence.findMany({
          where,
          orderBy: [{ scheduledOn: 'desc' }, { id: 'asc' }],
          skip: (q.page - 1) * q.pageSize,
          take: q.pageSize,
        }),
        tx.taskOccurrence.count({ where }),
      ]);
      return { items: rows.map(occurrenceOut), total, page: q.page, pageSize: q.pageSize };
    });
  }

  // ---------- Create ----------

  async create(
    businessId: string,
    actor: ClientsActor,
    body: CreateBody,
  ): Promise<TaskSeriesDetail> {
    const series = await this.inFirm(businessId, async (tx) => {
      const client = await lockClient(tx, businessId, body.clientId);
      if (!client || !reachesClient(actor, client)) throw notFound();
      const tpl = body.templateId
        ? await tx.taskTemplate.findFirst({ where: { businessId, id: body.templateId } })
        : null;
      if (body.templateId && (!tpl || tpl.archivedAt)) {
        throw taskErrors.invalid('templateId', 'Choose a template');
      }
      const rule = body.recurrence as RecurrenceRule;
      checkRule(rule);
      const fields = await this.fields(tx, businessId, {
        ...body,
        priority: body.priority ?? tpl?.priority,
        typeId: body.typeId !== undefined ? body.typeId : tpl?.typeId,
        serviceId: body.serviceId !== undefined ? body.serviceId : tpl?.serviceId,
        assignmentRule:
          body.assignmentRule ??
          (body.assignedUserId ? 'SPECIFIC_USER' : (tpl?.assignmentRule ?? 'UNASSIGNED')),
        assignedUserId:
          body.assignedUserId !== undefined ? body.assignedUserId : (tpl?.assignedUserId ?? null),
        clientVisible: body.clientVisible ?? tpl?.clientVisibleDefault,
        checklist:
          body.checklist ??
          (Array.isArray(tpl?.checklist)
            ? (tpl.checklist as { label: string; required: boolean }[])
            : undefined),
        // The request's reminders are checked; the template's that do not fit are left out.
        reminders:
          body.reminders?.map(reminderFrom) ??
          (tpl ? fitReminders(remindersFromJson(tpl.reminders), body.dueTime ?? null) : undefined),
      });
      if (body.engagementId) {
        const engagement = await tx.engagement.findFirst({
          where: { businessId, id: body.engagementId, clientId: body.clientId },
          select: { id: true },
        });
        if (!engagement)
          throw taskErrors.invalid('engagementId', "Choose one of this client's services");
      }
      const created = await tx.taskSeries.create({
        data: {
          businessId,
          clientId: body.clientId,
          engagementId: body.engagementId ?? null,
          createdByUserId: actor.userId,
          startOn: toDay(rule.startOn),
          ...this.ruleColumns(rule),
          ...fields,
          title: body.title,
        },
        select: { id: true },
      });
      const row = await tx.taskSeries.findFirstOrThrow({ where: { id: created.id }, include });
      const clock = await firmClock(tx, businessId);
      await this.syncOccurrences(tx, businessId, row, clock.today);
      return this.read(tx, businessId, null, created.id);
    });
    await this.audit.log(
      'task_series.created',
      { type: 'task_series', id: series.id },
      {
        clientId: series.client.id,
        fields: sentFields(body, [...FIELDS, 'templateId']),
        frequency: series.summary,
      },
    );
    return series;
  }

  // ---------- Update ----------

  async update(
    businessId: string,
    actor: ClientsActor,
    id: string,
    body: UpdateBody,
  ): Promise<TaskSeriesDetail> {
    const { scope, version, ...changes } = body;
    const { series, before } = await this.inFirm(businessId, async (tx) => {
      const { row } = await this.lock(tx, businessId, actor, id);
      if (version !== row.updatedAt.toISOString()) throw taskErrors.saveConflict();
      if (row.status !== 'ACTIVE' && row.status !== 'PAUSED') throw taskErrors.seriesNotActive();
      const before = describe(ruleOf(row));
      const rule: RecurrenceRule = { ...ruleOf(row), ...stripUndefined(changes.recurrence ?? {}) };
      const recurrenceChanged = changes.recurrence !== undefined && describe(rule) !== before;
      if (changes.recurrence !== undefined) {
        // The end rule is a pair: a count with its mode, a date with its mode.
        if (rule.endMode !== 'AFTER_COUNT') rule.endAfterCount = null;
        if (rule.endMode !== 'ON_DATE') rule.endOn = null;
        if (rule.endMode === 'AFTER_COUNT' && rule.endAfterCount === null) {
          throw taskErrors.bad('INVALID_RECURRENCE', 'Enter how many');
        }
        if (rule.endMode === 'ON_DATE' && (rule.endOn === null || rule.endOn < rule.startOn)) {
          throw taskErrors.bad('INVALID_RECURRENCE', 'End on or after the start');
        }
        checkRule(rule);
      }
      if (changes.engagementId) {
        const engagement = await tx.engagement.findFirst({
          where: { businessId, id: changes.engagementId, clientId: row.clientId },
          select: { id: true },
        });
        if (!engagement) {
          throw taskErrors.invalid('engagementId', "Choose one of this client's services");
        }
      }
      const merged = {
        assignmentRule: changes.assignmentRule ?? row.assignmentRule,
        assignedUserId:
          changes.assignedUserId !== undefined ? changes.assignedUserId : row.assignedUserId,
        reminders: changes.reminders?.map(reminderFrom),
      };
      const fields = await this.fields(tx, businessId, { ...changes, ...merged }, row);
      await tx.taskSeries.update({
        where: { id },
        data: {
          ...fields,
          ...(changes.recurrence !== undefined ? this.ruleColumns(rule) : {}),
          updatedAt: new Date(),
        },
      });
      const clock = await firmClock(tx, businessId);
      if (recurrenceChanged) {
        // Occurrences not made yet follow the new rule; the made ones stay as they are.
        const fresh = await tx.taskSeries.findFirstOrThrow({ where: { id }, include });
        await this.syncOccurrences(tx, businessId, fresh, clock.today);
      }
      if (scope === 'ENTIRE') await this.applyToOpenTasks(tx, businessId, id, changes);
      return { series: await this.read(tx, businessId, null, id), before };
    });
    await this.audit.log(
      'task_series.updated',
      { type: 'task_series', id },
      {
        clientId: series.client.id,
        scope,
        fields: sentFields(changes, FIELDS),
        ...(before !== series.summary ? { frequency: { from: before, to: series.summary } } : {}),
      },
    );
    return series;
  }

  /** ENTIRE: the series' tasks still open take the new title, details, type, service and priority. */
  private async applyToOpenTasks(
    tx: TxClient,
    businessId: string,
    seriesId: string,
    c: Omit<UpdateBody, 'scope' | 'version'>,
  ) {
    const data: Prisma.TaskUncheckedUpdateManyInput = {};
    if (c.title !== undefined) data.title = c.title;
    if (c.details !== undefined) data.details = c.details;
    if (c.typeId !== undefined) data.typeId = c.typeId;
    if (c.serviceId !== undefined) data.serviceId = c.serviceId;
    if (c.priority !== undefined) data.priority = c.priority;
    if (Object.keys(data).length === 0) return;
    const made = await tx.taskOccurrence.findMany({
      where: { businessId, seriesId, state: 'GENERATED', taskId: { not: null } },
      select: { taskId: true },
    });
    await tx.task.updateMany({
      where: { businessId, status: 'OPEN', id: { in: made.map((m) => m.taskId!) } },
      data: { ...data, updatedAt: new Date() },
    });
  }

  // ---------- Pause, resume, stop ----------

  async pause(businessId: string, actor: ClientsActor, id: string) {
    return this.setStatus(businessId, actor, id, 'task_series.paused', async (tx, row) => {
      if (row.status !== 'ACTIVE') throw taskErrors.seriesNotActive();
      await tx.taskSeries.update({
        where: { id },
        data: { status: 'PAUSED', pausedAt: new Date() },
      });
    });
  }

  async resume(businessId: string, actor: ClientsActor, id: string) {
    return this.setStatus(businessId, actor, id, 'task_series.resumed', async (tx, row) => {
      if (row.status !== 'PAUSED') throw taskErrors.seriesNotActive();
      await tx.taskSeries.update({ where: { id }, data: { status: 'ACTIVE', pausedAt: null } });
      const clock = await firmClock(tx, businessId);
      // What came due while paused is not made now, all at once.
      await tx.taskOccurrence.updateMany({
        where: { businessId, seriesId: id, state: 'SCHEDULED', dueOn: { lt: toDay(clock.today) } },
        data: { state: 'SKIPPED', skipReason: 'Missed while paused' },
      });
      const fresh = await tx.taskSeries.findFirstOrThrow({ where: { id }, include });
      await this.syncOccurrences(tx, businessId, fresh, clock.today);
    });
  }

  /** Future generation stops; the tasks already made stay. */
  async stop(businessId: string, actor: ClientsActor, id: string) {
    return this.setStatus(businessId, actor, id, 'task_series.stopped', async (tx, row) => {
      if (row.status === 'ENDED' || row.status === 'ARCHIVED') return;
      await tx.taskSeries.update({ where: { id }, data: { status: 'ENDED', endedAt: new Date() } });
      await tx.taskOccurrence.updateMany({
        where: { businessId, seriesId: id, state: 'SCHEDULED' },
        data: { state: 'SKIPPED', skipReason: 'Series stopped' },
      });
    });
  }

  private async setStatus(
    businessId: string,
    actor: ClientsActor,
    id: string,
    action: string,
    apply: (tx: TxClient, row: Row) => Promise<void>,
  ): Promise<TaskSeriesDetail> {
    const { series, from } = await this.inFirm(businessId, async (tx) => {
      const { row } = await this.lock(tx, businessId, actor, id);
      await apply(tx, row);
      return { series: await this.read(tx, businessId, null, id), from: row.status };
    });
    if (from !== series.status) {
      await this.audit.log(
        action,
        { type: 'task_series', id },
        { clientId: series.client.id, from, to: series.status },
      );
    }
    return series;
  }

  // ---------- Occurrences ----------

  async skip(
    businessId: string,
    actor: ClientsActor,
    id: string,
    occurrenceId: string,
    body: z.output<typeof SkipOccurrenceRequest>,
  ): Promise<TaskOccurrence> {
    const occurrence = await this.inFirm(businessId, async (tx) => {
      await this.lock(tx, businessId, actor, id);
      const [locked] = await tx.$queryRaw<{ id: string }[]>`
        SELECT id FROM task_occurrences
        WHERE business_id = ${businessId}::uuid AND series_id = ${id}::uuid AND id = ${occurrenceId}::uuid
        FOR UPDATE`;
      if (!locked) throw notFound();
      const cur = await tx.taskOccurrence.findFirstOrThrow({ where: { id: occurrenceId } });
      if (cur.state !== 'SCHEDULED' && cur.state !== 'FAILED') throw taskErrors.occurrenceClosed();
      return tx.taskOccurrence.update({
        where: { id: occurrenceId },
        data: { state: 'SKIPPED', skipReason: body.reason ?? null },
      });
    });
    await this.audit.log(
      'task_series.occurrence_skipped',
      { type: 'task_series', id },
      {
        occurrenceKey: day(occurrence.scheduledOn),
      },
    );
    return occurrenceOut(occurrence);
  }

  /** "Delete future occurrences": the ones not made yet are skipped; made and past ones stay. */
  async skipFuture(businessId: string, actor: ClientsActor, id: string): Promise<TaskSeriesDetail> {
    const { series, count } = await this.inFirm(businessId, async (tx) => {
      await this.lock(tx, businessId, actor, id);
      const done = await tx.taskOccurrence.updateMany({
        where: { businessId, seriesId: id, state: { in: ['SCHEDULED', 'FAILED'] } },
        data: { state: 'SKIPPED', skipReason: 'Skipped by the firm' },
      });
      return { series: await this.read(tx, businessId, null, id), count: done.count };
    });
    await this.audit.log(
      'task_series.future_skipped',
      { type: 'task_series', id },
      { clientId: series.client.id, count },
    );
    return series;
  }

  // ---------- A task becomes a series ----------

  /** The task becomes the first occurrence of a new series that starts on its due date. */
  async convert(
    businessId: string,
    actor: ClientsActor,
    taskId: string,
    body: z.output<typeof ConvertToRecurringRequest>,
  ): Promise<TaskSeriesDetail> {
    const series = await this.inFirm(businessId, async (tx) => {
      const task = await tx.task.findFirst({
        where: {
          businessId,
          id: taskId,
          ...LIVE_TASK,
          ...(actor.role === 'STAFF' ? { client: { assignedUserId: actor.userId } } : {}),
        },
        include: {
          taskChecklistItems: { orderBy: { position: 'asc' } },
          taskReminders: { orderBy: [{ daysBefore: 'desc' }, { timeOfDay: 'asc' }, { id: 'asc' }] },
          assignees: { select: { userId: true } },
          taskOccurrence: { select: { id: true } },
        },
      });
      if (!task) throw notFound();
      if (!task.dueOn)
        throw taskErrors.bad('INVALID_RECURRENCE', 'Set a due date first: it starts the series');
      if (task.taskOccurrence)
        throw taskErrors.invalid('id', 'This task already belongs to a recurring task');
      const startOn = day(task.dueOn)!;
      const rule: RecurrenceRule = {
        ...(body.recurrence as Omit<RecurrenceRule, 'startOn'>),
        startOn,
      };
      checkRule(rule);
      const created = await tx.taskSeries.create({
        data: {
          businessId,
          clientId: liveClient(task.clientId),
          engagementId: task.engagementId,
          createdByUserId: actor.userId,
          startOn: task.dueOn,
          ...this.ruleColumns(rule),
          title: task.title,
          details: task.details,
          serviceId: task.serviceId,
          typeId: task.typeId,
          priority: task.priority,
          assignmentRule: task.assignedUserId ? 'SPECIFIC_USER' : 'UNASSIGNED',
          assignedUserId: task.assignedUserId,
          extraAssigneeIds: task.assignees.map((a) => a.userId),
          dueTime: task.dueTime,
          clientVisible: task.clientVisible,
          checklist: task.taskChecklistItems.map((i) => ({ label: i.label, required: i.required })),
          // Custom ones too, in the order they fire (the series keeps the task's due time).
          reminders: remindersJson(
            inFiringOrder(
              task.taskReminders.map((r) => ({ rule: reminderFromRow(r) })),
              task.dueTime && !task.allDay ? timeOfDayFromDb(task.dueTime) : null,
            ).map((r) => r.rule),
          ),
        },
        select: { id: true },
      });
      // The task is the first occurrence: its date is the series' start.
      await tx.taskOccurrence.create({
        data: {
          businessId,
          seriesId: created.id,
          scheduledOn: task.dueOn,
          dueOn: task.dueOn,
          state: 'GENERATED',
          taskId: task.id,
          generatedAt: new Date(),
        },
      });
      const row = await tx.taskSeries.findFirstOrThrow({ where: { id: created.id }, include });
      const clock = await firmClock(tx, businessId);
      await this.syncOccurrences(tx, businessId, row, clock.today);
      return this.read(tx, businessId, null, created.id);
    });
    await this.audit.log(
      'task_series.created',
      { type: 'task_series', id: series.id },
      {
        clientId: series.client.id,
        fromTask: taskId.toLowerCase(),
        frequency: series.summary,
      },
    );
    return series;
  }

  /**
   * The occurrences from today to the horizon follow the rule: when a series is made or resumed,
   * its recurrence changes, and by the job as time passes. Rows are never deleted
   * (they are the history, and the database role may not), so a row the new rule still gives only
   * has its due date moved, one it no longer gives is skipped as REPLACED, one an earlier edit
   * replaced and the rule gives again is put back, and a date with no row gets one. A skip by the
   * firm stays skipped.
   */
  async syncOccurrences(
    tx: TxClient,
    businessId: string,
    series: Pick<
      Row,
      | 'id'
      | 'status'
      | 'interval'
      | 'unit'
      | 'pattern'
      | 'startOn'
      | 'endMode'
      | 'endAfterCount'
      | 'endOn'
      | 'holidayRule'
    >,
    today: string,
  ): Promise<number> {
    const rule = ruleOf(series);
    const horizon = addDays(today, HORIZON_DAYS);
    const wanted = new Map(
      series.status === 'ACTIVE'
        ? schedule(rule, { limit: 400, from: today })
            .filter((o) => o.dueOn <= horizon)
            .map((o) => [o.scheduledOn, o] as const)
        : [],
    );
    const rows = await tx.taskOccurrence.findMany({
      where: {
        businessId,
        seriesId: series.id,
        // Rows already due stay as they are: they are work waiting, not the future.
        dueOn: { gte: toDay(today) },
        OR: [{ state: 'SCHEDULED' }, { state: 'SKIPPED', skipReason: REPLACED }],
      },
    });
    const have = new Set<string>();
    for (const row of rows) {
      const key = day(row.scheduledOn)!;
      const fit = wanted.get(key);
      have.add(key);
      if (fit && row.state === 'SCHEDULED') {
        if (day(row.dueOn) !== fit.dueOn) {
          await tx.taskOccurrence.update({
            where: { id: row.id },
            data: { dueOn: toDay(fit.dueOn) },
          });
        }
      } else if (fit) {
        await tx.taskOccurrence.update({
          where: { id: row.id },
          data: { state: 'SCHEDULED', skipReason: null, dueOn: toDay(fit.dueOn) },
        });
      } else if (row.state === 'SCHEDULED') {
        await tx.taskOccurrence.update({
          where: { id: row.id },
          data: { state: 'SKIPPED', skipReason: REPLACED },
        });
      }
    }
    const made = await tx.taskOccurrence.createMany({
      data: [...wanted.values()]
        .filter((o) => !have.has(o.scheduledOn))
        .map((o) => ({
          businessId,
          seriesId: series.id,
          scheduledOn: toDay(o.scheduledOn),
          dueOn: toDay(o.dueOn),
        })),
      skipDuplicates: true,
    });
    return made.count;
  }

  // ---------- Pieces ----------

  private ruleColumns(rule: RecurrenceRule) {
    return {
      interval: rule.interval,
      unit: rule.unit,
      pattern: rule.pattern as Prisma.InputJsonValue,
      endMode: rule.endMode,
      endAfterCount: rule.endAfterCount,
      endOn: rule.endOn ? toDay(rule.endOn) : null,
      holidayRule: rule.holidayRule,
    };
  }

  /**
   * The series' own columns from a request: checked and shaped (assignee rule, collaborators, type,
   * service, reminders, the client notice). Only what the request holds is returned, so an update
   * leaves the rest. The reminders are checked against the due time as a task's are, also the
   * kept ones when only the due time changes: every task made gets them.
   */
  private async fields(
    tx: TxClient,
    businessId: string,
    b: Partial<Omit<CreateBody, 'recurrence' | 'clientId' | 'reminders'>> & {
      assignmentRule?: 'UNASSIGNED' | 'SPECIFIC_USER' | 'CLIENT_TEAM';
      assignedUserId?: string | null;
      checklist?: { label: string; required: boolean }[];
      reminders?: Reminder[];
    },
    current?: Row,
  ) {
    const out: SeriesFields = {};
    if (b.title !== undefined) out.title = b.title;
    if (b.details !== undefined) out.details = b.details;
    if (b.engagementId !== undefined) out.engagementId = b.engagementId;
    if (b.priority !== undefined) out.priority = b.priority;
    if (b.typeId !== undefined) {
      if (b.typeId) {
        const type = await tx.taskType.findFirst({
          where: { businessId, id: b.typeId },
          select: { archivedAt: true },
        });
        if (!type) throw taskErrors.invalid('typeId', 'Choose a task type');
        if (type.archivedAt && b.typeId !== current?.typeId) throw taskErrors.typeArchived();
      }
      out.typeId = b.typeId;
    }
    if (b.serviceId !== undefined) {
      if (b.serviceId) {
        const service = await tx.service.findFirst({
          where: { businessId, id: b.serviceId },
          select: { id: true },
        });
        if (!service) throw taskErrors.invalid('serviceId', 'Choose a service');
      }
      out.serviceId = b.serviceId;
    }
    if (b.assignmentRule !== undefined || b.assignedUserId !== undefined) {
      const rule = b.assignmentRule ?? current?.assignmentRule ?? 'UNASSIGNED';
      const person =
        b.assignedUserId !== undefined ? b.assignedUserId : (current?.assignedUserId ?? null);
      if (rule === 'SPECIFIC_USER') {
        if (!person) throw taskErrors.invalid('assignedUserId', 'Choose who it goes to');
        const member = await tx.membership.count({
          where: { businessId, userId: person, status: 'ACTIVE' },
        });
        if (member === 0) throw notAMember();
      } else if (person) {
        throw taskErrors.invalid('assignedUserId', 'Use a person only with "specific person"');
      }
      out.assignmentRule = rule;
      out.assignedUserId = rule === 'SPECIFIC_USER' ? person : null;
    }
    if (b.extraAssigneeIds !== undefined) {
      const ids = [...new Set(b.extraAssigneeIds.map((i) => i.toLowerCase()))];
      if (ids.length > 0) {
        const members = await tx.membership.count({
          where: { businessId, userId: { in: ids }, status: 'ACTIVE' },
        });
        if (members !== ids.length) throw notAMember();
      }
      out.extraAssigneeIds = ids;
    }
    if (b.createAtPeriodStart !== undefined) out.createAtPeriodStart = b.createAtPeriodStart;
    if (b.leadDays !== undefined) out.leadDays = b.leadDays;
    if (b.linkTaxCalendar !== undefined) out.linkTaxCalendar = b.linkTaxCalendar;
    if (b.dueTime !== undefined) out.dueTime = b.dueTime ? timeOfDayToDb(b.dueTime) : null;
    if (b.clientVisible !== undefined) out.clientVisible = b.clientVisible;
    if (b.notifyClient !== undefined) out.notifyClient = b.notifyClient;
    const visible = b.clientVisible ?? current?.clientVisible ?? false;
    const notify = b.notifyClient ?? current?.notifyClient ?? false;
    if (notify && !visible) {
      throw taskErrors.invalid('notifyClient', 'Make the task visible to the client first');
    }
    if (
      !visible &&
      b.clientVisible === false &&
      current?.notifyClient &&
      b.notifyClient === undefined
    ) {
      out.notifyClient = false;
    }
    if (b.checklist !== undefined)
      out.checklist = b.checklist.map((i) => ({ label: i.label, required: i.required }));
    if (b.reminders !== undefined || (current && b.dueTime !== undefined)) {
      const dueTime =
        b.dueTime !== undefined
          ? b.dueTime
          : current?.dueTime
            ? timeOfDayFromDb(current.dueTime)
            : null;
      checkReminders(b.reminders ?? remindersFromJson(current?.reminders), dueTime, true);
    }
    if (b.reminders !== undefined) out.reminders = remindersJson(b.reminders);
    return out;
  }

  private async find(
    tx: TxClient,
    businessId: string,
    actor: ClientsActor | null,
    id: string,
  ): Promise<Row> {
    const row = await tx.taskSeries.findFirst({
      where: { businessId, id, ...(actor ? this.reach(actor) : {}) },
      include,
    });
    if (!row) throw notFound();
    return row;
  }

  /** The series, its client then itself locked: a change waits for the generator and the reverse. */
  private async lock(tx: TxClient, businessId: string, actor: ClientsActor, id: string) {
    const owner = await tx.taskSeries.findFirst({
      where: { businessId, id },
      select: { clientId: true },
    });
    if (!owner) throw notFound();
    const client = await lockClient(tx, businessId, owner.clientId);
    if (!client || !reachesClient(actor, client)) throw notFound();
    const [locked] = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM task_series WHERE business_id = ${businessId}::uuid AND id = ${id}::uuid FOR UPDATE`;
    if (!locked) throw notFound();
    return { row: await this.find(tx, businessId, null, id) };
  }

  private async stats(tx: TxClient, businessId: string, ids: string[]) {
    const [next, made] = await Promise.all([
      tx.taskOccurrence.groupBy({
        by: ['seriesId'],
        where: { businessId, seriesId: { in: ids }, state: 'SCHEDULED' },
        _min: { dueOn: true },
      }),
      tx.taskOccurrence.groupBy({
        by: ['seriesId'],
        where: { businessId, seriesId: { in: ids }, state: 'GENERATED' },
        _count: true,
      }),
    ]);
    return {
      next: new Map(next.map((n) => [n.seriesId, day(n._min.dueOn)])),
      made: new Map(made.map((m) => [m.seriesId, m._count])),
    };
  }

  private async read(
    tx: TxClient,
    businessId: string,
    actor: ClientsActor | null,
    id: string,
  ): Promise<TaskSeriesDetail> {
    const row = await this.find(tx, businessId, actor, id);
    const [stats, names, clock] = await Promise.all([
      this.stats(tx, businessId, [id]),
      memberNames(tx, businessId, [row.createdByUserId, ...row.extraAssigneeIds]),
      firmClock(tx, businessId),
    ]);
    const rule = ruleOf(row);
    return {
      id: row.id,
      title: row.title,
      client: row.client,
      type: row.type,
      priority: row.priority,
      assignedTo: assignee(row.assignedMember),
      summary: describe(rule),
      status: row.status,
      nextDueOn: stats.next.get(id) ?? null,
      generatedCount: stats.made.get(id) ?? 0,
      updatedAt: row.updatedAt.toISOString(),
      details: row.details,
      engagementId: row.engagementId,
      service: row.service,
      assignmentRule: row.assignmentRule,
      extraAssignees: row.extraAssigneeIds.flatMap((u) => {
        const ref = memberRef(names, u);
        return ref ? [ref] : [];
      }),
      recurrence: {
        interval: rule.interval,
        unit: rule.unit,
        pattern: rule.pattern as Record<string, unknown>,
        startOn: rule.startOn,
        endMode: rule.endMode,
        endAfterCount: rule.endAfterCount,
        endOn: rule.endOn,
        holidayRule: rule.holidayRule,
      },
      createAtPeriodStart: row.createAtPeriodStart,
      leadDays: row.leadDays,
      linkTaxCalendar: row.linkTaxCalendar,
      dueTime: row.dueTime ? timeOfDayFromDb(row.dueTime) : null,
      clientVisible: row.clientVisible,
      notifyClient: row.notifyClient,
      checklist: (Array.isArray(row.checklist)
        ? (row.checklist as { label: string; required?: boolean }[])
        : []
      ).map((i) => ({
        label: i.label,
        required: i.required ?? false,
      })),
      reminders: remindersOf(row.reminders),
      upcoming:
        row.status === 'ACTIVE' ? schedule(rule, { limit: UPCOMING, from: clock.today }) : [],
      pausedAt: row.pausedAt?.toISOString() ?? null,
      endedAt: row.endedAt?.toISOString() ?? null,
      createdBy: memberRef(names, row.createdByUserId),
      createdAt: row.createdAt.toISOString(),
      version: row.updatedAt.toISOString(),
    };
  }
}

function stripUndefined<T extends object>(o: T): Partial<T> {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Partial<T>;
}
