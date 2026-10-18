import { Inject, Injectable } from '@nestjs/common';
import type { Database, Prisma, TxClient } from '@firmivra/db';
import type {
  OkResponse,
  ReportRunStatusView,
  ReportScheduleDetail,
  ReportSchedulePage,
} from '@firmivra/types';
import type { z } from 'zod';
import { AuditService } from '../audit/audit.service.js';
import type { TenantContext } from '../common/request-context.js';
import { DATABASE } from '../database/database.module.js';
import { isUniqueViolation, memberNames, notFound } from '../workspaces/common.js';
import { isAdmin, reportErrors, requireWrite, systemReport } from './reports.common.js';
import type { CreateScheduleBody, SchedulesQuery, UpdateScheduleBody } from './reports-input.js';
import { ReportsExportService } from './reports-export.service.js';
import { ReportsSavedService } from './reports-saved.service.js';
import { type Ctx, ReportsService } from './reports.service.js';
import { type ScheduleShape, scheduleInclude, toScheduleRows } from './schedule-rows.js';
import { describeSchedule, nextRun } from './schedule-math.js';
import { sourceOf } from './sources.js';

type Query = z.output<typeof SchedulesQuery>;
type Create = z.output<typeof CreateScheduleBody>;
type Update = z.output<typeof UpdateScheduleBody>;

const ENTITY = 'report_schedule';
const asTime = (hhmm: string) => new Date(`1970-01-01T${hhmm}:00.000Z`);
const hhmm = (d: Date) => d.toISOString().slice(11, 16);

/**
 * Scheduled reports: a saved or built-in report, its frequency and run time in the firm's time
 * zone, a rolling date range and its recipients. A schedule only reaches firm members who may see
 * the report's data (an outside address is refused: there is no approved-recipient list yet), and
 * delivery never widens access. Delete Schedule stops future runs and keeps the schedule for the
 * runs that point at it. Only CSV is built for now (400 for PDF or Excel). `nextRunAt` is what the
 * scheduler job reads. Audited with ids.
 */
@Injectable()
export class ReportsSchedulesService {
  constructor(
    @Inject(DATABASE) private readonly database: Database,
    private readonly audit: AuditService,
    private readonly reports: ReportsService,
    private readonly saved: ReportsSavedService,
    private readonly exports: ReportsExportService,
  ) {}

  private inFirm<T>(businessId: string, fn: (tx: TxClient) => Promise<T>): Promise<T> {
    return this.database.withScope({ kind: 'business', businessId }, fn);
  }

  // ---------- Reads ----------

  list(
    businessId: string,
    tenant: TenantContext,
    userId: string,
    q: Query,
  ): Promise<ReportSchedulePage> {
    return this.inFirm(businessId, async (tx) => {
      const ctx = await this.reports.ctx(tx, businessId, tenant, userId);
      const where: Prisma.ReportScheduleWhereInput = {
        businessId,
        deletedAt: null,
        ...(q.status === 'active'
          ? { active: true }
          : q.status === 'paused'
            ? { active: false }
            : {}),
        ...(q.search ? { name: { contains: q.search, mode: 'insensitive' } } : {}),
        ...(isAdmin(tenant) ? {} : { ownerUserId: ctx.actor.userId }),
      };
      const [total, rows] = await Promise.all([
        tx.reportSchedule.count({ where }),
        tx.reportSchedule.findMany({
          where,
          orderBy: [{ nextRunAt: 'asc' }, { id: 'asc' }],
          skip: (q.page - 1) * q.pageSize,
          take: q.pageSize,
          include: scheduleInclude,
        }),
      ]);
      return {
        items: await toScheduleRows(tx, businessId, rows),
        total,
        page: q.page,
        pageSize: q.pageSize,
      };
    });
  }

  get(
    businessId: string,
    tenant: TenantContext,
    userId: string,
    id: string,
  ): Promise<ReportScheduleDetail> {
    return this.inFirm(businessId, (tx) => this.detailIn(tx, businessId, tenant, userId, id));
  }

