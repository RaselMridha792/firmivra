import type { Prisma, TxClient } from '@firmivra/db';
import type {
  BookkeepingAccount,
  BookkeepingActivity,
  BookkeepingClientRef,
  BookkeepingConnection,
  BookkeepingPeriodSummary,
  BookkeepingReconciliation,
  BookkeepingReportRow,
  MemberRef,
} from '@firmivra/types';
import type { ClientsActor } from '../clients/clients.service.js';
import { lockClient } from '../workspaces/common.js';
import { day, errors, providerLabel, REPORT_NAMES, syncStatusOf } from './bookkeeping.shared.js';

export type BookkeepingActor = ClientsActor;

/** Owner and Admin; Staff and the five newer roles are scoped to their assigned clients. */
export const isManager = (actor: BookkeepingActor): boolean => actor.role !== 'STAFF';

/** The extra `where` that limits a Staff member to the clients assigned to them. */
export const reachClient = (actor: BookkeepingActor): Prisma.ClientWhereInput =>
  isManager(actor) ? {} : { assignedUserId: actor.userId.toLowerCase() };

/** The same, for a row that belongs to an engagement. */
export const reachEngagement = (actor: BookkeepingActor): Prisma.EngagementWhereInput =>
  isManager(actor) ? {} : { client: reachClient(actor) };

export const iso = (d: Date | null): string | null => d?.toISOString() ?? null;

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
}): BookkeepingClientRef => ({
  id: c.id,
  displayName: c.displayName,
  clientNumber: c.clientNumber,
  accountType: c.accountType === 'BUSINESS' ? 'BUSINESS' : 'INDIVIDUAL',
});

export function memberRefOf(names: Map<string, string>, id: string | null): MemberRef | null {
  const name = id ? names.get(id) : undefined;
  return id && name !== undefined ? { userId: id, name } : null;
}

export const skipTake = (q: { page: number; pageSize: number }) => ({
  skip: (q.page - 1) * q.pageSize,
  take: q.pageSize,
});

/** The profile a request names, when the caller reaches its client; 404 otherwise. */
export async function findProfile(
  tx: TxClient,
  businessId: string,
  actor: BookkeepingActor,
  id: string,
) {
  const row = await tx.bookkeepingProfile.findFirst({
    where: { businessId, id, engagement: reachEngagement(actor) },
    include: {
      engagement: {
        select: {
          id: true,
          clientId: true,
          status: true,
          package: true,
          assignedUserId: true,
          createdAt: true,
          client: { select: { ...clientRefSelect, email: true, phone: true } },
        },
      },
    },
  });
  if (!row) throw errors.notFound();
  return row;
}
export type ProfileRow = Awaited<ReturnType<typeof findProfile>>;

/** The profile of an engagement the caller reaches (for rows that hang off an engagement). */
export async function findProfileByEngagement(
  tx: TxClient,
  businessId: string,
  actor: BookkeepingActor,
  engagementId: string,
) {
  const row = await tx.bookkeepingProfile.findFirst({
    where: { businessId, engagementId, engagement: reachEngagement(actor) },
    select: { id: true, engagementId: true, status: true, statusSource: true },
  });
  if (!row) throw errors.notFound();
  return row;
}

// ---------- Row mappers ----------

export type ConnectionRow = Prisma.BookkeepingConnectionGetPayload<object>;

export const toConnection = (
  c: ConnectionRow,
  staleHours: number,
  now: Date,
): BookkeepingConnection => ({
  id: c.id,
  provider: c.provider,
  label: providerLabel(c.provider),
  providerCompanyId: c.providerCompanyId,
  companyName: c.companyName,
  status: c.status,
  syncStatus: syncStatusOf(c, staleHours, now),
  lastSyncAt: iso(c.lastSyncAt),
  lastSuccessfulSyncAt: iso(c.lastSuccessfulSyncAt),
  lastErrorCode: c.lastErrorCode,
  connectedAt: c.connectedAt.toISOString(),
  disconnectedAt: iso(c.disconnectedAt),
});

