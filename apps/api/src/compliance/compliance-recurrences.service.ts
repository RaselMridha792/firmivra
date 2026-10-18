import { Inject, Injectable } from '@nestjs/common';
import type { Database, Prisma, TxClient } from '@firmivra/db';
import {
  type ComplianceRecurrence,
  type ComplianceRecurrencePage,
  type ComplianceRecurrencePreview,
  type ComplianceRecurrencesQuery,
  ComplianceRepeatRule,
  type CreateComplianceRecurrenceRequest,
  CreateComplianceRecurrenceRequest as CreateSchema,
  type PreviewRecurrenceRequest,
  type SaveDeadlineAsTemplateRequest,
  type UpdateComplianceRecurrenceRequest,
} from '@firmivra/types';
import type { z } from 'zod';
import { AuditService } from '../audit/audit.service.js';
import { DATABASE, TenantPrisma } from '../database/database.module.js';
import { isUniqueViolation, notAMember } from '../workspaces/common.js';
import { type ComplianceActor, iso, reachWhere, remindersOf } from './compliance.mappers.js';
import {
  day,
  errors,
  inFirm,
  isoDay,
  mapComplianceDbError,
  occurrences,
  parseDay,
  todayOf,
  toDay,
} from './compliance.shared.js';

type Create = z.output<typeof CreateComplianceRecurrenceRequest>;
type Update = z.output<typeof UpdateComplianceRecurrenceRequest>;

const include = {
  calendarEntry: { select: { id: true, name: true } },
  assignedMember: { select: { userId: true, user: { select: { name: true } } } },
  _count: { select: { deadlines: true } },
} satisfies Prisma.ComplianceRecurrenceInclude;

type Row = Prisma.ComplianceRecurrenceGetPayload<{ include: typeof include }>;

const repeatRuleOf = (value: unknown): ComplianceRecurrence['repeatRule'] => {
  const parsed = ComplianceRepeatRule.safeParse(value);
  return parsed.success ? parsed.data : {};
};

