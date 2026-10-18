import { Inject, Injectable } from '@nestjs/common';
import type { Database, Prisma } from '@firmivra/db';
import {
  PAYROLL_YEAR_END_STEPS,
  type AddPayrollReportRequest,
  type PayrollFilingList,
  type PayrollFilingsQuery,
  type PayrollReport,
  type PayrollReportList,
  type PayrollReportsQuery,
  type PayrollYearEnd,
  type PayrollYearEndQuery,
  type PayrollYearEndStepState,
  type SavePayrollYearEndRequest,
} from '@firmivra/types';
import type { z } from 'zod';
import { AuditService } from '../audit/audit.service.js';
import { DATABASE } from '../database/database.module.js';
import { isUniqueViolation, memberNames } from '../workspaces/common.js';
import {
  findPayrollClient,
  iso,
  memberRefOf,
  type PayrollActor,
  skipTake,
} from './payroll.mappers.js';
import { day, errors, inFirm, mapPayrollDbError, toDay } from './payroll.shared.js';

type ReportRow = Prisma.PayrollReportGetPayload<object>;

const toReport = (r: ReportRow, names: Map<string, string>): PayrollReport => ({
  id: r.id,
  kind: r.kind,
  runId: r.runId,
  periodStart: day(r.periodStart) as string,
  periodEnd: day(r.periodEnd) as string,
  version: r.version,
  documentId: r.documentId,
  source: r.source === 'provider' ? 'provider' : 'import',
  pulledAt: r.pulledAt.toISOString(),
  requestedBy: memberRefOf(names, r.requestedByUserId),
});

const STATES = new Set<PayrollYearEndStepState>(['NOT_STARTED', 'IN_PROGRESS', 'DONE']);

/** The stored `items` map as the ordered checklist; steps never saved are NOT_STARTED. */
function checklist(items: unknown) {
  const stored = (items && typeof items === 'object' ? items : {}) as Record<string, unknown>;
  return PAYROLL_YEAR_END_STEPS.map((step) => ({
    step,
    state: STATES.has(stored[step] as PayrollYearEndStepState)
      ? (stored[step] as PayrollYearEndStepState)
      : ('NOT_STARTED' as const),
  }));
}

/**
 * Filing visibility, the payroll report library and the year-end checklist of a payroll client.
 * Filings are read-only here: they show only what the provider or an import confirmed (the
 * database refuses FILED or PAID without it), and nothing is inferred from a Firmivra task.
 */
@Injectable()
export class PayrollRecordsService {
  constructor(
    @Inject(DATABASE) private readonly database: Database,
    private readonly audit: AuditService,
  ) {}

  async filings(
    businessId: string,
    actor: PayrollActor,
    id: string,
    q: z.output<typeof PayrollFilingsQuery>,
  ): Promise<PayrollFilingList> {
    const rows = await inFirm(this.database, businessId, async (tx) => {
      await findPayrollClient(tx, businessId, actor, id);
      return tx.payrollFiling.findMany({
        where: {
          businessId,
          payrollClientId: id,
          ...(q.status ? { status: q.status } : {}),
          ...(q.year
            ? { periodEnd: { gte: toDay(`${q.year}-01-01`), lte: toDay(`${q.year}-12-31`) } }
            : {}),
        },
        orderBy: [{ dueOn: { sort: 'asc', nulls: 'last' } }, { id: 'asc' }],
        take: 500,
      });
    });
    await this.audit.log(
      'payroll.filings.listed',
      { type: 'payroll_client', id },
      { count: rows.length },
    );
    return {
      items: rows.map((f) => ({
        id: f.id,
        form: f.form,
        jurisdiction: f.jurisdiction,
        periodStart: day(f.periodStart) as string,
        periodEnd: day(f.periodEnd) as string,
        dueOn: day(f.dueOn),
        status: f.status,
        paymentStatus: f.paymentStatus,
        confirmationRef: f.confirmationRef,
        source: f.source === 'provider' ? 'provider' : f.source === 'import' ? 'import' : null,
        sourceSyncedAt: iso(f.sourceSyncedAt),
        confirmedAt: iso(f.confirmedAt),
      })),
      counts: {
        upcoming: rows.filter((f) => f.status === 'UPCOMING' || f.status === 'IN_PROGRESS').length,
        filed: rows.filter((f) => f.status === 'FILED' || f.status === 'PAID').length,
        needsAttention: rows.filter((f) => f.status === 'NEEDS_ATTENTION' || f.status === 'FAILED')
          .length,
      },
    };
  }

