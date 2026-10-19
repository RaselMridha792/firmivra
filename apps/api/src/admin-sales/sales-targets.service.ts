import { Injectable } from '@nestjs/common';
import type { Prisma, TxClient } from '@firmivra/db';
import type {
  CreateSalesTargetRequest,
  SalesTarget,
  SalesTargetAttainment,
  SalesTargetList,
  SalesTargetMetric,
  SalesTargetsQuery,
  UpdateSalesTargetRequest,
} from '@firmivra/types';
import type { z } from 'zod';
import { AuditService } from '../audit/audit.service.js';
import { AdminPrisma } from '../firm-applications/admin-prisma.js';
import {
  asSalesError,
  loadContext,
  notFound,
  orNull,
  refuse,
  type SalesContext,
  SUBSCRIPTION_KIND,
} from './sales-common.js';
import { basisPoints, type Bounds, boundsOf, conversionOf, dayOf, within } from './sales-math.js';

type Out<S extends z.ZodType> = z.output<S>;

const asDate = (day: string) => new Date(`${day}T00:00:00.000Z`);
const range = (b: Bounds) => ({ gte: new Date(b.start), lt: new Date(b.end) });

const targetInclude = {
  department: { select: { id: true, name: true } },
} satisfies Prisma.SalesTargetInclude;
type TargetRow = Prisma.SalesTargetGetPayload<{ include: typeof targetInclude }>;

/** Whose records a target counts: everyone, a department's members, or one rep. */
type Subject = { kind: 'ALL' } | { kind: 'USERS'; ids: string[] };

/**
 * Super Admin Sales targets (R60 on R0's D1): one goal for the company, a team (a platform
 * department) or a rep over a period. Attainment is counted from B5's records for the target's
 * period and subject on every read, never stored. The subject, metric and period never change:
 * archive the target and create another.
 */
@Injectable()
export class SalesTargetsService {
  constructor(
    private readonly admin: AdminPrisma,
    private readonly audit: AuditService,
  ) {}

  list(query: Out<typeof SalesTargetsQuery>): Promise<SalesTargetList> {
    return this.admin.transaction(async (tx) => {
      const ctx = await loadContext(tx, this.admin.adminUserId);
      const on = asDate(query.on ?? dayOf(ctx.now));
      const rows = await tx.salesTarget.findMany({
        where: {
          archivedAt: null,
          periodStart: { lte: on },
          periodEnd: { gte: on },
          ...(query.scope ? { scope: query.scope } : {}),
          ...(query.metric ? { metric: query.metric } : {}),
          ...(query.periodType ? { periodType: query.periodType } : {}),
        },
        orderBy: [{ periodStart: 'asc' }, { name: 'asc' }, { id: 'asc' }],
        include: targetInclude,
      });
      const items: SalesTarget[] = [];
      for (const row of rows) items.push(await this.view(tx, ctx, row));
      return { items };
    });
  }

  create(body: Out<typeof CreateSalesTargetRequest>): Promise<SalesTarget> {
    return this.run(async (tx, ctx) => {
      if (body.scope === 'TEAM') {
        const team = await tx.platformDepartment.findUnique({ where: { id: body.teamId! } });
        if (!team?.isActive) throw refuse('TEAM_INACTIVE');
      }
      if (body.scope === 'REP') {
        const rep = await tx.platformAdmin.findUnique({ where: { userId: body.repId! } });
        if (!rep) throw refuse('INACTIVE_CHOICE', 'Choose a member of the sales team.');
      }
      const subject = {
        scope: body.scope,
        departmentId: body.scope === 'TEAM' ? body.teamId : null,
        userId: body.scope === 'REP' ? body.repId : null,
        metric: body.metric,
        periodStart: asDate(body.periodStart),
        periodEnd: asDate(body.periodEnd),
      };
      const live = await tx.salesTarget.findFirst({
        where: { ...subject, archivedAt: null },
        select: { id: true },
      });
      if (live) throw refuse('TARGET_EXISTS');
      const row = await tx.salesTarget.create({
        data: {
          ...subject,
          name: body.name,
          targetValue: body.targetValue,
          periodType: body.periodType,
          note: orNull(body.note),
        },
        include: targetInclude,
      });
      await this.log(tx, 'sales_target.created', row.id, {
        scope: row.scope,
        departmentId: row.departmentId,
        userId: row.userId,
        metric: row.metric,
        periodType: row.periodType,
        periodStart: body.periodStart,
        periodEnd: body.periodEnd,
        targetValue: row.targetValue,
      });
      return this.view(tx, ctx, row);
    });
  }

  update(id: string, body: Out<typeof UpdateSalesTargetRequest>): Promise<SalesTarget> {
    return this.run(async (tx, ctx) => {
      const row = await this.live(tx, id);
      if (
        body.targetValue !== undefined &&
        row.metric === 'CONVERSION_RATE' &&
        body.targetValue > 10_000
      )
        throw refuse('INVALID_TARGET_VALUE');
      const data: Prisma.SalesTargetUpdateInput = {
        ...(body.name !== undefined ? { name: body.name } : {}),
        ...(body.targetValue !== undefined ? { targetValue: body.targetValue } : {}),
        ...(body.note !== undefined ? { note: orNull(body.note) } : {}),
      };
      const saved = await tx.salesTarget.update({ where: { id }, data, include: targetInclude });
      await this.log(tx, 'sales_target.updated', id, {
        fields: Object.keys(data),
        targetValue: saved.targetValue,
      });
      return this.view(tx, ctx, saved);
    });
  }