export const toAccount = (a: Prisma.BookkeepingAccountGetPayload<object>): BookkeepingAccount => ({
  id: a.id,
  name: a.name,
  type: a.type,
  institution: a.institution,
  mask: a.mask,
  connectionId: a.connectionId,
  currency: a.currency,
  balanceCents: a.balanceCents,
  balanceAsOf: iso(a.balanceAsOf),
  status: a.status,
  reconcile: a.reconcile,
  archived: a.archivedAt !== null,
});

export const periodSelect = {
  id: true,
  engagementId: true,
  kind: true,
  periodStart: true,
  periodEnd: true,
  label: true,
  status: true,
  closeByOn: true,
  closeVersion: true,
  incomeCents: true,
  expensesCents: true,
  figuresSource: true,
  figuresAsOf: true,
  uncategorizedCount: true,
  closeItems: { select: { required: true, completedAt: true } },
} satisfies Prisma.BookkeepingPeriodSelect;

export function toPeriodSummary(
  p: Prisma.BookkeepingPeriodGetPayload<{ select: typeof periodSelect }>,
  today: string,
): BookkeepingPeriodSummary {
  const required = p.closeItems.filter((i) => i.required);
  const closeBy = day(p.closeByOn);
  return {
    id: p.id,
    kind: p.kind,
    periodStart: day(p.periodStart) as string,
    periodEnd: day(p.periodEnd) as string,
    label: p.label,
    status: p.status,
    closeByOn: closeBy,
    closeVersion: p.closeVersion,
    overdue: p.status !== 'CLOSED' && closeBy !== null && closeBy < today,
    incomeCents: p.incomeCents,
    expensesCents: p.expensesCents,
    netProfitCents:
      p.incomeCents !== null && p.expensesCents !== null ? p.incomeCents - p.expensesCents : null,
    figuresSource: p.figuresSource,
    figuresAsOf: iso(p.figuresAsOf),
    uncategorizedCount: p.uncategorizedCount,
    progress: {
      done: p.closeItems.filter((i) => i.completedAt).length,
      total: p.closeItems.length,
      requiredDone: required.filter((i) => i.completedAt).length,
      requiredTotal: required.length,
    },
  };
}

export const reportSelect = {
  id: true,
  engagementId: true,
  periodId: true,
  reportType: true,
  customName: true,
  periodLabel: true,
  basis: true,
  dueOn: true,
  status: true,
  generatedAt: true,
  generatedByUserId: true,
  reviewedAt: true,
  reviewedByUserId: true,
  reviewNote: true,
  deliveredAt: true,
  deliveredByUserId: true,
  engagementReportId: true,
  engagement: {
    select: { bookkeepingProfile: { select: { id: true } }, client: { select: clientRefSelect } },
  },
} satisfies Prisma.BookkeepingReportSelect;

export function toReport(
  r: Prisma.BookkeepingReportGetPayload<{ select: typeof reportSelect }>,
  names: Map<string, string>,
  today: string,
): BookkeepingReportRow {
  const due = day(r.dueOn);
  return {
    id: r.id,
    bookkeepingClientId: r.engagement.bookkeepingProfile?.id as string,
    client: toClientRef(r.engagement.client),
    periodId: r.periodId,
    reportType: r.reportType,
    name: r.customName ?? REPORT_NAMES[r.reportType],
    customName: r.customName,
    periodLabel: r.periodLabel,
    basis: r.basis,
    dueOn: due,
    overdue: r.status !== 'DELIVERED' && due !== null && due < today,
    status: r.status,
    generatedAt: iso(r.generatedAt),
    generatedBy: memberRefOf(names, r.generatedByUserId),
    reviewedAt: iso(r.reviewedAt),
    reviewedBy: memberRefOf(names, r.reviewedByUserId),
    reviewNote: r.reviewNote,
    deliveredAt: iso(r.deliveredAt),
    deliveredBy: memberRefOf(names, r.deliveredByUserId),
    engagementReportId: r.engagementReportId,
  };
}

export const reportMemberIds = (
  rows: readonly {
    generatedByUserId: string | null;
    reviewedByUserId: string | null;
    deliveredByUserId: string | null;
  }[],
) => rows.flatMap((r) => [r.generatedByUserId, r.reviewedByUserId, r.deliveredByUserId]);