  async reports(
    businessId: string,
    actor: PayrollActor,
    id: string,
    q: z.output<typeof PayrollReportsQuery>,
  ): Promise<PayrollReportList> {
    const { rows, total, names } = await inFirm(this.database, businessId, async (tx) => {
      await findPayrollClient(tx, businessId, actor, id);
      const where: Prisma.PayrollReportWhereInput = {
        businessId,
        payrollClientId: id,
        ...(q.kind ? { kind: q.kind } : {}),
        ...(q.runId ? { runId: q.runId } : {}),
      };
      const [rows, total] = await Promise.all([
        tx.payrollReport.findMany({
          where,
          orderBy: [{ pulledAt: 'desc' }, { id: 'desc' }],
          ...skipTake(q),
        }),
        tx.payrollReport.count({ where }),
      ]);
      return {
        rows,
        total,
        names: await memberNames(
          tx,
          businessId,
          rows.map((r) => r.requestedByUserId),
        ),
      };
    });
    await this.audit.log(
      'payroll.reports.listed',
      { type: 'payroll_client', id },
      { count: rows.length },
    );
    return {
      items: rows.map((r) => toReport(r, names)),
      total,
      page: q.page,
      pageSize: q.pageSize,
    };
  }

  /** Adds a provider report (a vault document) to the library as the next version of its kind and period. */
  async addReport(
    businessId: string,
    actor: PayrollActor,
    id: string,
    body: z.output<typeof AddPayrollReportRequest>,
  ): Promise<PayrollReport> {
    return inFirm(this.database, businessId, async (tx) => {
      const pc = await findPayrollClient(tx, businessId, actor, id);
      if (pc.status === 'ARCHIVED') throw errors.clientState('This payroll client is archived');
      const document = await tx.document.findFirst({
        where: { businessId, id: body.documentId, clientId: pc.clientId },
        select: { id: true },
      });
      if (!document) throw errors.notThisClients('document');
      if (body.runId) {
        const run = await tx.payrollRun.findFirst({
          where: { businessId, id: body.runId, payrollClientId: id },
          select: { id: true },
        });
        if (!run) throw errors.notThisClients('run');
      }
      const same = {
        payrollClientId: id,
        kind: body.kind,
        periodStart: toDay(body.periodStart),
        periodEnd: toDay(body.periodEnd),
      };
      const last = await tx.payrollReport.aggregate({
        where: { businessId, ...same },
        _max: { version: true },
      });
      let row;
      try {
        row = await tx.payrollReport.create({
          data: {
            businessId,
            ...same,
            version: (last._max.version ?? 0) + 1,
            runId: body.runId ?? null,
            documentId: body.documentId,
            source: 'import',
            requestedByUserId: actor.userId,
          },
        });
      } catch (e) {
        if (isUniqueViolation(e))
          throw errors.duplicate('This report version was just added. Reload and try again.');
        throw e;
      }
      await this.audit.logIn(
        tx,
        'payroll.report.added',
        { type: 'payroll_report', id: row.id },
        {
          payrollClientId: id,
          clientId: pc.clientId,
          kind: body.kind,
          version: row.version,
        },
      );
      return toReport(row, await memberNames(tx, businessId, [actor.userId]));
    }).catch(mapPayrollDbError);
  }

