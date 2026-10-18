import { Inject, Injectable } from '@nestjs/common';
import type { Database, Prisma, TxClient } from '@firmivra/db';
import type {
  CompletePayrollRunRequest,
  CreatePayrollRunRequest,
  PayrollIssue,
  PayrollIssueList,
  PayrollIssuesQuery,
  PayrollLineList,
  PayrollLinesQuery,
  PayrollListQuery,
  PayrollRun,
  PayrollRunPage,
  PayrollRunsQuery,
  ReopenPayrollRunRequest,
  ResolvePayrollIssueRequest,
  SavePayrollLinesRequest,
  SubmitPayrollRunRequest,
  UpdatePayrollRunRequest,
} from '@firmivra/types';
import type { z } from 'zod';
import { AuditService } from '../audit/audit.service.js';
import { DATABASE } from '../database/database.module.js';
import { isUniqueViolation, memberNames } from '../workspaces/common.js';
import {
  clientRefSelect,
  findPayrollClient,
  iso,
  isManager,
  memberRefOf,
  type PayrollActor,
  reachWhere,
  runRowSelect,
  skipTake,
  toClientRef,
  toFigures,
  toRunRow,
} from './payroll.mappers.js';
import {
  checkLines,
  csvRow,
  day,
  dollars,
  errors,
  figuresFrom,
  inFirm,
  isEditableRun,
  linePay,
  mapPayrollDbError,
  providerRef,
  toDay,
  type LineAmounts,
  type TaxInputs,
} from './payroll.shared.js';

type RunsQuery = z.output<typeof PayrollRunsQuery>;
type LinesQuery = z.output<typeof PayrollLinesQuery>;
type IssuesQuery = z.output<typeof PayrollIssuesQuery>;
type TabKey = 'ALL' | 'FULL_TIME' | 'PART_TIME' | 'ON_LEAVE' | 'CONTRACTORS';

const rowSelect = {
  ...runRowSelect,
  payrollClient: { select: { client: { select: { displayName: true } } } },
} satisfies Prisma.PayrollRunSelect;

const lineSelect = {
  id: true,
  hours: true,
  regularPayCents: true,
  overtimePayCents: true,
  otherEarningsCents: true,
  deductionsCents: true,
  totalPayCents: true,
  status: true,
  note: true,
  worker: {
    select: {
      id: true,
      displayName: true,
      workerType: true,
      status: true,
      payType: true,
      rateCents: true,
      directDepositReady: true,
    },
  },
} satisfies Prisma.PayrollRunLineSelect;
type LineRow = Prisma.PayrollRunLineGetPayload<{ select: typeof lineSelect }>;

const toLine = (l: LineRow) => ({
  id: l.id,
  worker: {
    id: l.worker.id,
    displayName: l.worker.displayName,
    workerType: l.worker.workerType,
    status: l.worker.status,
    payType: l.worker.payType,
    rateCents: l.worker.rateCents,
  },
  hours: Number(l.hours),
  regularPayCents: l.regularPayCents,
  overtimePayCents: l.overtimePayCents,
  otherEarningsCents: l.otherEarningsCents,
  deductionsCents: l.deductionsCents,
  totalPayCents: l.totalPayCents,
  status: l.status,
  note: l.note,
});

const amounts = (l: LineRow): LineAmounts => ({
  hours: Number(l.hours),
  regularPayCents: l.regularPayCents,
  overtimePayCents: l.overtimePayCents,
  otherEarningsCents: l.otherEarningsCents,
  deductionsCents: l.deductionsCents,
  status: l.status,
  workerType: l.worker.workerType,
});

const lineTab = (tab: TabKey): Prisma.PayrollRunLineWhereInput =>
  tab === 'FULL_TIME'
    ? { worker: { workerType: 'FULL_TIME' } }
    : tab === 'PART_TIME'
      ? { worker: { workerType: 'PART_TIME' } }
      : tab === 'CONTRACTORS'
        ? { worker: { workerType: 'CONTRACTOR' } }
        : tab === 'ON_LEAVE'
          ? { worker: { status: 'ON_LEAVE' } }
          : {};

