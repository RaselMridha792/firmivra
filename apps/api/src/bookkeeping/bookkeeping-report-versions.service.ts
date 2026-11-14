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
  type CsvContext,
  type EnteredFigures,
  enteredProfitAndLoss,
  FIGURE_REPORT_TYPES,
  type FigureLine,
  type FigureReportType,
  figuresCsv,
  reportFigures,
} from './report-figures.js';
import { type FigureContext, statementsMissing } from './report-figures-more.js';
import {
  SUMMARY_REPORT_TYPES,
  type SummaryReportType,
  summaryFigures,
  summaryRange,
} from './report-figures-summary.js';

/**
 * BK-RPT (Octavia's Oct 25 Bookkeeping review): a report's figures from the client's ledger,
 * statements, refunds, settlements and close for its period (part 1: P&L, Trial Balance,
 * Transaction Detail, Uncategorized; part 2: General Ledger, Balance Sheet, Cash Flow,
 * Reconciliation, Bookkeeping Status, Missing Documents): previewed, generated as an immutable numbered version (the database
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
        periodLabel: true,
        period: { select: { id: true, periodStart: true, periodEnd: true, status: true } },
        engagement: { select: { client: { select: { displayName: true } } } },
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
    | {
        figures: BookkeepingReportFigures;
        period: { start: string; end: string };
        /** Accounts a Balance Sheet or Cash Flow has no statement for (generation waits). */
        missing: string[];
      }
    | {
        reason: 'type' | 'period' | 'source' | 'figures';
        period: { start: string; end: string } | null;
      }
  > {
    const period = r.period
      ? { start: isoDay(r.period.periodStart), end: isoDay(r.period.periodEnd) }
      : null;
    if (!(FIGURE_REPORT_TYPES as readonly string[]).includes(r.reportType)) {
      return { reason: 'type', period };
    }
    // Rasel (Nov 10): the Quarterly Review and Year to Date Summary, by their period or label.
    const summary = (SUMMARY_REPORT_TYPES as readonly string[]).includes(r.reportType)
      ? summaryRange(r.reportType as SummaryReportType, period, r.periodLabel, isoDay(new Date()))
      : null;
    const range = summary ?? period;
    if (!range || (!summary && !r.period)) return { reason: 'period', period: null };
    const category = { select: { id: true, name: true, type: true } };
    const during = {
      gte: new Date(`${range.start}T00:00:00.000Z`),
      lte: new Date(`${range.end}T00:00:00.000Z`),
    };
    const scope = { businessId, engagementId: r.engagementId };
    const rows = await tx.bookkeepingTransaction.findMany({
      where: { ...scope, transactionDate: during },
      select: {
        amountCents: true,
        direction: true,
        status: true,
        kind: true,
        receiptDocumentId: true,
        transactionDate: true,
        account: { select: { id: true, name: true, type: true } },
        category,
        splits: { select: { amountCents: true, category } },
        transferPair: { select: { account: { select: { type: true } } } },
      },
    });
    const lines: FigureLine[] = rows.map(
      ({ receiptDocumentId, transferPair, transactionDate, ...l }) => ({
        ...l,
        hasReceipt: receiptDocumentId !== null,
        transferPairAccountType: transferPair?.account.type ?? null,
        on: isoDay(transactionDate),
      }),
    );
    const basis = r.basis === 'ACCRUAL' ? 'ACCRUAL' : 'CASH';
    // Review 2 (RP03): a P&L (and a summary's) comes from the one source staff chose for this
    // client: the ledger (synced from the accounting software) or the figures entered per period.
    const pnl = summary || r.reportType === 'PROFIT_LOSS';
    let entered: EnteredFigures[] | null = null;
    if (pnl) {
      const profile = await tx.bookkeepingProfile.findFirst({
        where: scope,
        select: { pnlSource: true },
      });
      if (!profile?.pnlSource) return { reason: 'source', period: range };
      if (profile.pnlSource === 'MANUAL') {
        const periods = await tx.bookkeepingPeriod.findMany({
          where: {
            ...scope,
            ...(summary
              ? { periodStart: { gte: during.gte }, periodEnd: { lte: during.lte }, kind: 'MONTH' }
              : { id: r.period!.id }),
            incomeCents: { not: null },
            expensesCents: { not: null },
          },
          select: { periodStart: true, incomeCents: true, expensesCents: true },
          orderBy: { periodStart: 'asc' },
        });
        if (!periods.length) return { reason: 'figures', period: range };
        entered = periods.map((p) => ({
          start: isoDay(p.periodStart),
          incomeCents: p.incomeCents!,
          expensesCents: p.expensesCents!,
        }));
      }
    }
    if (summary) {
      return {
        figures: summaryFigures(
          r.reportType as SummaryReportType,
          summary,
          entered
            ? enteredProfitAndLoss(r.basis, entered)
            : reportFigures('PROFIT_LOSS', basis, lines),
          lines,
          entered
            ? new Map(entered.map((p) => [p.start.slice(0, 7), p.incomeCents - p.expensesCents]))
            : undefined,
        ),
        period: summary,
        missing: [],
      };
    }
    if (entered) {
      return { figures: enteredProfitAndLoss(r.basis, entered), period: range, missing: [] };
    }
    const ctx = await this.context(tx, businessId, r.engagementId, r.period!, during);
    const type = r.reportType as FigureReportType;
    return {
      figures: reportFigures(type, basis, lines, ctx),
      period: range,
      missing: statementsMissing(type, ctx).map((a) => a.name),
    };
  }

  /** The period's statements, refunds, settlements and close, for the part-2 reports. */
  private async context(
    tx: TxClient,
    businessId: string,
    engagementId: string,
    period: { id: string; status: string },
    during: { gte: Date; lte: Date },
  ): Promise<FigureContext> {
    const scope = { businessId, engagementId };
    const account = { select: { id: true, name: true, type: true, reconcile: true } };
    const [accounts, recs, refunds, settlements, steps] = await Promise.all([
      tx.bookkeepingAccount.findMany({ where: { ...scope, archivedAt: null }, ...account }),
      tx.bookkeepingReconciliation.findMany({
        where: { businessId, periodId: period.id },
        select: {
          account,
          beginningBalanceCents: true,
          endingBalanceCents: true,
          clearedBalanceCents: true,
          clearedCount: true,
          differenceCents: true,
          exceptionsCount: true,
          status: true,
          statementDocumentId: true,
        },
      }),
      tx.bookkeepingRefund.findMany({
        where: { ...scope, refundDate: during, includeInReport: true },
        select: { kind: true, status: true, amountCents: true, reason: true },
      }),
      tx.bookkeepingSettlement.findMany({
        where: { ...scope, payoutDate: during },
        select: {
          processor: true,
          payoutDate: true,
          grossCents: true,
          refundsCents: true,
          chargebacksCents: true,
          feesCents: true,
          adjustmentsCents: true,
          netPayoutCents: true,
          status: true,
        },
      }),
      tx.bookkeepingCloseItem.findMany({
        where: { businessId, periodId: period.id },
        select: { completedAt: true },
      }),
    ]);
    return {
      accounts,
      reconciliations: recs.map(({ statementDocumentId, ...x }) => ({
        ...x,
        hasStatement: statementDocumentId !== null,
      })),
      refunds,
      settlements: settlements.map(({ payoutDate, ...s }) => ({
        ...s,
        payoutOn: isoDay(payoutDate),
      })),
      period: {
        status: period.status,
        closeDone: steps.filter((s) => s.completedAt).length,
        closeTotal: steps.length,
      },
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
      return {
        supported: true,
        reason: null,
        period: out.period,
        figures: out.figures,
        missingStatements: out.missing,
      };
    }
    return {
      supported: false,
      reason:
        out.reason === 'type'
          ? 'Figures for custom reports are not worked out yet.'
          : out.reason === 'source'
            ? "Choose where this client's P&L comes from first, in the client's Settings: the connected accounting software (QuickBooks...) or figures entered in Firmivra from what the client provides. The two are never added together."
            : out.reason === 'figures'
              ? "Enter the period's income and expenses first: this client's P&L is made in Firmivra from the figures the client provides, so there is nothing to show yet."
              : 'Set the bookkeeping period this report covers first (a Quarterly Review or Year to Date Summary can say it in its label instead, such as "Q3 2026" or "2026").',
      period: out.period,
      figures: null,
      missingStatements: [],
    };
  }

  private toRow(
    v: {
      version: number;
      generatedAt: Date;
      generatedByUserId: string | null;
      deliveryStatus: 'NOT_SENT' | 'SENT' | 'FAILED';
      sentAt: Date | null;
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
      sentAt: v.sentAt?.toISOString() ?? null,
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
        throw out.reason === 'type'
          ? errors.reportNotSupported()
          : out.reason === 'source'
            ? errors.pnlSourceNotSet()
            : out.reason === 'figures'
              ? errors.pnlFiguresMissing()
              : errors.noPeriod();
      }
      if (out.missing.length) throw errors.statementsMissing(out.missing.join(', '));
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
    let context: CsvContext | undefined;
    const v = await inFirm(this.database, businessId, async (tx) => {
      const r = await this.report(tx, businessId, actor, id);
      // Review 2 (RP03): the file says whose figures they are, for when, on what basis, and where
      // they come from.
      context = {
        client: r.engagement.client.displayName,
        period: r.period
          ? `${isoDay(r.period.periodStart)} to ${isoDay(r.period.periodEnd)}`
          : (r.periodLabel ?? 'Not set'),
        basis: 'Cash',
        source: "This client's Firmivra ledger (synced or entered transactions)",
      };
      const row = await tx.bookkeepingReportVersion.findFirst({
        where: { businessId, reportId: r.id, version },
        select: { summary: true },
      });
      if (!row) throw errors.notFound();
      // Review 2 (RP03): a P&L made from entered figures says so.
      if ((row.summary as { source?: string } | null)?.source === 'MANUAL')
        context.source = 'Income and expenses entered in Firmivra for the period (not the ledger)';
      return row;
    });
    await this.audit.log(
      'bookkeeping.report.downloaded',
      { type: 'bookkeeping_report', id },
      { version },
    );
    return figuresCsv(v.summary as unknown as BookkeepingReportFigures, (c) => csvCell(c), context);
  }
}
