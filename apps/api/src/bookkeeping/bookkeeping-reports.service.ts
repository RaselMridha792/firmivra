import { Inject, Injectable } from '@nestjs/common';
import type { Database, Prisma, TxClient } from '@firmivra/db';
import type {
  AddBookkeepingReportRequest,
  BookkeepingReportPage,
  BookkeepingReportRow,
  BookkeepingReportsQuery,
  DeliverBookkeepingReportRequest,
  UpdateBookkeepingReportRequest,
} from '@firmivra/types';
import type { z } from 'zod';
import { AuditService } from '../audit/audit.service.js';
import { DATABASE } from '../database/database.module.js';
import { isUniqueViolation, memberNames } from '../workspaces/common.js';
import {
  addActivity,
  type BookkeepingActor,
  findProfile,
  lockProfile,
  lockProfileOf,
  reachEngagement,
  reportMemberIds,
  reportSelect,
  skipTake,
  toReport,
} from './bookkeeping.mappers.js';
import {
  addDays,
  csvRow,
  errors,
  inFirm,
  isoDay,
  mapBookkeepingDbError,
  REPORT_NAMES,
  toDay,
} from './bookkeeping.shared.js';
import { BookkeepingStatusService, readSettings } from './bookkeeping-status.service.js';

type ReportsQuery = z.output<typeof BookkeepingReportsQuery>;

const EXPORT_LIMIT = 5_000;

/**
 * The preparation, review and delivery of each client's bookkeeping reports. This module holds
 * the work around a report (due date, who prepared, reviewed and delivered it, and when); the
 * report the client reads is the shared module's published engagement report, linked on delivery.
 * Delivered reports are frozen (the database refuses any change).
 */
@Injectable()
export class BookkeepingReportsService {
  constructor(
    @Inject(DATABASE) private readonly database: Database,
    private readonly audit: AuditService,
    private readonly status: BookkeepingStatusService,
  ) {}

  private where(
    businessId: string,
    actor: BookkeepingActor,
    q: ReportsQuery,
    today: string,
    upcomingDays: number,
    engagementId?: string,
  ): Prisma.BookkeepingReportWhereInput {
    const and: Prisma.BookkeepingReportWhereInput[] = [
      { businessId },
      {
        engagement: {
          AND: [reachEngagement(actor), { bookkeepingProfile: { is: { archivedAt: null } } }],
        },
      },
    ];
    if (engagementId) and.push({ engagementId });
    if (q.status) and.push({ status: q.status });
    if (q.reportType) and.push({ reportType: q.reportType });
    if (q.bookkeepingClientId) {
      and.push({ engagement: { bookkeepingProfile: { is: { id: q.bookkeepingClientId } } } });
    }
    if (q.periodId) and.push({ periodId: q.periodId });
    if (q.dueFrom) and.push({ dueOn: { gte: toDay(q.dueFrom) } });
    if (q.dueTo) and.push({ dueOn: { lte: toDay(q.dueTo) } });
    if (q.upcoming === 'true') {
      and.push({
        status: { not: 'DELIVERED' },
        dueOn: { gte: toDay(today), lte: addDays(toDay(today), upcomingDays) },
      });
    }
    if (q.overdue === 'true')
      and.push({ status: { not: 'DELIVERED' }, dueOn: { lt: toDay(today) } });
    if (q.search) {
      and.push({
        OR: [
          { customName: { contains: q.search, mode: 'insensitive' } },
          { periodLabel: { contains: q.search, mode: 'insensitive' } },
          { engagement: { client: { displayName: { contains: q.search, mode: 'insensitive' } } } },
        ],
      });
    }
    return { AND: and };
  }

  private async page(
    businessId: string,
    actor: BookkeepingActor,
    q: ReportsQuery,
    clientId?: string,
  ): Promise<BookkeepingReportPage> {
    const today = isoDay(new Date());
    const { rows, total, names } = await inFirm(this.database, businessId, async (tx) => {
      const settings = await readSettings(tx, businessId);
      const engagementId = clientId
        ? (await findProfile(tx, businessId, actor, clientId)).engagementId
        : undefined;
      const where = this.where(
        businessId,
        actor,
        q,
        today,
        settings.upcomingReportDays,
        engagementId,
      );
      const [rows, total] = await Promise.all([
        tx.bookkeepingReport.findMany({
          where,
          select: reportSelect,
          orderBy: [{ dueOn: { sort: 'asc', nulls: 'last' } }, { id: 'asc' }],
          ...skipTake(q),
        }),
        tx.bookkeepingReport.count({ where }),
      ]);
      const names = await memberNames(tx, businessId, reportMemberIds(rows));
      return { rows, total, names };
    });
    await this.audit.log(
      'bookkeeping.reports.listed',
      {
        type: clientId ? 'bookkeeping_client' : 'bookkeeping',
        ...(clientId ? { id: clientId } : {}),
      },
      { count: rows.length },
    );
    return {
      items: rows.map((r) => toReport(r, names, today)),
      total,
      page: q.page,
      pageSize: q.pageSize,
    };
  }

