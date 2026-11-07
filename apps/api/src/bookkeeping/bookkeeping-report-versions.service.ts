import { Inject, Injectable } from '@nestjs/common';
import type { Database, Prisma, TxClient } from '@firmivra/db';
import type {
  BookkeepingReportFigures,
  BookkeepingReportPreview,
  BookkeepingReportVersionList,
  BookkeepingReportVersionRow,
} from '@firmivra/types';
import { AuditService } from '../audit/audit.service.js';
import { DATABASE } from '../database/database.module.js';
import { memberNames } from '../workspaces/common.js';
import { type BookkeepingActor, reachEngagement } from './bookkeeping.mappers.js';
import { csvCell, errors, inFirm, isoDay } from './bookkeeping.shared.js';
import {
  FIGURE_REPORT_TYPES,
  type FigureLine,
  type FigureReportType,
  figuresCsv,
  reportFigures,
} from './report-figures.js';

/**
 * BK-RPT part 1 (Octavia's Oct 25 Bookkeeping review): a report's figures from the client's
 * ledger for its period: previewed, generated as an immutable numbered version (the database
 * numbers it and refuses any change), listed, and downloaded as CSV. Everyone with Bookkeeping
 * reaches their clients' reports (Staff: their clients); each generation and download is
 * audited with ids and counts only.
 */
@Injectable()
export class BookkeepingReportVersionsService {
  constructor(
    @Inject(DATABASE) private readonly database: Database,
    private readonly audit: AuditService,
  ) {}

  /** The report in reach, with its period (404 otherwise). */
  private async report(tx: TxClient, businessId: string, actor: BookkeepingActor, id: string) {
    const r = await tx.bookkeepingReport.findFirst({
      where: { businessId, id, engagement: reachEngagement(actor) },
      select: {
        id: true,
        engagementId: true,
        reportType: true,
        basis: true,
        period: { select: { periodStart: true, periodEnd: true } },
      },
    });
    if (!r) throw errors.notFound();
    return r;
  }

  /** The figures for the report's type and period, or why there are none. */
  private async figures(
    tx: TxClient,
    businessId: string,
    r: Awaited<ReturnType<BookkeepingReportVersionsService['report']>>,
  ): Promise<
    | { figures: BookkeepingReportFigures; period: { start: string; end: string } }
    | { reason: 'type' | 'period'; period: { start: string; end: string } | null }
  > {
    const period = r.period
      ? { start: isoDay(r.period.periodStart), end: isoDay(r.period.periodEnd) }
      : null;
    if (!(FIGURE_REPORT_TYPES as readonly string[]).includes(r.reportType)) {
      return { reason: 'type', period };
    }
    if (!period || !r.period) return { reason: 'period', period: null };
    const category = { select: { id: true, name: true, type: true } };
    const rows = await tx.bookkeepingTransaction.findMany({
      where: {
        businessId,
        engagementId: r.engagementId,
        transactionDate: { gte: r.period.periodStart, lte: r.period.periodEnd },
      },
      select: {
        amountCents: true,
        direction: true,
        status: true,
        kind: true,
        account: { select: { id: true, name: true } },
        category,
        splits: { select: { amountCents: true, category } },
      },
    });
    const lines: FigureLine[] = rows;
    return {
      figures: reportFigures(
        r.reportType as FigureReportType,
        r.basis === 'ACCRUAL' ? 'ACCRUAL' : 'CASH',
        lines,
      ),
      period,
    };
  }

  async preview(
    businessId: string,
    actor: BookkeepingActor,
    id: string,
  ): Promise<BookkeepingReportPreview> {
    const out = await inFirm(this.database, businessId, async (tx) =>
      this.figures(tx, businessId, await this.report(tx, businessId, actor, id)),
    );
    if ('figures' in out) {
      return { supported: true, reason: null, period: out.period, figures: out.figures };
    }
    return {
      supported: false,
      reason:
        out.reason === 'type'
          ? 'Figures for this report type are not worked out yet: Profit & Loss, Trial Balance, Transaction Detail and Uncategorized are.'
          : 'Set the bookkeeping period this report covers first.',
      period: out.period,
      figures: null,
    };
  }