function toRecurrence(r: Row, today: Date): ComplianceRecurrence {
  const repeatRule = repeatRuleOf(r.repeatRule);
  const next =
    !r.isTemplate && r.status === 'ACTIVE' && r.startOn
      ? occurrences(
          {
            frequency: r.frequency,
            interval: r.interval,
            repeatRule,
            startOn: r.startOn,
            endMode: r.endMode,
            endAfterCount: r.endAfterCount,
            endOn: r.endOn,
            holidayRule: r.holidayRule,
          },
          { count: 1, notBefore: today },
        )[0]
      : undefined;
  return {
    id: r.id,
    name: r.name,
    type: r.type,
    description: r.description,
    agency: r.agency,
    relatedForm: r.relatedForm,
    jurisdiction: r.jurisdiction,
    state: r.state,
    calendarEntry: r.calendarEntry,
    frequency: r.frequency,
    interval: r.interval,
    repeatRule,
    startOn: day(r.startOn),
    endMode: r.endMode,
    endAfterCount: r.endAfterCount,
    endOn: day(r.endOn),
    holidayRule: r.holidayRule,
    isTemplate: r.isTemplate,
    createTask: r.createTask,
    taskTemplateId: r.taskTemplateId,
    assignedTo: r.assignedMember
      ? { userId: r.assignedMember.userId, name: r.assignedMember.user.name }
      : null,
    clientVisible: r.clientVisible,
    remindClient: r.remindClient,
    addToTaxCalendar: r.addToTaxCalendar,
    notifyTeam: r.notifyTeam,
    reminders: remindersOf(r.reminders),
    sendPastDueNotice: r.sendPastDueNotice,
    escalateToManager: r.escalateToManager,
    status: r.status,
    pausedAt: iso(r.pausedAt),
    endedAt: iso(r.endedAt),
    nextDueOn: next ? isoDay(next.dueOn) : null,
    deadlineCount: r._count.deadlines,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}

/**
 * Recurring deadline definitions and their templates (Frame 3: Setup Recurring Deadline, Manage
 * Existing Recurring). A template makes no deadlines. The repeat rule gives the statutory date
 * and the holiday rule the date the firm works to, so the unadjusted date is never lost. Staff
 * read; Owner and Admin create, change, pause, end and archive.
 */
@Injectable()
export class ComplianceRecurrencesService {
  constructor(
    @Inject(DATABASE) private readonly database: Database,
    private readonly tenantPrisma: TenantPrisma,
    private readonly audit: AuditService,
  ) {}

  async list(
    businessId: string,
    q: z.output<typeof ComplianceRecurrencesQuery>,
  ): Promise<ComplianceRecurrencePage> {
    const db = this.tenantPrisma.db;
    const where: Prisma.ComplianceRecurrenceWhereInput = {
      businessId,
      ...(q.status ? { status: q.status } : {}),
      ...(q.templates !== undefined ? { isTemplate: q.templates } : {}),
      ...(q.type ? { type: q.type } : {}),
      ...(q.search ? { name: { contains: q.search, mode: 'insensitive' } } : {}),
    };
    const today = todayOf();
    if (q.sort === 'nextDueOn') {
      const all = (await db.complianceRecurrence.findMany({ where, include, take: 1000 })).map(
        (r) => toRecurrence(r, today),
      );
      const sign = q.direction === 'asc' ? 1 : -1;
      all.sort(
        (a, b) =>
          sign * (a.nextDueOn ?? '9999-12-31').localeCompare(b.nextDueOn ?? '9999-12-31') ||
          a.name.localeCompare(b.name),
      );
      return {
        items: all.slice((q.page - 1) * q.pageSize, q.page * q.pageSize),
        total: all.length,
        page: q.page,
        pageSize: q.pageSize,
      };
    }
    const [rows, total] = await Promise.all([
      db.complianceRecurrence.findMany({
        where,
        include,
        orderBy: [{ [q.sort]: q.direction }, { name: 'asc' }, { id: 'asc' }],
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
      }),
      db.complianceRecurrence.count({ where }),
    ]);
    return {
      items: rows.map((r) => toRecurrence(r, today)),
      total,
      page: q.page,
      pageSize: q.pageSize,
    };
  }

  async get(businessId: string, id: string): Promise<ComplianceRecurrence> {
    const row = await this.tenantPrisma.db.complianceRecurrence.findFirst({
      where: { businessId, id },
      include,
    });
    if (!row) throw errors.notFound();
    return toRecurrence(row, todayOf());
  }

  /** The records a definition names must be this firm's. */
  private async checkRefs(
    tx: TxClient,
    businessId: string,
    refs: {
      calendarEntryId?: string | null | undefined;
      taskTemplateId?: string | null | undefined;
      assignedUserId?: string | null | undefined;
    },
  ) {
    if (refs.calendarEntryId) {
      const entry = await tx.complianceCalendarEntry.findFirst({
        where: { businessId, id: refs.calendarEntryId },
        select: { id: true },
      });
      if (!entry) throw errors.notFound();
    }
    if (refs.taskTemplateId) {
      const template = await tx.taskTemplate.findFirst({
        where: { businessId, id: refs.taskTemplateId, archivedAt: null },
        select: { id: true },
      });
      if (!template) throw errors.templateNotFound();
    }
    if (refs.assignedUserId) {
      const member = await tx.membership.findFirst({
        where: { businessId, userId: refs.assignedUserId, status: 'ACTIVE' },
        select: { userId: true },
      });
      if (!member) throw notAMember();
    }
  }

  private data(b: Create): Prisma.ComplianceRecurrenceUncheckedCreateInput {
    return {
      businessId: '',
      name: b.name,
      type: b.type,
      description: b.description ?? null,
      agency: b.agency ?? null,
      relatedForm: b.relatedForm ?? null,
      jurisdiction: b.jurisdiction ?? null,
      state: b.state ?? null,
      calendarEntryId: b.calendarEntryId ?? null,
      frequency: b.frequency,
      interval: b.interval ?? null,
      repeatRule: b.repeatRule as Prisma.InputJsonValue,
      startOn: b.startOn ? toDay(b.startOn) : null,
      endMode: b.endMode,
      endAfterCount: b.endAfterCount ?? null,
      endOn: b.endOn ? toDay(b.endOn) : null,
      holidayRule: b.holidayRule,
      isTemplate: b.isTemplate,
      createTask: b.createTask,
      taskTemplateId: b.createTask ? (b.taskTemplateId ?? null) : null,
      assignedUserId: b.assignedUserId ?? null,
      clientVisible: b.clientVisible,
      remindClient: b.remindClient,
      addToTaxCalendar: b.addToTaxCalendar,
      notifyTeam: b.notifyTeam,
      reminders: b.reminders as Prisma.InputJsonValue,
      sendPastDueNotice: b.sendPastDueNotice,
      escalateToManager: b.escalateToManager,
    };
  }

  async create(
    businessId: string,
    actor: ComplianceActor,
    body: Create,
  ): Promise<ComplianceRecurrence> {
    try {
      const row = await inFirm(this.database, businessId, async (tx) => {
        await this.checkRefs(tx, businessId, body);
        const created = await tx.complianceRecurrence.create({
          data: { ...this.data(body), businessId, createdByUserId: actor.userId },
          include,
        });
        await this.audit.logIn(
          tx,
          'compliance.recurrence.created',
          { type: 'compliance_recurrence', id: created.id },
          { frequency: body.frequency, isTemplate: body.isTemplate, type: body.type },
        );
        return created;
      });
      return toRecurrence(row, todayOf());
    } catch (error) {
      return this.rethrow(error);
    }
  }

  async update(businessId: string, id: string, body: Update): Promise<ComplianceRecurrence> {
    try {
      const row = await inFirm(this.database, businessId, async (tx) => {
        const current = await tx.complianceRecurrence.findFirst({ where: { businessId, id } });
        if (!current) throw errors.notFound();
        if (current.status === 'ENDED' || current.status === 'ARCHIVED') {
          throw errors.recurrenceState('An ended or archived definition cannot be changed');
        }
        // The change as a whole must be a valid definition, as the DB checks it.
        const merged = CreateSchema.safeParse({
          name: current.name,
          type: current.type,
          description: current.description,
          agency: current.agency,
          relatedForm: current.relatedForm,
          jurisdiction: current.jurisdiction,
          state: current.state,
          calendarEntryId: current.calendarEntryId,
          frequency: current.frequency,
          interval: current.interval,
          repeatRule: current.repeatRule,
          startOn: day(current.startOn),
          endMode: current.endMode,
          endAfterCount: current.endAfterCount,
          endOn: day(current.endOn),
          holidayRule: current.holidayRule,
          isTemplate: current.isTemplate,
          createTask: current.createTask,
          taskTemplateId: current.taskTemplateId,
          assignedUserId: current.assignedUserId,
          clientVisible: current.clientVisible,
          remindClient: current.remindClient,
          addToTaxCalendar: current.addToTaxCalendar,
          notifyTeam: current.notifyTeam,
          reminders: remindersOf(current.reminders),
          sendPastDueNotice: current.sendPastDueNotice,
          escalateToManager: current.escalateToManager,
          ...body,
        });
        if (!merged.success) {
          const issue = merged.error.issues[0];
          throw errors.invalid(issue?.path.join('.') ?? '', issue?.message ?? 'Not valid');
        }
        await this.checkRefs(tx, businessId, body);
        const data = this.data(merged.data);
        const { businessId: _b, ...fields } = data;
        void _b;
        const updated = await tx.complianceRecurrence.update({
          where: { businessId_id: { businessId, id } },
          data: fields,
          include,
        });
        await this.audit.logIn(
          tx,
          'compliance.recurrence.updated',
          { type: 'compliance_recurrence', id },
          { fields: Object.keys(body).sort() },
        );
        return updated;
      });
      return toRecurrence(row, todayOf());
    } catch (error) {
      return this.rethrow(error);
    }
  }

  private async move(
    businessId: string,
    id: string,
    from: readonly string[],
    data: Prisma.ComplianceRecurrenceUncheckedUpdateManyInput,
    action: string,
    message: string,
  ): Promise<ComplianceRecurrence> {
    const row = await inFirm(this.database, businessId, async (tx) => {
      const current = await tx.complianceRecurrence.findFirst({
        where: { businessId, id },
        select: { status: true, endedAt: true },
      });
      if (!current) throw errors.notFound();
      if (!from.includes(current.status)) throw errors.recurrenceState(message);
      const { count } = await tx.complianceRecurrence.updateMany({
        where: { businessId, id, status: current.status },
        data:
          action === 'compliance.recurrence.archived'
            ? { ...data, endedAt: current.endedAt ?? new Date() }
            : data,
      });
      if (count === 0) throw errors.recurrenceState('The definition changed: try again');
      await this.audit.logIn(
        tx,
        action,
        { type: 'compliance_recurrence', id },
        { from: current.status },
      );
      return tx.complianceRecurrence.findFirstOrThrow({ where: { businessId, id }, include });
    });
    return toRecurrence(row, todayOf());
  }

  pause(businessId: string, id: string) {
    return this.move(
      businessId,
      id,
      ['ACTIVE'],
      { status: 'PAUSED', pausedAt: new Date() },
      'compliance.recurrence.paused',
      'Only an active definition can be paused',
    );
  }

  resume(businessId: string, id: string) {
    return this.move(
      businessId,
      id,
      ['PAUSED'],
      { status: 'ACTIVE', pausedAt: null },
      'compliance.recurrence.resumed',
      'Only a paused definition can be resumed',
    );
  }

  /** Ends the definition: no more deadlines are made, the ones made stay. */
  end(businessId: string, id: string) {
    return this.move(
      businessId,
      id,
      ['ACTIVE', 'PAUSED'],
      { status: 'ENDED', endedAt: new Date() },
      'compliance.recurrence.ended',
      'This definition has already ended',
    );
  }

  archive(businessId: string, id: string) {
    return this.move(
      businessId,
      id,
      ['ACTIVE', 'PAUSED', 'ENDED'],
      { status: 'ARCHIVED' },
      'compliance.recurrence.archived',
      'This definition is already archived',
    );
  }

  /** The next calculated dates before saving. */
  async preview(
    businessId: string,
    body: z.output<typeof PreviewRecurrenceRequest>,
  ): Promise<ComplianceRecurrencePreview> {
    if (body.frequency === 'AUTHORITY_DEFINED') {
      const entry = body.calendarEntryId
        ? await this.tenantPrisma.db.complianceCalendarEntry.findFirst({
            where: { businessId, id: body.calendarEntryId },
            select: { dueOn: true },
          })
        : null;
      if (body.calendarEntryId && !entry) throw errors.notFound();
      return entry?.dueOn
        ? {
            dates: [
              {
                statutoryOn: day(entry.dueOn) as string,
                dueOn: day(entry.dueOn) as string,
                adjusted: false,
              },
            ],
            message: null,
          }
        : {
            dates: [],
            message: "The dates come from the authority's published calendar.",
          };
    }
    const startOn = body.startOn ? parseDay(body.startOn) : todayOf();
    const dates = occurrences(
      {
        frequency: body.frequency,
        interval: body.interval ?? null,
        repeatRule: body.repeatRule,
        startOn,
        endMode: body.endMode,
        endAfterCount: body.endAfterCount ?? null,
        endOn: body.endOn ? parseDay(body.endOn) : null,
        holidayRule: body.holidayRule,
      },
      { count: body.count },
    ).map((o) => ({
      statutoryOn: isoDay(o.statutoryOn),
      dueOn: isoDay(o.dueOn),
      adjusted: o.adjusted,
    }));
    return { dates, message: null };
  }

  /** Save as Template (Frame 2): the deadline's fields as a template; it makes no deadlines. */
  async saveDeadlineAsTemplate(
    businessId: string,
    actor: ComplianceActor,
    deadlineId: string,
    body: z.output<typeof SaveDeadlineAsTemplateRequest>,
  ): Promise<ComplianceRecurrence> {
    try {
      const row = await inFirm(this.database, businessId, async (tx) => {
        const d = await tx.complianceDeadline.findFirst({
          where: { AND: [{ businessId, id: deadlineId }, reachWhere(actor)] },
          include: { reminders: true },
        });
        if (!d) throw errors.notFound();
        const created = await tx.complianceRecurrence.create({
          data: {
            businessId,
            name: body.name,
            type: d.type,
            description: d.description,
            agency: d.agency,
            relatedForm: d.relatedForm,
            jurisdiction: d.jurisdiction,
            state: d.state,
            frequency: 'ANNUAL',
            repeatRule: { month: d.dueOn.getUTCMonth() + 1, day: d.dueOn.getUTCDate() },
            isTemplate: true,
            createTask: d.createTask,
            taskTemplateId: d.taskTemplateId,
            assignedUserId: d.assignedUserId,
            clientVisible: d.clientVisible,
            reminders: d.reminders.map((r) => ({
              daysBefore: r.daysBefore,
              inApp: r.inApp,
              channels: r.channels,
            })),
            createdByUserId: actor.userId,
          },
          include,
        });
        await this.audit.logIn(
          tx,
          'compliance.recurrence.template-saved',
          { type: 'compliance_recurrence', id: created.id },
          { fromDeadlineId: deadlineId, clientId: d.clientId },
        );
        return created;
      });
      return toRecurrence(row, todayOf());
    } catch (error) {
      return this.rethrow(error);
    }
  }

  private rethrow(error: unknown): never {
    if (isUniqueViolation(error)) {
      throw errors.duplicate('A recurring definition or template with this name already exists');
    }
    return mapComplianceDbError(error);
  }
}