/** Locks the run row, so two changes to one run queue up and the second reads the first's result. */
async function lockRun(tx: TxClient, businessId: string, actor: PayrollActor, runId: string) {
  const found = await tx.payrollRun.findFirst({
    where: { AND: [{ businessId, id: runId }, { payrollClient: reachWhere(actor) }] },
    select: { id: true },
  });
  if (!found) throw errors.notFound();
  await tx.$executeRaw`SELECT 1 FROM payroll_runs WHERE business_id = ${businessId}::uuid AND id = ${runId}::uuid FOR NO KEY UPDATE`;
  return tx.payrollRun.findFirstOrThrow({
    where: { businessId, id: runId },
    include: { payrollClient: { select: { clientId: true, status: true } } },
  });
}
type LockedRun = Awaited<ReturnType<typeof lockRun>>;

/**
 * Payroll runs: the Run Payroll workflow for one pay period. Preparing (period, lines, tax
 * figures from the provider's report, checks) and "ready for review" are STAFF+; approving,
 * submitting, completing and reopening are Owner and Admin. Approval is Firmivra's; submission
 * records that the provider took the run, with the provider's reference, and is separate. Firmivra
 * calculates no payroll tax: figures are the lines' sums and what the preparer took from the
 * provider's report; the database refuses a run whose sums do not add up, and a COMPLETED run
 * never changes.
 */
@Injectable()
export class PayrollRunsService {
  constructor(
    @Inject(DATABASE) private readonly database: Database,
    private readonly audit: AuditService,
  ) {}

  // ---------- Lists ----------

  async list(businessId: string, actor: PayrollActor, q: RunsQuery): Promise<PayrollRunPage> {
    const where: Prisma.PayrollRunWhereInput = {
      AND: [
        {
          businessId,
          payrollClient: { AND: [{ status: { not: 'ARCHIVED' } }, reachWhere(actor)] },
        },
        q.status ? { status: q.status } : {},
        q.upcoming ? { status: { not: 'COMPLETED' } } : {},
        q.payrollClientId ? { payrollClientId: q.payrollClientId } : {},
        q.payFrom ? { payDate: { gte: toDay(q.payFrom) } } : {},
        q.payTo ? { payDate: { lte: toDay(q.payTo) } } : {},
      ],
    };
    const dir = q.upcoming ? 'asc' : 'desc';
    const { rows, total } = await inFirm(this.database, businessId, async (tx) => {
      const [rows, total] = await Promise.all([
        tx.payrollRun.findMany({
          where,
          select: rowSelect,
          orderBy: [{ payDate: dir }, { id: dir }],
          ...skipTake(q),
        }),
        tx.payrollRun.count({ where }),
      ]);
      return { rows, total };
    });
    await this.audit.log('payroll.runs.listed', { type: 'payroll' }, { count: rows.length });
    return {
      items: rows.map((r) => toRunRow(r, r.payrollClient.client.displayName)),
      total,
      page: q.page,
      pageSize: q.pageSize,
    };
  }

  async clientRuns(
    businessId: string,
    actor: PayrollActor,
    id: string,
    q: z.output<typeof PayrollListQuery>,
  ): Promise<PayrollRunPage> {
    const { rows, total } = await inFirm(this.database, businessId, async (tx) => {
      await findPayrollClient(tx, businessId, actor, id);
      const where = { businessId, payrollClientId: id };
      const [rows, total] = await Promise.all([
        tx.payrollRun.findMany({
          where,
          select: rowSelect,
          orderBy: [{ payDate: 'desc' }, { id: 'desc' }],
          ...skipTake(q),
        }),
        tx.payrollRun.count({ where }),
      ]);
      return { rows, total };
    });
    await this.audit.log(
      'payroll.runs.listed',
      { type: 'payroll_client', id },
      { count: rows.length },
    );
    return {
      items: rows.map((r) => toRunRow(r, r.payrollClient.client.displayName)),
      total,
      page: q.page,
      pageSize: q.pageSize,
    };
  }

  // ---------- Create, read, update ----------

