import type { Prisma, TxClient } from '@firmivra/db';
import type {
  MemberRef,
  PayrollClientRef,
  PayrollRunFigures,
  PayrollRunRow,
  PayrollWorker,
} from '@firmivra/types';
import type { ClientsActor } from '../clients/clients.service.js';
import { day, errors } from './payroll.shared.js';

export type PayrollActor = ClientsActor;

/** Owner and Admin; Staff and the five newer roles are scoped to their assigned clients. */
export const isManager = (actor: PayrollActor): boolean => actor.role !== 'STAFF';

/** The extra `where` that limits a Staff member to the payroll clients of clients assigned to them. */
export const reachWhere = (actor: PayrollActor): Prisma.PayrollClientWhereInput =>
  isManager(actor) ? {} : { client: { assignedUserId: actor.userId.toLowerCase() } };

export const clientRefSelect = {
  id: true,
  displayName: true,
  clientNumber: true,
  accountType: true,
} satisfies Prisma.ClientSelect;

export const toClientRef = (c: {
  id: string;
  displayName: string;
  clientNumber: number;
  accountType: string;
}): PayrollClientRef => ({
  id: c.id,
  displayName: c.displayName,
  clientNumber: c.clientNumber,
  accountType: c.accountType === 'BUSINESS' ? 'BUSINESS' : 'INDIVIDUAL',
});

export const iso = (d: Date | null): string | null => d?.toISOString() ?? null;

/** The payroll client a request names, when the caller reaches it; 404 otherwise. */
export async function findPayrollClient(
  tx: TxClient,
  businessId: string,
  actor: PayrollActor,
  id: string,
) {
  const row = await tx.payrollClient.findFirst({
    where: { AND: [{ businessId, id }, reachWhere(actor)] },
    include: {
      client: { select: { id: true, displayName: true, assignedUserId: true } },
      connection: { select: { status: true } },
    },
  });
  if (!row) throw errors.notFound();
  return row;
}

export type PayrollClientRow = Awaited<ReturnType<typeof findPayrollClient>>;

export function memberRefOf(names: Map<string, string>, id: string | null): MemberRef | null {
  const name = id ? names.get(id) : undefined;
  return id && name !== undefined ? { userId: id, name } : null;
}

export const workerSelect = {
  id: true,
  displayName: true,
  workerType: true,
  status: true,
  payType: true,
  rateCents: true,
  department: true,
  jobTitle: true,
  startedOn: true,
  directDepositReady: true,
  source: true,
  lastChangeAt: true,
  lastChangeNote: true,
} satisfies Prisma.PayrollWorkerSelect;
type WorkerRow = Prisma.PayrollWorkerGetPayload<{ select: typeof workerSelect }>;

export const toWorker = (w: WorkerRow): PayrollWorker => ({
  id: w.id,
  displayName: w.displayName,
  workerType: w.workerType,
  status: w.status,
  payType: w.payType,
  rateCents: w.rateCents,
  department: w.department,
  jobTitle: w.jobTitle,
  startedOn: day(w.startedOn),
  directDepositReady: w.directDepositReady,
  source: w.source === 'provider' || w.source === 'import' ? w.source : 'manual',
  lastChangeAt: iso(w.lastChangeAt),
  lastChangeNote: w.lastChangeNote,
});

export const runRowSelect = {
  id: true,
  payrollClientId: true,
  periodStart: true,
  periodEnd: true,
  payDate: true,
  frequency: true,
  status: true,
  step: true,
  employeeCount: true,
  totalCostCents: true,
  grossCents: true,
  providerStatus: true,
} satisfies Prisma.PayrollRunSelect;
type RunRowData = Prisma.PayrollRunGetPayload<{ select: typeof runRowSelect }>;

export const toRunRow = (r: RunRowData, clientName: string): PayrollRunRow => ({
  id: r.id,
  payrollClientId: r.payrollClientId,
  clientName,
  periodStart: day(r.periodStart) ?? '',
  periodEnd: day(r.periodEnd) ?? '',
  payDate: day(r.payDate) ?? '',
  frequency: r.frequency,
  status: r.status,
  step: r.step,
  employeeCount: r.employeeCount,
  totalCostCents: r.totalCostCents,
  grossCents: r.grossCents,
  providerStatus: r.providerStatus,
});

type FigureRow = Pick<
  Prisma.PayrollRunGetPayload<object>,
  | 'employeeCount'
  | 'regularPayCents'
  | 'overtimePayCents'
  | 'otherEarningsCents'
  | 'grossCents'
  | 'employeeTaxesCents'
  | 'deductionsCents'
  | 'netCents'
  | 'employerTaxesCents'
  | 'employerBenefitsCents'
  | 'employerCostsCents'
  | 'totalCostCents'
  | 'figuresConfirmed'
>;

export const toFigures = (r: FigureRow): PayrollRunFigures => ({
  employeeCount: r.employeeCount,
  regularPayCents: r.regularPayCents,
  overtimePayCents: r.overtimePayCents,
  otherEarningsCents: r.otherEarningsCents,
  grossCents: r.grossCents,
  employeeTaxesCents: r.employeeTaxesCents,
  deductionsCents: r.deductionsCents,
  netCents: r.netCents,
  employerTaxesCents: r.employerTaxesCents,
  employerBenefitsCents: r.employerBenefitsCents,
  employerCostsCents: r.employerCostsCents,
  totalCostCents: r.totalCostCents,
  confirmed: r.figuresConfirmed,
});

/** Employee plus employer taxes, when either is known. */
export const taxesOf = (r: Pick<FigureRow, 'employeeTaxesCents' | 'employerTaxesCents'>) =>
  r.employeeTaxesCents === null && r.employerTaxesCents === null
    ? null
    : (r.employeeTaxesCents ?? 0) + (r.employerTaxesCents ?? 0);

/** The pages' offset and limit. */
export const skipTake = (q: { page: number; pageSize: number }) => ({
  skip: (q.page - 1) * q.pageSize,
  take: q.pageSize,
});