  archive(id: string): Promise<SalesTarget> {
    return this.run(async (tx, ctx) => {
      await this.live(tx, id);
      const saved = await tx.salesTarget.update({
        where: { id },
        data: { archivedAt: new Date(ctx.now) },
        include: targetInclude,
      });
      await this.log(tx, 'sales_target.archived', id, {});
      return this.view(tx, ctx, saved);
    });
  }

  // ---------- Helpers ----------

  private async run<T>(work: (tx: TxClient, ctx: SalesContext) => Promise<T>): Promise<T> {
    try {
      return await this.admin.transaction(async (tx) =>
        work(tx, await loadContext(tx, this.admin.adminUserId)),
      );
    } catch (error) {
      throw asSalesError(error, { unique: 'TARGET_EXISTS', foreignKey: 'TEAM_INACTIVE' });
    }
  }

  private log(tx: TxClient, action: string, id: string, metadata: Record<string, unknown>) {
    return this.audit.logIn(tx, action, { type: 'sales_target', id }, metadata, {
      businessId: null,
    });
  }

  /** A live target (409 TARGET_ARCHIVED once archived). */
  private async live(tx: TxClient, id: string) {
    const row = await tx.salesTarget.findUnique({ where: { id } });
    if (!row) throw notFound('Target');
    if (row.archivedAt) throw refuse('TARGET_ARCHIVED');
    return row;
  }

  private async view(tx: TxClient, ctx: SalesContext, row: TargetRow): Promise<SalesTarget> {
    const start = dayOf(row.periodStart.getTime());
    const end = dayOf(row.periodEnd.getTime());
    const bounds = boundsOf(start, end);
    const subject: Subject =
      row.scope === 'COMPANY'
        ? { kind: 'ALL' }
        : row.scope === 'REP'
          ? { kind: 'USERS', ids: row.userId ? [row.userId] : [] }
          : {
              kind: 'USERS',
              ids: (
                await tx.platformMember.findMany({
                  where: { departmentId: row.departmentId ?? undefined },
                  select: { userId: true },
                })
              ).map((m) => m.userId),
            };
    const actual = await measure(tx, row.metric, bounds, subject);
    return {
      id: row.id,
      name: row.name,
      scope: row.scope,
      team: row.department,
      rep: row.userId ? { id: row.userId, name: ctx.nameOf(row.userId) } : null,
      metric: row.metric,
      targetValue: row.targetValue,
      periodType: row.periodType,
      periodStart: start,
      periodEnd: end,
      note: row.note,
      archivedAt: row.archivedAt ? row.archivedAt.toISOString() : null,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      attainment: attainmentOf(row.metric, actual, row.targetValue, bounds, ctx.now),
    };
  }
}

/** D1's progress: the goal's share reached, the period's share elapsed, and whether on pace. */
export function attainmentOf(
  metric: SalesTargetMetric,
  actual: number,
  goal: number,
  bounds: Bounds,
  now: number,
): SalesTargetAttainment {
  const elapsed = Math.min(1, Math.max(0, (now - bounds.start) / (bounds.end - bounds.start)));
  const progressBp = basisPoints(actual, goal);
  const elapsedBp = Math.round(elapsed * 10_000);
  return {
    actual,
    progressBp,
    elapsedBp,
    onPace: metric === 'CONVERSION_RATE' ? actual >= goal : progressBp >= elapsedBp,
    ended: now >= bounds.end,
  };
}

/** D1's metric for the period and subject, from the records. */
async function measure(
  tx: TxClient,
  metric: SalesTargetMetric,
  bounds: Bounds,
  subject: Subject,
): Promise<number> {
  const owned: Prisma.SalesOpportunityWhereInput =
    subject.kind === 'ALL' ? {} : { assignedToUserId: { in: subject.ids } };
  switch (metric) {
    case 'NEW_LEADS':
      return tx.salesOpportunity.count({ where: { ...owned, createdAt: range(bounds) } });
    case 'WON_DEALS':
      return tx.salesOpportunity.count({ where: { ...owned, convertedAt: range(bounds) } });
    case 'REVENUE_WON': {
      const sum = await tx.salesOpportunity.aggregate({
        where: { ...owned, convertedAt: range(bounds) },
        _sum: { valueCents: true },
      });
      return sum._sum.valueCents ?? 0;
    }
    case 'CONVERSION_RATE': {
      const rows = await tx.salesOpportunity.findMany({
        where: { ...owned, createdAt: range(bounds) },
        select: { convertedAt: true, lostReason: true },
      });
      return conversionOf(rows).rateBp;
    }
    case 'DEMOS_SCHEDULED':
      return tx.salesFollowUp.count({
        where: {
          kind: 'DEMO',
          status: { not: 'CANCELLED' },
          dueAt: range(bounds),
          ...(subject.kind === 'ALL' ? {} : { assignedToUserId: { in: subject.ids } }),
        },
      });
    case 'OUTBOUND_ACTIVITIES':
      return tx.salesActivity.count({
        where: {
          direction: 'OUTBOUND',
          occurredAt: range(bounds),
          ...(subject.kind === 'ALL' ? {} : { actorUserId: { in: subject.ids } }),
        },
      });
    case 'TRIALS_STARTED': {
      const linked = await tx.salesOpportunity.findMany({
        where: { ...owned, transactionKind: SUBSCRIPTION_KIND, transactionId: { not: null } },
        select: { transactionId: true },
      });
      if (!linked.length) return 0;
      const subs = await tx.platformFirmSubscription.findMany({
        where: { id: { in: linked.map((l) => l.transactionId!) } },
        select: { trialStartedAt: true },
      });
      return subs.filter((s) => within(s.trialStartedAt, bounds)).length;
    }
  }
}