  async create(
    businessId: string,
    actor: PayrollActor,
    id: string,
    body: z.output<typeof CreatePayrollRunRequest>,
  ): Promise<PayrollRun> {
    const runId = await inFirm(this.database, businessId, async (tx) => {
      const pc = await findPayrollClient(tx, businessId, actor, id);
      if (pc.status === 'ARCHIVED' || pc.status === 'ON_HOLD') {
        throw errors.clientState('Resume this payroll client before creating a run');
      }
      const frequency = body.frequency ?? pc.frequency;
      if (!frequency) throw errors.frequencyRequired();
      let run;
      try {
        run = await tx.payrollRun.create({
          data: {
            businessId,
            payrollClientId: id,
            periodStart: toDay(body.periodStart),
            periodEnd: toDay(body.periodEnd),
            payDate: toDay(body.payDate),
            frequency,
            includeContractors: body.includeContractors,
            status: body.start ? 'IN_PROGRESS' : 'NOT_STARTED',
            preparedByUserId: body.start ? actor.userId : null,
          },
          select: { id: true },
        });
      } catch (e) {
        if (isUniqueViolation(e)) throw errors.runExists();
        throw e;
      }
      if (body.start) {
        const workers = await tx.payrollWorker.findMany({
          where: {
            businessId,
            payrollClientId: id,
            status: 'ACTIVE',
            ...(body.includeContractors ? {} : { workerType: { not: 'CONTRACTOR' } }),
          },
          select: { id: true },
        });
        if (workers.length > 0) {
          await tx.payrollRunLine.createMany({
            data: workers.map((w) => ({ businessId, runId: run.id, workerId: w.id })),
          });
        }
      }
      await this.audit.logIn(
        tx,
        'payroll.run.created',
        { type: 'payroll_run', id: run.id },
        {
          payrollClientId: id,
          clientId: pc.clientId,
          started: body.start,
        },
      );
      return run.id;
    }).catch(mapPayrollDbError);
    return this.get(businessId, actor, runId, false);
  }

  async get(
    businessId: string,
    actor: PayrollActor,
    runId: string,
    log = true,
  ): Promise<PayrollRun> {
    const data = await inFirm(this.database, businessId, async (tx) => {
      const run = await tx.payrollRun.findFirst({
        where: { AND: [{ businessId, id: runId }, { payrollClient: reachWhere(actor) }] },
        include: {
          payrollClient: {
            select: {
              providerKey: true,
              clientId: true,
              client: { select: clientRefSelect },
              connection: { select: { status: true } },
            },
          },
        },
      });
      if (!run) throw errors.notFound();
      const lines = await tx.payrollRunLine.groupBy({
        by: ['status'],
        where: { businessId, runId },
        _count: { _all: true },
      });
      const issues = await tx.payrollRunIssue.groupBy({
        by: ['severity'],
        where: { businessId, runId, resolvedAt: null },
        _count: { _all: true },
      });
      const recent = await tx.payrollRun.findMany({
        where: { businessId, payrollClientId: run.payrollClientId, status: 'COMPLETED' },
        orderBy: [{ payDate: 'desc' }, { id: 'desc' }],
        take: 3,
        select: runRowSelect,
      });
      const names = await memberNames(tx, businessId, [
        run.preparedByUserId,
        run.approvedByUserId,
        run.submittedByUserId,
      ]);
      return { run, lines, issues, recent, names };
    });
    const { run } = data;
    const count = (s: string) => data.lines.find((l) => l.status === s)?._count._all ?? 0;
    const open = (s: string) => data.issues.find((i) => i.severity === s)?._count._all ?? 0;
    const total = data.lines.reduce((n, l) => n + l._count._all, 0);
    const manager = isManager(actor);
    const editable = isEditableRun(run.status);
    if (log) {
      await this.audit.log(
        'payroll.run.viewed',
        { type: 'payroll_run', id: runId },
        {
          payrollClientId: run.payrollClientId,
          clientId: run.payrollClient.clientId,
        },
      );
    }
    const client = toClientRef(run.payrollClient.client);
    return {
      id: run.id,
      payrollClientId: run.payrollClientId,
      client,
      provider: providerRef(run.payrollClient.providerKey, run.payrollClient.connection),
      periodStart: day(run.periodStart) as string,
      periodEnd: day(run.periodEnd) as string,
      payDate: day(run.payDate) as string,
      frequency: run.frequency,
      status: run.status,
      step: run.step,
      includeContractors: run.includeContractors,
      providerStatus: run.providerStatus,
      providerConfirmation: run.providerConfirmation,
      figures: toFigures(run),
      lineCounts: {
        total,
        ready: count('READY'),
        warning: count('WARNING'),
        error: count('ERROR'),
        pendingChange: count('PENDING_CHANGE'),
        excluded: count('EXCLUDED'),
      },
      issueCounts: { info: open('INFO'), warning: open('WARNING'), error: open('ERROR') },
      preparedBy: memberRefOf(data.names, run.preparedByUserId),
      readyAt: iso(run.readyAt),
      approvedAt: iso(run.approvedAt),
      approvedBy: memberRefOf(data.names, run.approvedByUserId),
      submittedAt: iso(run.submittedAt),
      submittedBy: memberRefOf(data.names, run.submittedByUserId),
      reopenedAt: iso(run.reopenedAt),
      reopenReason: run.reopenReason,
      completedAt: iso(run.completedAt),
      actions: {
        canEdit: editable,
        canMarkReady: editable && total - count('EXCLUDED') > 0,
        canApprove: manager && run.status === 'READY_FOR_REVIEW',
        canSubmit: manager && (run.status === 'APPROVED' || run.status === 'NEEDS_ATTENTION'),
        canReopen:
          manager && ['READY_FOR_REVIEW', 'APPROVED', 'NEEDS_ATTENTION'].includes(run.status),
      },
      recentRuns: data.recent.map((r) => toRunRow(r, client.displayName)),
      createdAt: run.createdAt.toISOString(),
      updatedAt: run.updatedAt.toISOString(),
    };
  }