  private async load(
    tx: TxClient,
    businessId: string,
    tenant: TenantContext,
    userId: string,
    id: string,
  ): Promise<ScheduleShape> {
    const r = await tx.reportSchedule.findFirst({
      where: {
        businessId,
        id,
        deletedAt: null,
        ...(isAdmin(tenant) ? {} : { ownerUserId: userId }),
      },
      include: scheduleInclude,
    });
    if (!r) throw notFound();
    return r;
  }

  private async detailIn(
    tx: TxClient,
    businessId: string,
    tenant: TenantContext,
    userId: string,
    id: string,
  ): Promise<ReportScheduleDetail> {
    const r = await this.load(tx, businessId, tenant, userId, id);
    const [row] = await toScheduleRows(tx, businessId, [r]);
    const names = await memberNames(
      tx,
      businessId,
      r.recipients.flatMap((x) => (x.userId ? [x.userId] : [])),
    );
    return {
      ...row!,
      target: r.definitionId
        ? { kind: 'SAVED', id: r.definitionId }
        : { kind: 'SYSTEM', key: r.systemKey! },
      weekday: r.weekday,
      dayOfMonth: r.dayOfMonth,
      monthOfYear: r.monthOfYear,
      runTime: hhmm(r.runTime),
      timezone: r.timezone,
      datePreset: r.datePreset as ReportScheduleDetail['datePreset'],
      recipientUsers: r.recipients.flatMap((x) =>
        x.userId && names.get(x.userId) ? [{ userId: x.userId, name: names.get(x.userId)! }] : [],
      ),
      recipientEmails: r.recipients.flatMap((x) => (x.email ? [x.email] : [])),
      deliverEmail: r.deliverEmail,
      deliverInApp: r.deliverInApp,
      consecutiveFailures: r.consecutiveFailures,
      createdAt: r.createdAt.toISOString(),
    };
  }

  // ---------- Writes ----------

  async create(
    businessId: string,
    tenant: TenantContext,
    userId: string,
    body: Create,
  ): Promise<ReportScheduleDetail> {
    requireWrite(tenant);
    this.formats(body.formats);
    // The target is checked and, for Save & Schedule, the report saved first: nothing is scheduled if that fails.
    let target: { definitionId: string | null; systemKey: string | null };
    let dataSource: string;
    if (body.target.kind === 'NEW') {
      const preflight = await this.inFirm(businessId, async (tx) => {
        const ctx = await this.reports.ctx(tx, businessId, tenant, userId);
        return this.recipientsOk(
          tx,
          businessId,
          ctx,
          sourceOf(body.target.kind === 'NEW' ? body.target.report.definition.dataSource : '')
            ?.restricted ?? false,
          body.recipientUserIds,
          body.recipientEmails,
        );
      });
      void preflight;
      const saved = await this.saved.save(businessId, tenant, userId, body.target.report);
      target = { definitionId: saved.id, systemKey: null };
      dataSource = saved.dataSource;
    } else if (body.target.kind === 'SAVED') {
      const t = body.target;
      const row = await this.inFirm(businessId, async (tx) => {
        const ctx = await this.reports.ctx(tx, businessId, tenant, userId);
        const found = await tx.reportDefinition.findFirst({
          where: { AND: [{ businessId, id: t.id, archivedAt: null }, this.reports.visible(ctx)] },
          select: { id: true, dataSource: true },
        });
        if (!found) throw notFound();
        return found;
      });
      target = { definitionId: row.id, systemKey: null };
      dataSource = row.dataSource;
    } else {
      const sys = systemReport(body.target.key);
      if (!sys) throw notFound();
      target = { definitionId: null, systemKey: sys.key };
      dataSource = sys.dataSource;
    }
    const id = await this.inFirm(businessId, async (tx) => {
      const ctx = await this.reports.ctx(tx, businessId, tenant, userId);
      const source = sourceOf(dataSource);
      if (source?.restricted && !ctx.restricted) throw reportErrors.fieldNotAllowed([source.key]);
      await this.recipientsOk(
        tx,
        businessId,
        ctx,
        source?.restricted ?? false,
        body.recipientUserIds,
        body.recipientEmails,
      );
      const next = nextRun(
        {
          frequency: body.frequency,
          weekday: body.weekday ?? null,
          dayOfMonth: body.dayOfMonth ?? null,
          monthOfYear: body.monthOfYear ?? null,
          runTime: body.runTime,
        },
        ctx.timezone,
      );
      const row = await tx.reportSchedule.create({
        data: {
          businessId,
          ...target,
          name: body.name.replace(/<[^>]*>/g, '').trim(),
          frequency: body.frequency,
          weekday: body.frequency === 'WEEKLY' ? (body.weekday ?? null) : null,
          dayOfMonth: ['MONTHLY', 'QUARTERLY', 'ANNUAL'].includes(body.frequency)
            ? (body.dayOfMonth ?? null)
            : null,
          monthOfYear: body.frequency === 'ANNUAL' ? (body.monthOfYear ?? null) : null,
          runTime: asTime(body.runTime),
          timezone: ctx.timezone,
          datePreset: body.datePreset,
          formats: body.formats,
          deliverEmail: body.deliverEmail,
          deliverInApp: body.deliverInApp,
          active: body.active,
          nextRunAt: body.active ? next : null,
          ownerUserId: userId,
        },
        select: { id: true },
      });
      await this.setRecipients(tx, businessId, row.id, body.recipientUserIds, body.recipientEmails);
      await this.audit.logIn(
        tx,
        'report_schedule.created',
        { type: ENTITY, id: row.id },
        { frequency: body.frequency },
        { businessId, actorUserId: userId },
      );
      return row.id;
    });
    return this.get(businessId, tenant, userId, id);
  }

