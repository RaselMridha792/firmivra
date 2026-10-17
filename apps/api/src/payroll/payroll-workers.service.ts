import { Inject, Injectable } from '@nestjs/common';
import type { Database, Prisma } from '@firmivra/db';
import type {
  CreatePayrollWorkerRequest,
  PayrollWorker,
  PayrollWorkersQuery,
  PayrollWorkerList,
  PayrollWorkerTab,
  UpdatePayrollWorkerRequest,
} from '@firmivra/types';
import type { z } from 'zod';
import { AuditService } from '../audit/audit.service.js';
import { DATABASE } from '../database/database.module.js';
import {
  findPayrollClient,
  type PayrollActor,
  skipTake,
  toWorker,
  workerSelect,
} from './payroll.mappers.js';
import { errors, inFirm, toDay } from './payroll.shared.js';

type WorkersQuery = z.output<typeof PayrollWorkersQuery>;

const tabWhere = (tab: PayrollWorkerTab): Prisma.PayrollWorkerWhereInput =>
  tab === 'FULL_TIME'
    ? { workerType: 'FULL_TIME' }
    : tab === 'PART_TIME'
      ? { workerType: 'PART_TIME' }
      : tab === 'CONTRACTORS'
        ? { workerType: 'CONTRACTOR' }
        : tab === 'ON_LEAVE'
          ? { status: 'ON_LEAVE' }
          : {};

/** What changed, in words that carry no pay figure (the note is stored short and plain). */
function changeNote(body: z.output<typeof UpdatePayrollWorkerRequest>): string {
  const parts = [
    body.rateCents !== undefined || body.payType !== undefined ? 'Pay rate updated' : null,
    body.status !== undefined ? 'Status updated' : null,
    body.workerType !== undefined ? 'Worker type updated' : null,
    body.displayName !== undefined ? 'Name updated' : null,
    body.department !== undefined || body.jobTitle !== undefined ? 'Job details updated' : null,
    body.directDepositReady !== undefined ? 'Direct deposit readiness updated' : null,
    body.startedOn !== undefined ? 'Start date updated' : null,
  ].filter((p): p is string => p !== null);
  return parts.join('. ').slice(0, 300) || 'Worker updated';
}

/**
 * The workers (employees and contractors) of a payroll client: name, type, status, pay rate and
 * job. No SSN, bank or address: those stay at the provider. A worker is made Inactive, never
 * deleted.
 */
@Injectable()
export class PayrollWorkersService {
  constructor(
    @Inject(DATABASE) private readonly database: Database,
    private readonly audit: AuditService,
  ) {}

  async list(
    businessId: string,
    actor: PayrollActor,
    id: string,
    q: WorkersQuery,
  ): Promise<PayrollWorkerList> {
    const { rows, total, counts } = await inFirm(this.database, businessId, async (tx) => {
      await findPayrollClient(tx, businessId, actor, id);
      const base: Prisma.PayrollWorkerWhereInput = {
        businessId,
        payrollClientId: id,
        ...(q.search ? { displayName: { contains: q.search, mode: 'insensitive' } } : {}),
      };
      const visible: Prisma.PayrollWorkerWhereInput = q.status
        ? { status: q.status }
        : { status: { not: 'INACTIVE' } };
      const where = { AND: [base, visible, tabWhere(q.tab)] };
      const [rows, total, all] = await Promise.all([
        tx.payrollWorker.findMany({
          where,
          select: workerSelect,
          orderBy: [{ displayName: 'asc' }, { id: 'asc' }],
          ...skipTake(q),
        }),
        tx.payrollWorker.count({ where }),
        tx.payrollWorker.findMany({
          where: { AND: [base, visible] },
          select: { workerType: true, status: true },
        }),
      ]);
      return { rows, total, counts: all };
    });
    const tabCounts: Record<PayrollWorkerTab, number> = {
      ALL: counts.length,
      FULL_TIME: counts.filter((w) => w.workerType === 'FULL_TIME').length,
      PART_TIME: counts.filter((w) => w.workerType === 'PART_TIME').length,
      ON_LEAVE: counts.filter((w) => w.status === 'ON_LEAVE').length,
      CONTRACTORS: counts.filter((w) => w.workerType === 'CONTRACTOR').length,
    };
    await this.audit.log(
      'payroll.workers.listed',
      { type: 'payroll_client', id },
      { count: rows.length },
    );
    return { items: rows.map(toWorker), total, page: q.page, pageSize: q.pageSize, tabCounts };
  }

  async add(
    businessId: string,
    actor: PayrollActor,
    id: string,
    body: z.output<typeof CreatePayrollWorkerRequest>,
  ): Promise<PayrollWorker> {
    return inFirm(this.database, businessId, async (tx) => {
      const pc = await findPayrollClient(tx, businessId, actor, id);
      if (pc.status === 'ARCHIVED') throw errors.clientState('This payroll client is archived');
      const row = await tx.payrollWorker.create({
        data: {
          businessId,
          payrollClientId: id,
          displayName: body.displayName,
          workerType: body.workerType,
          status: body.status,
          payType: body.payType ?? null,
          rateCents: body.rateCents ?? null,
          department: body.department ?? null,
          jobTitle: body.jobTitle ?? null,
          startedOn: body.startedOn ? toDay(body.startedOn) : null,
          directDepositReady: body.directDepositReady ?? null,
          source: 'manual',
          lastChangeAt: new Date(),
          lastChangeNote: body.changeNote ?? 'Worker added',
        },
        select: workerSelect,
      });
      await this.audit.logIn(
        tx,
        'payroll.worker.added',
        { type: 'payroll_worker', id: row.id },
        {
          payrollClientId: id,
          clientId: pc.clientId,
          workerType: body.workerType,
        },
      );
      return toWorker(row);
    });
  }

  async update(
    businessId: string,
    actor: PayrollActor,
    id: string,
    workerId: string,
    body: z.output<typeof UpdatePayrollWorkerRequest>,
  ): Promise<PayrollWorker> {
    return inFirm(this.database, businessId, async (tx) => {
      const pc = await findPayrollClient(tx, businessId, actor, id);
      const current = await tx.payrollWorker.findFirst({
        where: { businessId, id: workerId, payrollClientId: id },
        select: { payType: true, rateCents: true },
      });
      if (!current) throw errors.notFound();
      const payType = body.payType === undefined ? current.payType : body.payType;
      const rate = body.rateCents === undefined ? current.rateCents : body.rateCents;
      if (rate !== null && payType === null) {
        throw errors.invalid('payType', 'Choose a pay type for the rate');
      }
      const { changeNote: note, ...fields } = body;
      const row = await tx.payrollWorker.update({
        where: { id: workerId },
        data: {
          ...fields,
          startedOn:
            fields.startedOn === undefined
              ? undefined
              : fields.startedOn
                ? toDay(fields.startedOn)
                : null,
          lastChangeAt: new Date(),
          lastChangeNote: note ?? changeNote(body),
        },
        select: workerSelect,
      });
      await this.audit.logIn(
        tx,
        'payroll.worker.updated',
        { type: 'payroll_worker', id: workerId },
        {
          payrollClientId: id,
          clientId: pc.clientId,
          fields: Object.keys(body)
            .filter((k) => k !== 'changeNote')
            .sort(),
        },
      );
      return toWorker(row);
    });
  }
}