  private taxesOfRun(run: {
    employeeTaxesCents: number | null;
    employerTaxesCents: number | null;
    employerBenefitsCents: number | null;
  }): TaxInputs {
    return {
      employeeTaxesCents: run.employeeTaxesCents,
      employerTaxesCents: run.employerTaxesCents,
      employerBenefitsCents: run.employerBenefitsCents,
    };
  }

  /** Recomputes the run's figure columns from its lines and tax figures, in the caller's transaction. */
  private async refreshFigures(
    tx: TxClient,
    businessId: string,
    runId: string,
    includeContractors: boolean,
    taxes: TaxInputs,
  ): Promise<void> {
    const lines = await tx.payrollRunLine.findMany({
      where: { businessId, runId },
      select: lineSelect,
    });
    let figures;
    try {
      figures = figuresFrom(lines.map(amounts), includeContractors, taxes);
    } catch (e) {
      if (e instanceof RangeError) {
        throw errors.invalid('employeeTaxesCents', 'Taxes and deductions exceed the gross pay');
      }
      throw e;
    }
    await tx.payrollRun.update({ where: { id: runId }, data: figures });
  }

  async update(
    businessId: string,
    actor: PayrollActor,
    runId: string,
    body: z.output<typeof UpdatePayrollRunRequest>,
  ): Promise<PayrollRun> {
    await inFirm(this.database, businessId, async (tx) => {
      const run = await lockRun(tx, businessId, actor, runId);
      if (!isEditableRun(run.status)) throw errors.runState('This run can no longer be edited');
      const taxes: TaxInputs = {
        employeeTaxesCents:
          body.employeeTaxesCents === undefined ? run.employeeTaxesCents : body.employeeTaxesCents,
        employerTaxesCents:
          body.employerTaxesCents === undefined ? run.employerTaxesCents : body.employerTaxesCents,
        employerBenefitsCents:
          body.employerBenefitsCents === undefined
            ? run.employerBenefitsCents
            : body.employerBenefitsCents,
      };
      const includeContractors = body.includeContractors ?? run.includeContractors;
      await tx.payrollRun.update({
        where: { id: runId },
        data: {
          ...(body.step !== undefined ? { step: body.step } : {}),
          ...(body.payDate !== undefined ? { payDate: toDay(body.payDate) } : {}),
          ...(body.frequency !== undefined ? { frequency: body.frequency } : {}),
          includeContractors,
          ...(run.status === 'NOT_STARTED'
            ? { status: 'IN_PROGRESS', preparedByUserId: actor.userId }
            : {}),
        },
      });
      await this.refreshFigures(tx, businessId, runId, includeContractors, taxes);
      await this.audit.logIn(
        tx,
        'payroll.run.updated',
        { type: 'payroll_run', id: runId },
        {
          payrollClientId: run.payrollClientId,
          clientId: run.payrollClient.clientId,
          fields: Object.keys(body).sort(),
        },
      );
    }).catch(mapPayrollDbError);
    return this.get(businessId, actor, runId, false);
  }

  // ---------- Lines ----------