  async update(
    businessId: string,
    tenant: TenantContext,
    userId: string,
    id: string,
    body: Update,
  ): Promise<ReportScheduleDetail> {
    requireWrite(tenant);
    if (body.formats) this.formats(body.formats);
    await this.inFirm(businessId, async (tx) => {
      const ctx = await this.reports.ctx(tx, businessId, tenant, userId);
      const cur = await this.load(tx, businessId, tenant, userId, id);
      const frequency = body.frequency ?? cur.frequency;
      const rule = {
        frequency,
        weekday: body.weekday !== undefined ? body.weekday : cur.weekday,
        dayOfMonth: body.dayOfMonth !== undefined ? body.dayOfMonth : cur.dayOfMonth,
        monthOfYear: body.monthOfYear !== undefined ? body.monthOfYear : cur.monthOfYear,
        runTime: body.runTime ?? hhmm(cur.runTime),
      };
      // The day fields each frequency needs, and no others (the database insists).
      if (frequency === 'WEEKLY' && rule.weekday == null)
        throw reportErrors.invalid('weekday', 'Choose the weekday');
      if (frequency !== 'DAILY' && frequency !== 'WEEKLY' && rule.dayOfMonth == null)
        throw reportErrors.invalid('dayOfMonth', 'Choose the day of the month');
      if (frequency === 'ANNUAL' && rule.monthOfYear == null)
        throw reportErrors.invalid('monthOfYear', 'Choose the month');
      const clean = {
        weekday: frequency === 'WEEKLY' ? rule.weekday : null,
        dayOfMonth: ['MONTHLY', 'QUARTERLY', 'ANNUAL'].includes(frequency) ? rule.dayOfMonth : null,
        monthOfYear: frequency === 'ANNUAL' ? rule.monthOfYear : null,
      };
      const deliverEmail = body.deliverEmail ?? cur.deliverEmail;
      const deliverInApp = body.deliverInApp ?? cur.deliverInApp;
      if (!deliverEmail && !deliverInApp)
        throw reportErrors.invalid('deliverEmail', 'Choose how it is delivered');
      if (body.recipientUserIds !== undefined || body.recipientEmails !== undefined) {
        const userIds =
          body.recipientUserIds ?? cur.recipients.flatMap((x) => (x.userId ? [x.userId] : []));
        const emails =
          body.recipientEmails ?? cur.recipients.flatMap((x) => (x.email ? [x.email] : []));
        if (userIds.length + emails.length === 0)
          throw reportErrors.invalid('recipientUserIds', 'Add a recipient');
        const source = await this.sourceOfSchedule(tx, businessId, cur);
        await this.recipientsOk(tx, businessId, ctx, source?.restricted ?? false, userIds, emails);
        await tx.reportScheduleRecipient.deleteMany({ where: { businessId, scheduleId: id } });
        await this.setRecipients(tx, businessId, id, userIds, emails);
      }
      await tx.reportSchedule.update({
        where: { id },
        data: {
          ...(body.name ? { name: body.name.replace(/<[^>]*>/g, '').trim() } : {}),
          frequency,
          ...clean,
          runTime: asTime(rule.runTime),
          ...(body.datePreset ? { datePreset: body.datePreset } : {}),
          ...(body.formats ? { formats: body.formats } : {}),
          deliverEmail,
          deliverInApp,
          nextRunAt: cur.active ? nextRun({ ...rule, ...clean }, cur.timezone) : null,
        },
      });
      await this.audit.logIn(
        tx,
        'report_schedule.updated',
        { type: ENTITY, id },
        { fields: Object.keys(body) },
        { businessId, actorUserId: userId },
      );
    });
    return this.get(businessId, tenant, userId, id);
  }