  async yearEnd(
    businessId: string,
    actor: PayrollActor,
    id: string,
    q: z.output<typeof PayrollYearEndQuery>,
  ): Promise<PayrollYearEnd> {
    const taxYear = q.taxYear ?? new Date().getUTCFullYear() - 1;
    const { row, names } = await inFirm(this.database, businessId, async (tx) => {
      await findPayrollClient(tx, businessId, actor, id);
      const row = await tx.payrollYearEnd.findUnique({
        where: { payrollClientId_taxYear: { payrollClientId: id, taxYear } },
      });
      return { row, names: await memberNames(tx, businessId, [row?.deliveredByUserId ?? null]) };
    });
    await this.audit.log('payroll.year_end.viewed', { type: 'payroll_client', id }, { taxYear });
    return this.toYearEnd(taxYear, row, names);
  }

  private toYearEnd(
    taxYear: number,
    row: Prisma.PayrollYearEndGetPayload<object> | null,
    names: Map<string, string>,
  ): PayrollYearEnd {
    return {
      taxYear,
      status: row?.status ?? 'NOT_STARTED',
      items: checklist(row?.items),
      exceptionsNote: row?.exceptionsNote ?? null,
      reconciledAt: iso(row?.reconciledAt ?? null),
      deliveredAt: iso(row?.deliveredAt ?? null),
      deliveredBy: memberRefOf(names, row?.deliveredByUserId ?? null),
      updatedAt: iso(row?.updatedAt ?? null),
    };
  }

  /** Sets year-end steps; the status follows (reconciled, then delivered; delivery needs reconciliation). */
  async saveYearEnd(
    businessId: string,
    actor: PayrollActor,
    id: string,
    taxYear: number,
    body: z.output<typeof SavePayrollYearEndRequest>,
  ): Promise<PayrollYearEnd> {
    const { row, names } = await inFirm(this.database, businessId, async (tx) => {
      const pc = await findPayrollClient(tx, businessId, actor, id);
      if (pc.status === 'ARCHIVED') throw errors.clientState('This payroll client is archived');
      const current = await tx.payrollYearEnd.findUnique({
        where: { payrollClientId_taxYear: { payrollClientId: id, taxYear } },
      });
      const state = new Map(checklist(current?.items).map((i) => [i.step, i.state]));
      for (const item of body.items ?? []) state.set(item.step, item.state);
      const reconciled = state.get('RECONCILIATION') === 'DONE';
      const delivered = state.get('CLIENT_DELIVERY') === 'DONE';
      if (delivered && !reconciled) {
        throw errors.invalid('items', 'Reconcile the year before delivering it to the client');
      }
      const started = [...state.values()].some((s) => s !== 'NOT_STARTED');
      const status = delivered
        ? 'DELIVERED'
        : reconciled
          ? 'RECONCILED'
          : started
            ? 'IN_PROGRESS'
            : 'NOT_STARTED';
      const now = new Date();
      const items = Object.fromEntries(state);
      const data = {
        status,
        items,
        ...(body.exceptionsNote !== undefined ? { exceptionsNote: body.exceptionsNote } : {}),
        reconciledAt: reconciled ? (current?.reconciledAt ?? now) : null,
        deliveredAt: delivered ? (current?.deliveredAt ?? now) : null,
        deliveredByUserId: delivered ? (current?.deliveredByUserId ?? actor.userId) : null,
      } as const;
      const row = await tx.payrollYearEnd.upsert({
        where: { payrollClientId_taxYear: { payrollClientId: id, taxYear } },
        create: { businessId, payrollClientId: id, taxYear, ...data },
        update: data,
      });
      await this.audit.logIn(
        tx,
        'payroll.year_end.saved',
        { type: 'payroll_client', id },
        {
          clientId: pc.clientId,
          taxYear,
          status,
        },
      );
      return { row, names: await memberNames(tx, businessId, [row.deliveredByUserId]) };
    }).catch(mapPayrollDbError);
    return this.toYearEnd(taxYear, row, names);
  }
}