  async lines(
    businessId: string,
    actor: PayrollActor,
    runId: string,
    q: LinesQuery,
  ): Promise<PayrollLineList> {
    const { rows, total, all, clientId } = await inFirm(this.database, businessId, async (tx) => {
      const run = await tx.payrollRun.findFirst({
        where: { AND: [{ businessId, id: runId }, { payrollClient: reachWhere(actor) }] },
        select: { payrollClient: { select: { clientId: true } } },
      });
      if (!run) throw errors.notFound();
      const base: Prisma.PayrollRunLineWhereInput = {
        businessId,
        runId,
        ...(q.status ? { status: q.status } : {}),
        ...(q.search
          ? { worker: { displayName: { contains: q.search, mode: 'insensitive' } } }
          : {}),
      };
      const where = { AND: [base, lineTab(q.tab)] };
      const [rows, total, all] = await Promise.all([
        tx.payrollRunLine.findMany({
          where,
          select: lineSelect,
          orderBy: [{ worker: { displayName: 'asc' } }, { id: 'asc' }],
          ...skipTake(q),
        }),
        tx.payrollRunLine.count({ where }),
        tx.payrollRunLine.findMany({
          where: base,
          select: { worker: { select: { workerType: true, status: true } } },
        }),
      ]);
      return { rows, total, all, clientId: run.payrollClient.clientId };
    });
    await this.audit.log(
      'payroll.run.lines_listed',
      { type: 'payroll_run', id: runId },
      { clientId, count: rows.length },
    );
    return {
      items: rows.map(toLine),
      total,
      page: q.page,
      pageSize: q.pageSize,
      tabCounts: {
        ALL: all.length,
        FULL_TIME: all.filter((l) => l.worker.workerType === 'FULL_TIME').length,
        PART_TIME: all.filter((l) => l.worker.workerType === 'PART_TIME').length,
        ON_LEAVE: all.filter((l) => l.worker.status === 'ON_LEAVE').length,
        CONTRACTORS: all.filter((l) => l.worker.workerType === 'CONTRACTOR').length,
      },
    };
  }

  async saveLines(
    businessId: string,
    actor: PayrollActor,
    runId: string,
    body: z.output<typeof SavePayrollLinesRequest>,
  ): Promise<PayrollLineList> {
    await inFirm(this.database, businessId, async (tx) => {
      const run = await lockRun(tx, businessId, actor, runId);
      if (!isEditableRun(run.status)) throw errors.runState('This run can no longer be edited');
      const ids = [...new Set(body.lines.map((l) => l.workerId))];
      if (ids.length !== body.lines.length) {
        throw errors.invalid('lines', 'List each worker once');
      }
      const workers = await tx.payrollWorker.count({
        where: { businessId, payrollClientId: run.payrollClientId, id: { in: ids } },
      });
      if (workers !== ids.length) throw errors.notThisClients('worker');
      for (const l of body.lines) {
        const data = {
          hours: l.hours,
          regularPayCents: l.regularPayCents,
          overtimePayCents: l.overtimePayCents,
          otherEarningsCents: l.otherEarningsCents,
          deductionsCents: l.deductionsCents,
          totalPayCents: linePay(l),
          ...(l.status !== undefined ? { status: l.status } : {}),
          ...(l.note !== undefined ? { note: l.note } : {}),
        };
        await tx.payrollRunLine.upsert({
          where: { runId_workerId: { runId, workerId: l.workerId } },
          create: { businessId, runId, workerId: l.workerId, ...data },
          update: data,
        });
      }
      if (run.status === 'NOT_STARTED') {
        await tx.payrollRun.update({
          where: { id: runId },
          data: { status: 'IN_PROGRESS', preparedByUserId: actor.userId },
        });
      }
      await this.refreshFigures(
        tx,
        businessId,
        runId,
        run.includeContractors,
        this.taxesOfRun(run),
      );
      await this.audit.logIn(
        tx,
        'payroll.run.lines_saved',
        { type: 'payroll_run', id: runId },
        {
          payrollClientId: run.payrollClientId,
          clientId: run.payrollClient.clientId,
          count: body.lines.length,
        },
      );
    }).catch(mapPayrollDbError);
    return this.lines(businessId, actor, runId, PAYROLL_LINES_DEFAULT);
  }

  // ---------- Issues ----------