export const reconSelect = {
  id: true,
  periodId: true,
  statementStart: true,
  statementEnd: true,
  beginningBalanceCents: true,
  endingBalanceCents: true,
  clearedBalanceCents: true,
  clearedCount: true,
  differenceCents: true,
  toleranceCents: true,
  exceptionsCount: true,
  statementDocumentId: true,
  status: true,
  readyForReviewAt: true,
  approvedAt: true,
  approvedBy: true,
  reopenedAt: true,
  reopenReason: true,
  updatedAt: true,
  account: { select: { id: true, name: true, type: true, mask: true } },
} satisfies Prisma.BookkeepingReconciliationSelect;

export const toReconciliation = (
  r: Prisma.BookkeepingReconciliationGetPayload<{ select: typeof reconSelect }>,
  names: Map<string, string>,
): BookkeepingReconciliation => ({
  id: r.id,
  periodId: r.periodId,
  account: r.account,
  statementStart: day(r.statementStart) as string,
  statementEnd: day(r.statementEnd) as string,
  beginningBalanceCents: r.beginningBalanceCents,
  endingBalanceCents: r.endingBalanceCents,
  clearedBalanceCents: r.clearedBalanceCents,
  clearedCount: r.clearedCount,
  differenceCents: r.differenceCents,
  toleranceCents: r.toleranceCents,
  withinTolerance: Math.abs(r.differenceCents) <= r.toleranceCents,
  exceptionsCount: r.exceptionsCount,
  statementDocumentId: r.statementDocumentId,
  status: r.status,
  readyForReviewAt: iso(r.readyForReviewAt),
  approvedAt: iso(r.approvedAt),
  approvedBy: memberRefOf(names, r.approvedBy),
  reopenedAt: iso(r.reopenedAt),
  reopenReason: r.reopenReason,
  updatedAt: r.updatedAt.toISOString(),
});

export const toActivity = (
  a: {
    id: string;
    kind: BookkeepingActivity['kind'];
    summary: string;
    actorUserId: string | null;
    createdAt: Date;
  },
  names: Map<string, string>,
): BookkeepingActivity => ({
  id: a.id,
  kind: a.kind,
  summary: a.summary,
  actor: memberRefOf(names, a.actorUserId),
  createdAt: a.createdAt.toISOString(),
});

/** Writes one line of an engagement's bookkeeping history, in the caller's transaction. */
export async function addActivity(
  tx: TxClient,
  businessId: string,
  engagementId: string,
  actorUserId: string | null,
  kind: BookkeepingActivity['kind'],
  summary: string,
  details: Record<string, string | number | boolean | null> = {},
): Promise<void> {
  await tx.bookkeepingActivity.create({
    data: { businessId, engagementId, kind, summary, details, actorUserId },
  });
}

/**
 * Reads and locks a client's profile for a change: its client row FOR SHARE, the profile FOR NO
 * KEY UPDATE, so two changes to one client queue up and the second reads the first's result.
 * An archived client refuses changes unless `allowArchived`.
 */
export async function lockProfile(
  tx: TxClient,
  businessId: string,
  actor: BookkeepingActor,
  id: string,
  allowArchived = false,
) {
  const p = await findProfile(tx, businessId, actor, id);
  await lockClient(tx, businessId, p.engagement.clientId);
  await tx.$executeRaw`SELECT 1 FROM bookkeeping_profiles WHERE business_id = ${businessId}::uuid AND id = ${id}::uuid FOR NO KEY UPDATE`;
  const fresh = await tx.bookkeepingProfile.findFirstOrThrow({ where: { businessId, id } });
  if (fresh.archivedAt && !allowArchived) {
    throw errors.clientState('This bookkeeping client is archived');
  }
  return { ...fresh, engagement: p.engagement };
}

/** The profile behind an engagement the caller reaches, locked for a change (see lockProfile). */
export async function lockProfileOf(
  tx: TxClient,
  businessId: string,
  actor: BookkeepingActor,
  engagementId: string,
) {
  const p = await findProfileByEngagement(tx, businessId, actor, engagementId);
  return lockProfile(tx, businessId, actor, p.id);
}