  private toRow(
    v: {
      version: number;
      generatedAt: Date;
      generatedByUserId: string | null;
      deliveryStatus: 'NOT_SENT' | 'SENT' | 'FAILED';
      parameters: Prisma.JsonValue;
      summary: Prisma.JsonValue;
    },
    names: Map<string, string>,
  ): BookkeepingReportVersionRow {
    const p = v.parameters as { periodStart: string; periodEnd: string };
    return {
      version: v.version,
      generatedAt: v.generatedAt.toISOString(),
      generatedBy: v.generatedByUserId ? (names.get(v.generatedByUserId) ?? null) : null,
      deliveryStatus: v.deliveryStatus,
      period: { start: p.periodStart, end: p.periodEnd },
      figures: v.summary as unknown as BookkeepingReportFigures,
    };
  }

  /** A new immutable version of the figures (409 REPORT_NOT_SUPPORTED, NO_PERIOD). */
  async generate(
    businessId: string,
    actor: BookkeepingActor,
    id: string,
  ): Promise<BookkeepingReportVersionRow> {
    return inFirm(this.database, businessId, async (tx) => {
      const r = await this.report(tx, businessId, actor, id);
      const out = await this.figures(tx, businessId, r);
      if (!('figures' in out)) {
        throw out.reason === 'type' ? errors.reportNotSupported() : errors.noPeriod();
      }
      const made = await tx.bookkeepingReportVersion.create({
        data: {
          businessId,
          engagementId: r.engagementId,
          reportId: r.id,
          // The database numbers it.
          version: 0,
          parameters: {
            type: out.figures.type,
            periodStart: out.period.start,
            periodEnd: out.period.end,
            basis: r.basis ?? 'CASH',
          },
          summary: out.figures as unknown as Prisma.InputJsonValue,
          generatedByUserId: actor.userId,
        },
      });
      await tx.bookkeepingReport.update({
        where: { businessId_id: { businessId, id: r.id } },
        data: { generatedAt: made.generatedAt, generatedByUserId: actor.userId },
      });
      await this.audit.logIn(
        tx,
        'bookkeeping.report.generated',
        { type: 'bookkeeping_report', id: r.id },
        { version: made.version, lines: out.figures.lineCount },
      );
      return this.toRow(made, await memberNames(tx, businessId, [actor.userId]));
    });
  }

  async versions(
    businessId: string,
    actor: BookkeepingActor,
    id: string,
  ): Promise<BookkeepingReportVersionList> {
    return inFirm(this.database, businessId, async (tx) => {
      const r = await this.report(tx, businessId, actor, id);
      const rows = await tx.bookkeepingReportVersion.findMany({
        where: { businessId, reportId: r.id },
        orderBy: { version: 'desc' },
        take: 50,
      });
      const names = await memberNames(
        tx,
        businessId,
        rows.map((v) => v.generatedByUserId),
      );
      return { items: rows.map((v) => this.toRow(v, names)) };
    });
  }

  /** One version as CSV (its stored figures: a version never changes). */
  async versionCsv(
    businessId: string,
    actor: BookkeepingActor,
    id: string,
    version: number,
  ): Promise<string> {
    const v = await inFirm(this.database, businessId, async (tx) => {
      const r = await this.report(tx, businessId, actor, id);
      const row = await tx.bookkeepingReportVersion.findFirst({
        where: { businessId, reportId: r.id, version },
        select: { summary: true },
      });
      if (!row) throw errors.notFound();
      return row;
    });
    await this.audit.log(
      'bookkeeping.report.downloaded',
      { type: 'bookkeeping_report', id },
      { version },
    );
    return figuresCsv(v.summary as unknown as BookkeepingReportFigures, (c) => csvCell(c));
  }
}