  private toIssue(
    i: {
      id: string;
      severity: PayrollIssue['severity'];
      code: string;
      message: string;
      workerId: string | null;
      resolvedAt: Date | null;
      resolvedByUserId: string | null;
      createdAt: Date;
      worker: { displayName: string } | null;
    },
    names: Map<string, string>,
  ): PayrollIssue {
    return {
      id: i.id,
      severity: i.severity,
      code: i.code,
      message: i.message,
      workerId: i.workerId,
      workerName: i.worker?.displayName ?? null,
      resolvedAt: iso(i.resolvedAt),
      resolvedBy: memberRefOf(names, i.resolvedByUserId),
      createdAt: i.createdAt.toISOString(),
    };
  }

  private async readIssues(
    tx: TxClient,
    businessId: string,
    runId: string,
    q: IssuesQuery,
  ): Promise<PayrollIssueList> {
    const rows = await tx.payrollRunIssue.findMany({
      where: {
        businessId,
        runId,
        ...(q.severity ? { severity: q.severity } : {}),
        ...(q.open === 'true'
          ? { resolvedAt: null }
          : q.open === 'false'
            ? { resolvedAt: { not: null } }
            : {}),
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 200,
      include: { worker: { select: { displayName: true } } },
    });
    const names = await memberNames(
      tx,
      businessId,
      rows.map((r) => r.resolvedByUserId),
    );
    return { items: rows.map((r) => this.toIssue(r, names)) };
  }

  async issues(
    businessId: string,
    actor: PayrollActor,
    runId: string,
    q: IssuesQuery,
  ): Promise<PayrollIssueList> {
    return inFirm(this.database, businessId, async (tx) => {
      const run = await tx.payrollRun.findFirst({
        where: { AND: [{ businessId, id: runId }, { payrollClient: reachWhere(actor) }] },
        select: { id: true },
      });
      if (!run) throw errors.notFound();
      return this.readIssues(tx, businessId, runId, q);
    });
  }

  /** Runs the firm's checks on the lines; new findings are added, ones already open are kept. */
  async check(businessId: string, actor: PayrollActor, runId: string): Promise<PayrollIssueList> {
    return inFirm(this.database, businessId, async (tx) => {
      const run = await lockRun(tx, businessId, actor, runId);
      if (run.status === 'COMPLETED') throw errors.runState('A completed run does not change');
      const lines = await tx.payrollRunLine.findMany({
        where: { businessId, runId },
        select: lineSelect,
      });
      const found = checkLines(
        lines.map((l) => ({
          workerId: l.worker.id,
          hours: Number(l.hours),
          regularPayCents: l.regularPayCents,
          overtimePayCents: l.overtimePayCents,
          otherEarningsCents: l.otherEarningsCents,
          status: l.status,
          totalPayCents: l.totalPayCents,
          workerStatus: l.worker.status,
          payType: l.worker.payType,
          directDepositReady: l.worker.directDepositReady,
        })),
      );
      const open = await tx.payrollRunIssue.findMany({
        where: { businessId, runId, resolvedAt: null },
        select: { code: true, workerId: true },
      });
      const have = new Set(open.map((i) => `${i.code}:${i.workerId}`));
      const fresh = found.filter((f) => !have.has(`${f.code}:${f.workerId}`));
      if (fresh.length > 0) {
        await tx.payrollRunIssue.createMany({
          data: fresh.map((f) => ({ businessId, runId, ...f })),
        });
      }
      await this.audit.logIn(
        tx,
        'payroll.run.checked',
        { type: 'payroll_run', id: runId },
        {
          payrollClientId: run.payrollClientId,
          clientId: run.payrollClient.clientId,
          added: fresh.length,
        },
      );
      return this.readIssues(tx, businessId, runId, { open: 'true' });
    }).catch(mapPayrollDbError);
  }

  async resolveIssue(
    businessId: string,
    actor: PayrollActor,
    runId: string,
    issueId: string,
    body: z.output<typeof ResolvePayrollIssueRequest>,
  ): Promise<PayrollIssue> {
    return inFirm(this.database, businessId, async (tx) => {
      const run = await lockRun(tx, businessId, actor, runId);
      if (run.status === 'COMPLETED') throw errors.runState('A completed run does not change');
      const issue = await tx.payrollRunIssue.findFirst({
        where: { businessId, runId, id: issueId },
        select: { id: true },
      });
      if (!issue) throw errors.notFound();
      const row = await tx.payrollRunIssue.update({
        where: { id: issueId },
        data: body.resolved
          ? { resolvedAt: new Date(), resolvedByUserId: actor.userId }
          : { resolvedAt: null, resolvedByUserId: null },
        include: { worker: { select: { displayName: true } } },
      });
      await this.audit.logIn(
        tx,
        'payroll.run.issue_resolved',
        { type: 'payroll_run', id: runId },
        {
          payrollClientId: run.payrollClientId,
          clientId: run.payrollClient.clientId,
          resolved: body.resolved,
        },
      );
      return this.toIssue(row, await memberNames(tx, businessId, [row.resolvedByUserId]));
    }).catch(mapPayrollDbError);
  }

  // ---------- Workflow actions ----------

  /** One workflow step: the run must be in one of `from`; `data` is applied; the audit row says `action`. */
  private async step(
    businessId: string,
    actor: PayrollActor,
    runId: string,
    action: string,
    from: readonly string[],
    data: (run: LockedRun) => Prisma.PayrollRunUncheckedUpdateInput,
    before?: (tx: TxClient, run: LockedRun) => Promise<void>,
  ): Promise<PayrollRun> {
    await inFirm(this.database, businessId, async (tx) => {
      const run = await lockRun(tx, businessId, actor, runId);
      if (!from.includes(run.status)) {
        throw errors.runState(
          `A run that is ${run.status.toLowerCase().replace(/_/g, ' ')} cannot do this`,
        );
      }
      if (before) await before(tx, run);
      await tx.payrollRun.update({ where: { id: runId }, data: data(run) });
      await this.audit.logIn(
        tx,
        action,
        { type: 'payroll_run', id: runId },
        {
          payrollClientId: run.payrollClientId,
          clientId: run.payrollClient.clientId,
          from: run.status,
        },
      );
    }).catch(mapPayrollDbError);
    return this.get(businessId, actor, runId, false);
  }

  saveDraft(businessId: string, actor: PayrollActor, runId: string): Promise<PayrollRun> {
    return this.step(
      businessId,
      actor,
      runId,
      'payroll.run.draft_saved',
      ['NOT_STARTED', 'IN_PROGRESS', 'DRAFT'],
      (run) =>
        run.status === 'DRAFT'
          ? {}
          : {
              status: 'DRAFT',
              ...(run.preparedByUserId ? {} : { preparedByUserId: actor.userId }),
            },
    );
  }

  /** Marks the run ready for review (needs at least one line that counts). */
  async markReady(businessId: string, actor: PayrollActor, runId: string): Promise<PayrollRun> {
    await inFirm(this.database, businessId, async (tx) => {
      const run = await lockRun(tx, businessId, actor, runId);
      if (!isEditableRun(run.status)) {
        throw errors.runState('Only a run that is being prepared can be marked ready');
      }
      const counted = await tx.payrollRunLine.count({
        where: { businessId, runId, status: { not: 'EXCLUDED' } },
      });
      if (counted === 0) throw errors.runEmpty();
      // The database moves a run one step at a time: a draft or scheduled run goes through In Progress.
      if (run.status !== 'IN_PROGRESS') {
        await tx.payrollRun.update({ where: { id: runId }, data: { status: 'IN_PROGRESS' } });
      }
      await this.refreshFigures(
        tx,
        businessId,
        runId,
        run.includeContractors,
        this.taxesOfRun(run),
      );
      await tx.payrollRun.update({
        where: { id: runId },
        data: {
          status: 'READY_FOR_REVIEW',
          step: 5,
          readyAt: new Date(),
          preparedByUserId: run.preparedByUserId ?? actor.userId,
        },
      });
      await this.audit.logIn(
        tx,
        'payroll.run.marked_ready',
        { type: 'payroll_run', id: runId },
        {
          payrollClientId: run.payrollClientId,
          clientId: run.payrollClient.clientId,
        },
      );
    }).catch(mapPayrollDbError);
    return this.get(businessId, actor, runId, false);
  }

  approve(businessId: string, actor: PayrollActor, runId: string): Promise<PayrollRun> {
    return this.step(
      businessId,
      actor,
      runId,
      'payroll.run.approved',
      ['READY_FOR_REVIEW'],
      () => ({
        status: 'APPROVED',
        approvedAt: new Date(),
        approvedByUserId: actor.userId,
      }),
    );
  }

  submit(
    businessId: string,
    actor: PayrollActor,
    runId: string,
    body: z.output<typeof SubmitPayrollRunRequest>,
  ): Promise<PayrollRun> {
    return this.step(
      businessId,
      actor,
      runId,
      'payroll.run.submitted',
      ['APPROVED', 'NEEDS_ATTENTION'],
      (run) => ({
        status: 'SUBMITTED',
        submittedAt: new Date(),
        submittedByUserId: actor.userId,
        providerConfirmation: body.providerConfirmation,
        providerStatus: body.providerStatus ?? 'submitted',
        figuresConfirmed: run.grossCents !== null,
      }),
    );
  }

  complete(
    businessId: string,
    actor: PayrollActor,
    runId: string,
    body: z.output<typeof CompletePayrollRunRequest>,
  ): Promise<PayrollRun> {
    return this.step(
      businessId,
      actor,
      runId,
      'payroll.run.completed',
      ['SUBMITTED', 'PROCESSING', 'NEEDS_ATTENTION'],
      () => ({
        status: 'COMPLETED',
        completedAt: new Date(),
        ...(body.providerStatus ? { providerStatus: body.providerStatus } : {}),
      }),
      async (tx, run) => {
        const pc = await tx.payrollClient.findFirstOrThrow({
          where: { businessId, id: run.payrollClientId },
          select: { lastRunOn: true },
        });
        if (!pc.lastRunOn || pc.lastRunOn < run.payDate) {
          await tx.payrollClient.update({
            where: { id: run.payrollClientId },
            data: { lastRunOn: run.payDate },
          });
        }
      },
    );
  }

  reopen(
    businessId: string,
    actor: PayrollActor,
    runId: string,
    body: z.output<typeof ReopenPayrollRunRequest>,
  ): Promise<PayrollRun> {
    return this.step(
      businessId,
      actor,
      runId,
      'payroll.run.reopened',
      ['READY_FOR_REVIEW', 'APPROVED', 'NEEDS_ATTENTION'],
      () => ({
        status: 'IN_PROGRESS',
        reopenReason: body.reason,
        reopenedAt: new Date(),
        readyAt: null,
        approvedAt: null,
        approvedByUserId: null,
        figuresConfirmed: false,
        step: 4,
      }),
    );
  }

  // ---------- Export ----------

  /** The run's pay lines as a CSV, for the "Download Details" button. Holds pay: audited. */
  async exportCsv(businessId: string, actor: PayrollActor, runId: string): Promise<string> {
    const { run, lines } = await inFirm(this.database, businessId, async (tx) => {
      const run = await tx.payrollRun.findFirst({
        where: { AND: [{ businessId, id: runId }, { payrollClient: reachWhere(actor) }] },
        select: {
          periodStart: true,
          periodEnd: true,
          payDate: true,
          payrollClientId: true,
          payrollClient: { select: { clientId: true } },
        },
      });
      if (!run) throw errors.notFound();
      const lines = await tx.payrollRunLine.findMany({
        where: { businessId, runId },
        select: lineSelect,
        orderBy: [{ worker: { displayName: 'asc' } }, { id: 'asc' }],
      });
      await this.audit.logIn(
        tx,
        'payroll.run.exported',
        { type: 'payroll_run', id: runId },
        {
          payrollClientId: run.payrollClientId,
          clientId: run.payrollClient.clientId,
          count: lines.length,
        },
      );
      return { run, lines };
    });
    const rows = [
      csvRow(['Pay period start', 'Pay period end', 'Pay date']),
      csvRow([day(run.periodStart), day(run.periodEnd), day(run.payDate)]),
      csvRow([
        'Employee',
        'Type',
        'Hours',
        'Regular pay',
        'Overtime',
        'Other earnings',
        'Deductions',
        'Total pay',
        'Status',
      ]),
      ...lines.map((l) =>
        csvRow([
          l.worker.displayName,
          l.worker.workerType,
          Number(l.hours),
          dollars(l.regularPayCents),
          dollars(l.overtimePayCents),
          dollars(l.otherEarningsCents),
          dollars(l.deductionsCents),
          dollars(l.totalPayCents),
          l.status,
        ]),
      ),
    ];
    return `${rows.join('\r\n')}\r\n`;
  }
}

const PAYROLL_LINES_DEFAULT: LinesQuery = { tab: 'ALL', page: 1, pageSize: 100 };