  async setActive(
    businessId: string,
    tenant: TenantContext,
    userId: string,
    id: string,
    active: boolean,
  ): Promise<ReportScheduleDetail> {
    requireWrite(tenant);
    await this.inFirm(businessId, async (tx) => {
      const cur = await this.load(tx, businessId, tenant, userId, id);
      if (cur.active === active) return;
      await tx.reportSchedule.update({
        where: { id },
        data: {
          active,
          consecutiveFailures: active ? 0 : cur.consecutiveFailures,
          nextRunAt: active
            ? nextRun(
                {
                  frequency: cur.frequency,
                  weekday: cur.weekday,
                  dayOfMonth: cur.dayOfMonth,
                  monthOfYear: cur.monthOfYear,
                  runTime: hhmm(cur.runTime),
                },
                cur.timezone,
              )
            : null,
        },
      });
      await this.audit.logIn(
        tx,
        active ? 'report_schedule.resumed' : 'report_schedule.paused',
        { type: ENTITY, id },
        {},
        { businessId, actorUserId: userId },
      );
    });
    return this.get(businessId, tenant, userId, id);
  }

  async duplicate(
    businessId: string,
    tenant: TenantContext,
    userId: string,
    id: string,
  ): Promise<ReportScheduleDetail> {
    requireWrite(tenant);
    const newId = await this.inFirm(businessId, async (tx) => {
      const cur = await this.load(tx, businessId, tenant, userId, id);
      const row = await tx.reportSchedule.create({
        data: {
          businessId,
          definitionId: cur.definitionId,
          systemKey: cur.systemKey,
          name: `${cur.name.replace(/ \(Copy\)$/, '').slice(0, 190)} (Copy)`,
          frequency: cur.frequency,
          weekday: cur.weekday,
          dayOfMonth: cur.dayOfMonth,
          monthOfYear: cur.monthOfYear,
          runTime: cur.runTime,
          timezone: cur.timezone,
          datePreset: cur.datePreset,
          formats: cur.formats,
          deliverEmail: cur.deliverEmail,
          deliverInApp: cur.deliverInApp,
          // A copy is paused until its owner turns it on.
          active: false,
          ownerUserId: userId,
        },
        select: { id: true },
      });
      await this.setRecipients(
        tx,
        businessId,
        row.id,
        cur.recipients.flatMap((x) => (x.userId ? [x.userId] : [])),
        cur.recipients.flatMap((x) => (x.email ? [x.email] : [])),
      );
      await this.audit.logIn(
        tx,
        'report_schedule.duplicated',
        { type: ENTITY, id: row.id },
        { sourceId: id },
        { businessId, actorUserId: userId },
      );
      return row.id;
    });
    return this.get(businessId, tenant, userId, newId);
  }

  /** Delete Schedule: stops future runs; the row stays for the runs that point at it. */
  async remove(
    businessId: string,
    tenant: TenantContext,
    userId: string,
    id: string,
  ): Promise<OkResponse> {
    requireWrite(tenant);
    await this.inFirm(businessId, async (tx) => {
      await this.load(tx, businessId, tenant, userId, id);
      await tx.reportSchedule.update({
        where: { id },
        data: { deletedAt: new Date(), active: false, nextRunAt: null },
      });
      await this.audit.logIn(
        tx,
        'report_schedule.deleted',
        { type: ENTITY, id },
        {},
        { businessId, actorUserId: userId },
      );
    });
    return { ok: true };
  }

