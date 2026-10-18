import { randomUUID } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Database, TxClient } from '@firmivra/db';
import type { DownloadLink, ReportRunStatusView } from '@firmivra/types';
import type { z } from 'zod';
import { AuditService } from '../audit/audit.service.js';
import type { TenantContext } from '../common/request-context.js';
import { DATABASE } from '../database/database.module.js';
import { notFound } from '../workspaces/common.js';
import type { Computed } from './engine.js';
import { REPORT_FILES, type ReportFiles } from './report-files.js';
import { canExport, isAdmin, reportErrors, safeFileName } from './reports.common.js';
import type { ExportBody } from './reports-input.js';
import { type Ctx, ReportsService } from './reports.service.js';

type Export = z.output<typeof ExportBody>;

const GET_URL_SECONDS = 300;
/** A byte order mark, so a spreadsheet opens the file as UTF-8. */
const BOM = String.fromCharCode(0xfeff);
const FORMULA = /^[=+\-@\t\r]/;

/** One CSV cell: quoted, and text that a spreadsheet would run as a formula is made inert. */
function csvCell(value: string | number | boolean | null, type: string): string {
  if (value === null) return '""';
  let s: string;
  if (type === 'MONEY' && typeof value === 'number') s = (value / 100).toFixed(2);
  else s = String(value);
  if (typeof value === 'string' && FORMULA.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
}

export function toCsv(computed: Pick<Computed, 'columns' | 'all' | 'totals'>): Buffer {
  const header = computed.columns.map((c) => csvCell(c.label, 'TEXT')).join(',');
  const lines = computed.all.map((r) =>
    computed.columns.map((c) => csvCell(r.cells[c.key] ?? null, c.type)).join(','),
  );
  if (computed.totals) {
    const totals = computed.columns.map((c, i) =>
      c.key in computed.totals!
        ? csvCell(computed.totals![c.key]!, c.type)
        : i === 0
          ? csvCell('Total', 'TEXT')
          : '""',
    );
    lines.push(totals.join(','));
  }
  // A byte order mark so a spreadsheet opens it as UTF-8.
  return Buffer.from(`${BOM}${[header, ...lines].join('\r\n')}\r\n`, 'utf8');
}

/**
 * Exports of a report: the same definition, filters and permissions as the screen, made into a
 * file under the firm's own prefix and reached by a short-lived link. CSV is the format built
 * (PDF and Excel answer 400 until they are). An export is a run (`report_runs`, kind EXPORT) that
 * starts QUEUED and finishes once; only the person who asked (or an Owner or Admin) reads it. An
 * export of client or financial data is marked sensitive and audited. The file name is the report
 * name and range, never data.
 */
@Injectable()
export class ReportsExportService {
  private readonly logger = new Logger(ReportsExportService.name);

  constructor(
    @Inject(DATABASE) private readonly database: Database,
    @Inject(REPORT_FILES) private readonly files: ReportFiles,
    private readonly audit: AuditService,
    private readonly reports: ReportsService,
  ) {}

  private inFirm<T>(businessId: string, fn: (tx: TxClient) => Promise<T>): Promise<T> {
    return this.database.withScope({ kind: 'business', businessId }, fn);
  }

  async create(
    businessId: string,
    tenant: TenantContext,
    userId: string,
    body: Export,
  ): Promise<ReportRunStatusView> {
    if (!canExport(tenant)) throw reportErrors.exportNotAllowed();
    if (body.format !== 'CSV')
      throw reportErrors.invalid(
        'format',
        'Only CSV is available for now. PDF and Excel are coming.',
      );
    return this.generate(businessId, tenant, userId, body.run, body.hiddenColumns, {
      kind: 'EXPORT',
      scheduleId: null,
    });
  }

  /** Makes the file for a run request (an export, or a scheduled run) and records the run. */
  async generate(
    businessId: string,
    tenant: TenantContext,
    userId: string,
    run: Export['run'],
    hiddenColumns: string[] | undefined,
    as: { kind: 'EXPORT' | 'SCHEDULED'; scheduleId: string | null },
  ): Promise<ReportRunStatusView> {
    const prepared = await this.inFirm(businessId, async (tx) => {
      const ctx: Ctx = await this.reports.ctx(tx, businessId, tenant, userId);
      const resolved = await this.reports.resolve(ctx, run.target);
      if (!resolved.definitionId && !resolved.systemKey) {
        throw reportErrors.invalid('target', 'Save the report before exporting it');
      }
      const out = await this.reports.execute(ctx, resolved, {
        ...run,
        page: 1,
        pageSize: 100,
        preview: false,
        ...(hiddenColumns ? { hiddenColumns } : {}),
      } as never);
      const row = await tx.reportRun.create({
        data: {
          businessId,
          definitionId: resolved.definitionId,
          systemKey: resolved.systemKey,
          scheduleId: as.scheduleId,
          kind: as.kind,
          status: 'QUEUED',
          requestedByUserId: userId,
          format: 'CSV',
          rangeFrom: new Date(`${out.range.from}T00:00:00.000Z`),
          rangeTo: new Date(`${out.range.to}T00:00:00.000Z`),
          definitionSnapshot: {
            title: resolved.title,
            category: resolved.category,
            source: resolved.source.key,
            definition: out.result.definition,
            fileName: safeFileName(resolved.title, out.range.from, out.range.to, 'csv'),
          } as never,
          // Client and financial data: every source here has some.
          sensitive: true,
        },
        select: { id: true },
      });
      return {
        runId: row.id,
        computed: out.computed,
        range: out.range,
        title: resolved.title,
        source: resolved.source.key,
        category: resolved.category,
      };
    });

    const key = `tenant/${businessId}/reports/${randomUUID()}.csv`;
    try {
      await this.files.put(key, toCsv(prepared.computed), 'text/csv; charset=utf-8');
    } catch (error) {
      this.logger.warn(
        `Report file could not be stored for firm ${businessId}: ${(error as Error).name}`,
      );
      await this.inFirm(businessId, (tx) =>
        tx.reportRun.update({
          where: { id: prepared.runId },
          data: { status: 'FAILED', errorCode: 'storage_failed', finishedAt: new Date() },
        }),
      );
      throw reportErrors.runNotReady();
    }
    await this.inFirm(businessId, async (tx) => {
      await tx.reportRun.update({
        where: { id: prepared.runId },
        data: {
          status: 'SUCCEEDED',
          s3Key: key,
          rowCount: prepared.computed.total,
          startedAt: new Date(),
          finishedAt: new Date(),
        },
      });
      await this.audit.logIn(
        tx,
        as.kind === 'EXPORT' ? 'report.exported' : 'report.scheduled_run',
        { type: 'report_run', id: prepared.runId },
        {
          format: 'CSV',
          source: prepared.source,
          category: prepared.category,
          rows: prepared.computed.total,
          sensitive: true,
        },
        { businessId, actorUserId: userId },
      );
    });
    return this.status(businessId, tenant, userId, prepared.runId);
  }

  async status(
    businessId: string,
    tenant: TenantContext,
    userId: string,
    runId: string,
  ): Promise<ReportRunStatusView> {
    return this.inFirm(businessId, async (tx) => {
      const r = await tx.reportRun.findFirst({ where: { businessId, id: runId } });
      if (!r || (r.requestedByUserId !== userId && !isAdmin(tenant))) throw notFound();
      const snap = (r.definitionSnapshot ?? {}) as { fileName?: string };
      return {
        runId: r.id,
        kind: r.kind,
        status: r.status,
        format: r.format,
        rowCount: r.rowCount,
        errorCode: r.errorCode,
        fileName: snap.fileName ?? null,
        ready: r.status === 'SUCCEEDED' && r.s3Key !== null,
        createdAt: r.createdAt.toISOString(),
        finishedAt: r.finishedAt?.toISOString() ?? null,
      };
    });
  }

  async download(
    businessId: string,
    tenant: TenantContext,
    userId: string,
    runId: string,
  ): Promise<DownloadLink> {
    const run = await this.inFirm(businessId, async (tx) => {
      const r = await tx.reportRun.findFirst({ where: { businessId, id: runId } });
      if (!r || (r.requestedByUserId !== userId && !isAdmin(tenant))) throw notFound();
      return r;
    });
    if (run.status !== 'SUCCEEDED' || !run.s3Key) throw reportErrors.runNotReady();
    if (!canExport(tenant) && run.kind === 'EXPORT') throw reportErrors.exportNotAllowed();
    const snap = (run.definitionSnapshot ?? {}) as { fileName?: string };
    const url = await this.files.presignDownload({
      key: run.s3Key,
      fileName: snap.fileName ?? 'report.csv',
      contentType: 'text/csv',
    });
    await this.audit.log('report.download_link_issued', { type: 'report_run', id: run.id });
    return { url, expiresAt: new Date(Date.now() + GET_URL_SECONDS * 1000).toISOString() };
  }
}