  list(businessId: string, actor: BookkeepingActor, q: ReportsQuery) {
    return this.page(businessId, actor, q);
  }

  listForClient(businessId: string, actor: BookkeepingActor, clientId: string, q: ReportsQuery) {
    return this.page(businessId, actor, q, clientId);
  }

  /** The list's filters as a CSV (needs the grid's EXPORT). */
  async exportCsv(businessId: string, actor: BookkeepingActor, q: ReportsQuery): Promise<string> {
    const today = isoDay(new Date());
    const { rows, names } = await inFirm(this.database, businessId, async (tx) => {
      const settings = await readSettings(tx, businessId);
      const rows = await tx.bookkeepingReport.findMany({
        where: this.where(businessId, actor, q, today, settings.upcomingReportDays),
        select: reportSelect,
        orderBy: [{ dueOn: { sort: 'asc', nulls: 'last' } }, { id: 'asc' }],
        take: EXPORT_LIMIT,
      });
      return { rows, names: await memberNames(tx, businessId, reportMemberIds(rows)) };
    });
    const lines = [
      csvRow(['Client', 'Report', 'Period', 'Basis', 'Due', 'Status', 'Overdue', 'Delivered']),
    ];
    for (const r of rows) {
      const row = toReport(r, names, today);
      lines.push(
        csvRow([
          row.client.displayName,
          row.name,
          row.periodLabel,
          row.basis,
          row.dueOn,
          row.status,
          row.overdue ? 'Yes' : 'No',
          row.deliveredAt,
        ]),
      );
    }
    await this.audit.log(
      'bookkeeping.reports.exported',
      { type: 'bookkeeping' },
      { count: rows.length },
    );
    return `${lines.join('\r\n')}\r\n`;
  }

  private async find(tx: TxClient, businessId: string, actor: BookkeepingActor, id: string) {
    const row = await tx.bookkeepingReport.findFirst({
      where: { businessId, id, engagement: reachEngagement(actor) },
      select: reportSelect,
    });
    if (!row) throw errors.notFound();
    return row;
  }

  private async view(tx: TxClient, businessId: string, id: string): Promise<BookkeepingReportRow> {
    const row = await tx.bookkeepingReport.findFirstOrThrow({
      where: { businessId, id },
      select: reportSelect,
    });
    return toReport(
      row,
      await memberNames(tx, businessId, reportMemberIds([row])),
      isoDay(new Date()),
    );
  }

  async get(
    businessId: string,
    actor: BookkeepingActor,
    id: string,
  ): Promise<BookkeepingReportRow> {
    const row = await inFirm(this.database, businessId, async (tx) => {
      await this.find(tx, businessId, actor, id);
      return this.view(tx, businessId, id);
    });
    await this.audit.log('bookkeeping.report.viewed', { type: 'bookkeeping_report', id });
    return row;
  }

  async add(
    businessId: string,
    actor: BookkeepingActor,
    clientId: string,
    body: z.output<typeof AddBookkeepingReportRequest>,
  ): Promise<BookkeepingReportRow> {
    return inFirm(this.database, businessId, async (tx) => {
      const p = await lockProfile(tx, businessId, actor, clientId);
      if (body.periodId) {
        const period = await tx.bookkeepingPeriod.findFirst({
          where: { businessId, id: body.periodId, engagementId: p.engagementId },
          select: { id: true },
        });
        if (!period) throw errors.notThisClients('period');
      }
      let created;
      try {
        created = await tx.bookkeepingReport.create({
          data: {
            businessId,
            engagementId: p.engagementId,
            periodId: body.periodId ?? null,
            reportType: body.reportType,
            customName: body.reportType === 'CUSTOM' ? (body.customName ?? null) : null,
            periodLabel: body.periodLabel,
            basis: body.basis ?? null,
            dueOn: body.dueOn ? toDay(body.dueOn) : null,
          },
          select: { id: true },
        });
      } catch (e) {
        if (isUniqueViolation(e))
          throw errors.duplicate('This report already exists for the client and period');
        return mapBookkeepingDbError(e);
      }
      await addActivity(
        tx,
        businessId,
        p.engagementId,
        actor.userId,
        'REPORT',
        `${body.customName ?? REPORT_NAMES[body.reportType]} added for ${body.periodLabel}`,
        { reportId: created.id },
      );
      await this.status.refresh(tx, businessId, p.engagementId, actor.userId);
      await this.audit.logIn(
        tx,
        'bookkeeping.report.added',
        { type: 'bookkeeping_report', id: created.id },
        { clientId: p.engagement.clientId, reportType: body.reportType },
      );
      return this.view(tx, businessId, created.id);
    });
  }