  /** Run Now: a new snapshot with the current definition and data; the schedule's own timing is unchanged. */
  async runNow(
    businessId: string,
    tenant: TenantContext,
    userId: string,
    id: string,
  ): Promise<ReportRunStatusView> {
    requireWrite(tenant);
    const cur = await this.inFirm(businessId, (tx) =>
      this.load(tx, businessId, tenant, userId, id),
    );
    const target = cur.definitionId
      ? ({ kind: 'SAVED', id: cur.definitionId } as const)
      : ({ kind: 'SYSTEM', key: cur.systemKey! } as const);
    const run = await this.exports.generate(
      businessId,
      tenant,
      userId,
      { target, date: { rule: 'ROLLING', preset: cur.datePreset as never } } as never,
      undefined,
      { kind: 'SCHEDULED', scheduleId: id },
    );
    await this.inFirm(businessId, (tx) =>
      tx.reportSchedule.update({
        where: { id },
        data: { lastRunAt: new Date(), lastStatus: 'SUCCEEDED', consecutiveFailures: 0 },
      }),
    );
    return run;
  }

  // ---------- Helpers ----------

  private formats(formats: string[]) {
    if (formats.some((f) => f !== 'CSV'))
      throw reportErrors.invalid(
        'formats',
        'Only CSV is available for now. PDF and Excel are coming.',
      );
  }

  private async sourceOfSchedule(tx: TxClient, businessId: string, s: ScheduleShape) {
    if (s.systemKey) return sourceOf(systemReport(s.systemKey)?.dataSource ?? '');
    const d = s.definitionId
      ? await tx.reportDefinition.findFirst({
          where: { businessId, id: s.definitionId },
          select: { dataSource: true },
        })
      : null;
    return d ? sourceOf(d.dataSource) : undefined;
  }

  /**
   * Recipients must be members of the firm and allowed to see the report's data: a restricted
   * source (money, team data) goes only to Owner, Admin or a role with Manage on Reports. Outside
   * addresses are refused: there is no approved-recipient list, so a schedule cannot disclose
   * client data outside the firm.
   */
  private async recipientsOk(
    tx: TxClient,
    businessId: string,
    ctx: Ctx,
    restricted: boolean,
    userIds: string[],
    emails: string[],
  ) {
    if (emails.length > 0)
      throw reportErrors.recipientNotAllowed('Reports go only to people in your firm.');
    if (userIds.length === 0) return;
    const members = await tx.membership.findMany({
      where: { businessId, userId: { in: [...new Set(userIds)] }, joinedAt: { not: null } },
      select: { userId: true, role: true },
    });
    if (members.length !== new Set(userIds).size) throw reportErrors.notAMember();
    if (restricted && members.some((m) => m.role !== 'OWNER' && m.role !== 'ADMIN')) {
      throw reportErrors.recipientNotAllowed('That person may not see this report’s data.');
    }
    void ctx;
  }

  private async setRecipients(
    tx: TxClient,
    businessId: string,
    scheduleId: string,
    userIds: string[],
    emails: string[],
  ) {
    const ids = [...new Set(userIds)];
    if (ids.length)
      await tx.reportScheduleRecipient.createMany({
        data: ids.map((userId) => ({ businessId, scheduleId, userId })),
      });
    const es = [...new Set(emails.map((e) => e.toLowerCase()))];
    if (es.length)
      await tx.reportScheduleRecipient.createMany({
        data: es.map((email) => ({ businessId, scheduleId, email })),
      });
  }

  /** A schedule's one-line words. */
  describe(s: ScheduleShape): string {
    return describeSchedule({
      frequency: s.frequency,
      weekday: s.weekday,
      dayOfMonth: s.dayOfMonth,
      monthOfYear: s.monthOfYear,
      runTime: hhmm(s.runTime),
    });
  }

  isUnique(e: unknown): boolean {
    return isUniqueViolation(e);
  }
}