  /** Runs `change` on the report, locked with its client; the status and next report date follow. */
  private async act(
    businessId: string,
    actor: BookkeepingActor,
    id: string,
    action: string,
    change: (
      tx: TxClient,
      r: Awaited<ReturnType<BookkeepingReportsService['find']>>,
      engagementId: string,
    ) => Promise<Prisma.BookkeepingReportUncheckedUpdateInput>,
    summary?: (name: string, periodLabel: string) => string,
  ): Promise<BookkeepingReportRow> {
    return inFirm(this.database, businessId, async (tx) => {
      const found = await this.find(tx, businessId, actor, id);
      const profile = await lockProfileOf(tx, businessId, actor, found.engagementId);
      const r = await this.find(tx, businessId, actor, id);
      if (r.status === 'DELIVERED') throw errors.reportState('A delivered report is frozen');
      const data = await change(tx, r, r.engagementId);
      try {
        await tx.bookkeepingReport.update({ where: { businessId_id: { businessId, id } }, data });
      } catch (e) {
        if (isUniqueViolation(e))
          throw errors.duplicate('That client report is already linked to another report');
        return mapBookkeepingDbError(e);
      }
      if (summary) {
        await addActivity(
          tx,
          businessId,
          profile.engagementId,
          actor.userId,
          'REPORT',
          summary(r.customName ?? REPORT_NAMES[r.reportType], r.periodLabel),
          { reportId: id },
        );
      }
      await this.status.followChange(tx, businessId, actor.userId, profile);
      await this.audit.logIn(
        tx,
        `bookkeeping.report.${action}`,
        { type: 'bookkeeping_report', id },
        { clientId: profile.engagement.clientId },
      );
      return this.view(tx, businessId, id);
    });
  }

  update(
    businessId: string,
    actor: BookkeepingActor,
    id: string,
    body: z.output<typeof UpdateBookkeepingReportRequest>,
  ) {
    return this.act(businessId, actor, id, 'updated', async () => {
      const data: Prisma.BookkeepingReportUncheckedUpdateInput = {};
      if (body.dueOn !== undefined) data.dueOn = body.dueOn ? toDay(body.dueOn) : null;
      if (body.basis !== undefined) data.basis = body.basis;
      if (body.reviewNote !== undefined) data.reviewNote = body.reviewNote;
      return data;
    });
  }

  start(businessId: string, actor: BookkeepingActor, id: string) {
    return this.act(
      businessId,
      actor,
      id,
      'started',
      async (_tx, r) => {
        if (r.status !== 'NOT_STARTED') throw errors.reportState('The report is already under way');
        return { status: 'IN_PROGRESS', generatedAt: new Date(), generatedByUserId: actor.userId };
      },
      (n, l) => `${n} for ${l} started`,
    );
  }

  submitForReview(businessId: string, actor: BookkeepingActor, id: string) {
    return this.act(
      businessId,
      actor,
      id,
      'submitted',
      async (_tx, r) => {
        if (r.status !== 'IN_PROGRESS')
          throw errors.reportState('Only a report in progress can be sent for review');
        return { status: 'IN_REVIEW' };
      },
      (n, l) => `${n} for ${l} sent for review`,
    );
  }

  sendBack(
    businessId: string,
    actor: BookkeepingActor,
    id: string,
    note: string | null | undefined,
  ) {
    return this.act(
      businessId,
      actor,
      id,
      'sent_back',
      async (_tx, r) => {
        if (r.status !== 'IN_REVIEW' && r.status !== 'APPROVED') {
          throw errors.reportState('Only a report in review or approved can be sent back');
        }
        return { status: 'IN_PROGRESS', ...(note !== undefined ? { reviewNote: note } : {}) };
      },
      (n, l) => `${n} for ${l} sent back for changes`,
    );
  }

  approve(businessId: string, actor: BookkeepingActor, id: string) {
    return this.act(
      businessId,
      actor,
      id,
      'approved',
      async (_tx, r) => {
        if (r.status !== 'IN_REVIEW')
          throw errors.reportState('The report is not waiting for review');
        return { status: 'APPROVED', reviewedAt: new Date(), reviewedByUserId: actor.userId };
      },
      (n, l) => `${n} for ${l} approved`,
    );
  }

  /** Mark Report Complete: the approved report is delivered, linked to the client's published report. */
  deliver(
    businessId: string,
    actor: BookkeepingActor,
    id: string,
    body: z.output<typeof DeliverBookkeepingReportRequest>,
  ) {
    return this.act(
      businessId,
      actor,
      id,
      'delivered',
      async (tx, r, engagementId) => {
        if (r.status !== 'APPROVED')
          throw errors.reportState('Only an approved report can be delivered');
        const published = await tx.engagementReport.findFirst({
          where: { businessId, id: body.engagementReportId, engagementId },
          select: { status: true },
        });
        if (!published) throw errors.notThisClients('report');
        if (published.status !== 'PUBLISHED') throw errors.reportNotPublished();
        return {
          status: 'DELIVERED',
          deliveredAt: new Date(),
          deliveredByUserId: actor.userId,
          engagementReportId: body.engagementReportId,
        };
      },
      (n, l) => `${n} for ${l} delivered`,
    );
  }
}
