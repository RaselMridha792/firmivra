import { Inject, Injectable } from '@nestjs/common';
import type { Database, Prisma, TxClient } from '@firmivra/db';
import type {
  AdvisoryActionItemRow,
  AdvisoryClientRow,
  AdvisoryFinancialRow,
  AdvisoryGoalRow,
  AdvisoryMilestone,
  AdvisoryPlanRow,
  AdvisoryRecommendationRow,
  AdvisoryWorkstream,
} from '@firmivra/types';
import { firmTimeZone } from '../appointments/calendar-data.js';
import { legacyFirmRole, type TenantContext } from '../common/request-context.js';
import { DATABASE } from '../database/database.module.js';
import { day, memberNames, memberRef, notFound } from '../workspaces/common.js';
import {
  clientRef,
  clientRefSelect,
  effectiveGoalStatus,
  iso,
  type Perms,
  permsOf,
  todayIn,
} from './advisory.common.js';
import { computeHealth, formulaOf, type HealthInput } from './health.js';

export interface AdvisoryCtx {
  tx: TxClient;
  businessId: string;
  tenant: TenantContext;
  timezone: string;
  today: string;
  actor: { userId: string; role: 'OWNER' | 'ADMIN' | 'STAFF' };
  /** Staff reach only the clients assigned to them. */
  reachOnly: boolean;
  perms: Perms;
  settings: {
    formula: { factor: string; weight: number }[];
    staleFinancialsDays: number;
    defaultAdvisorId: string | null;
    updatedAt: Date | null;
  };
}

export const clientInclude = {
  client: {
    select: {
      ...clientRefSelect,
      profile: {
        select: {
          businessName: true,
          entityType: true,
          addressLine1: true,
          addressLine2: true,
          city: true,
          state: true,
          postalCode: true,
          country: true,
          einLast4: true,
        },
      },
    },
  },
  workstreams: {
    include: { service: { select: { name: true } } },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  },
} satisfies Prisma.AdvisoryClientInclude;
export type ClientShape = Prisma.AdvisoryClientGetPayload<{ include: typeof clientInclude }>;

/** An appointment tagged Business Advisory: its service, or its engagement's, is Business Development. */
export const advisoryAppointment = {
  OR: [
    { service: { kind: 'BUSINESS_DEVELOPMENT' } },
    { engagement: { service: { kind: 'BUSINESS_DEVELOPMENT' } } },
  ],
} satisfies Prisma.AppointmentWhereInput;

const OPEN_ACTION = ['NOT_STARTED', 'IN_PROGRESS'] as const;

/** Reads for the Business Advisory module: one shape for every list, detail and answer to a change. */
@Injectable()
export class AdvisoryReadService {
  constructor(@Inject(DATABASE) private readonly database: Database) {}

  inFirm<T>(businessId: string, fn: (tx: TxClient) => Promise<T>): Promise<T> {
    return this.database.withScope({ kind: 'business', businessId }, fn);
  }

  async ctx(
    tx: TxClient,
    businessId: string,
    tenant: TenantContext,
    userId: string,
  ): Promise<AdvisoryCtx> {
    const role = tenant.kind === 'staff' ? legacyFirmRole(tenant.role) : 'STAFF';
    const [timezone, settings] = await Promise.all([
      firmTimeZone(tx, businessId),
      tx.advisorySettings.findUnique({ where: { businessId } }),
    ]);
    return {
      tx,
      businessId,
      tenant,
      timezone,
      today: todayIn(timezone),
      actor: { userId, role },
      reachOnly: role === 'STAFF',
      perms: permsOf(tenant),
      settings: {
        formula: formulaOf(settings?.healthFormula),
        staleFinancialsDays: settings?.staleFinancialsDays ?? 120,
        defaultAdvisorId: settings?.defaultAdvisorId ?? null,
        updatedAt: settings?.updatedAt ?? null,
      },
    };
  }

  /** The advisory clients the caller reaches: those of the clients assigned to them, for Staff. */
  reach(ctx: AdvisoryCtx): Prisma.AdvisoryClientWhereInput {
    return ctx.reachOnly ? { client: { assignedUserId: ctx.actor.userId } } : {};
  }

  /** The caller's advisory client, or 404. */
  async loadClient(ctx: AdvisoryCtx, id: string): Promise<ClientShape> {
    const c = await ctx.tx.advisoryClient.findFirst({
      where: { businessId: ctx.businessId, id, ...this.reach(ctx) },
      include: clientInclude,
    });
    if (!c) throw notFound();
    return c;
  }

  /** The client locked for a change (FOR UPDATE), loaded through the caller's reach. */
  async lockClient(ctx: AdvisoryCtx, id: string): Promise<ClientShape> {
    await this.loadClient(ctx, id);
    await ctx.tx.$queryRaw`
      SELECT 1 FROM advisory_clients WHERE business_id = ${ctx.businessId}::uuid AND id = ${id}::uuid
      FOR UPDATE`;
    return this.loadClient(ctx, id);
  }

  // ---------- Shapes ----------

  workstream(w: ClientShape['workstreams'][number], open = 0): AdvisoryWorkstream {
    return {
      id: w.id,
      serviceId: w.serviceId,
      serviceName: w.service.name,
      role: w.role,
      status: w.status,
      packageName: w.packageName,
      startedOn: day(w.startedOn),
      completedOn: day(w.completedOn),
      openItems: open,
    };
  }

  /** Rows of the Advisory Clients tab and the overview. */
  async clientRows(ctx: AdvisoryCtx, shapes: ClientShape[]): Promise<AdvisoryClientRow[]> {
    const { tx, businessId } = ctx;
    if (shapes.length === 0) return [];
    const clientIds = shapes.map((s) => s.clientId);
    const [appts, names] = await Promise.all([
      tx.appointment.groupBy({
        by: ['clientId'],
        where: {
          businessId,
          clientId: { in: clientIds },
          status: 'SCHEDULED',
          startsAt: { gte: new Date() },
          ...advisoryAppointment,
        },
        _min: { startsAt: true },
      }),
      memberNames(
        tx,
        businessId,
        shapes.map((s) => s.advisorUserId),
      ),
    ]);
    const next = new Map(appts.map((a) => [a.clientId, a._min.startsAt]));
    return shapes.map((s) => {
      const primary = s.workstreams.find((w) => w.role === 'PRIMARY');
      return {
        id: s.id,
        client: clientRef(s.client),
        businessName:
          s.client.profile?.businessName ??
          (s.client.accountType === 'BUSINESS' ? s.client.displayName : null),
        industry: s.industry,
        businessStage: s.businessStage,
        primaryService: primary
          ? { serviceId: primary.serviceId, name: primary.service.name }
          : null,
        additionalServiceCount: s.workstreams.filter(
          (w) => w.role === 'ADDITIONAL' && w.status !== 'DECLINED',
        ).length,
        nextMeetingAt: iso(next.get(s.clientId) ?? null),
        status: s.status,
        advisor: memberRef(names, s.advisorUserId),
        healthScore: s.healthScore,
        since: day(s.since),
        archived: s.archivedAt !== null,
      };
    });
  }

  financialRow(
    ctx: AdvisoryCtx,
    f: Prisma.AdvisoryFinancialSnapshotGetPayload<object>,
    names: Map<string, string>,
  ): AdvisoryFinancialRow {
    const margin =
      f.revenueCents !== null && f.revenueCents > 0 && f.netProfitCents !== null
        ? Math.round((f.netProfitCents / f.revenueCents) * 1000) / 10
        : null;
    const ageDays = (Date.parse(`${ctx.today}T00:00:00Z`) - f.asOf.getTime()) / 86_400_000;
    return {
      id: f.id,
      advisoryClientId: f.advisoryClientId,
      planId: f.planId,
      periodStart: day(f.periodStart) as string,
      periodEnd: day(f.periodEnd) as string,
      revenueCents: f.revenueCents,
      expensesCents: f.expensesCents,
      netProfitCents: f.netProfitCents,
      marginPercent: margin,
      cashFlowCents: f.cashFlowCents,
      debtCents: f.debtCents,
      budgetRevenueCents: f.budgetRevenueCents,
      budgetExpensesCents: f.budgetExpensesCents,
      headcount: f.headcount,
      source: f.source,
      asOf: day(f.asOf) as string,
      overridden: f.overridden,
      overrideReason: f.overrideReason,
      overriddenBy: memberRef(names, f.overriddenByUserId),
      stale: ageDays > ctx.settings.staleFinancialsDays,
      createdAt: f.createdAt.toISOString(),
    };
  }

  /** The newest snapshot of each period of a client, newest period first. */
  async latestSnapshots(ctx: AdvisoryCtx, advisoryClientId: string, take = 24) {
    const rows = await ctx.tx.advisoryFinancialSnapshot.findMany({
      where: { businessId: ctx.businessId, advisoryClientId },
      orderBy: [
        { periodEnd: 'desc' },
        { periodStart: 'desc' },
        { createdAt: 'desc' },
        { id: 'desc' },
      ],
      take: 500,
    });
    const seen = new Set<string>();
    const out: typeof rows = [];
    for (const r of rows) {
      const key = `${r.periodStart.toISOString()}|${r.periodEnd.toISOString()}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(r);
      if (out.length === take) break;
    }
    return out;
  }

  planRow(
    p: Prisma.AdvisoryPlanGetPayload<{
      include: { advisoryClient: { include: typeof clientInclude } };
    }>,
    names: Map<string, string>,
  ): AdvisoryPlanRow {
    return {
      id: p.id,
      advisoryClientId: p.advisoryClientId,
      client: clientRef(p.advisoryClient.client),
      name: p.name,
      targetYear: p.targetYear,
      planType: p.planType,
      status: p.status,
      advisor: memberRef(names, p.advisoryClient.advisorUserId),
      step: p.step,
      currentVersion: p.currentVersion,
      finalizedAt: iso(p.finalizedAt),
      sentAt: iso(p.sentAt),
      archived: p.archivedAt !== null,
      updatedAt: p.updatedAt.toISOString(),
    };
  }

  async goalRows(
    ctx: AdvisoryCtx,
    goals: Prisma.AdvisoryGoalGetPayload<{
      include: {
        advisoryClient: { select: { client: { select: typeof clientRefSelect } } };
        milestones: { select: { status: true } };
      };
    }>[],
  ): Promise<AdvisoryGoalRow[]> {
    const names = await memberNames(
      ctx.tx,
      ctx.businessId,
      goals.map((g) => g.ownerUserId),
    );
    return goals.map((g) => ({
      id: g.id,
      advisoryClientId: g.advisoryClientId,
      client: clientRef(g.advisoryClient.client),
      title: g.title,
      area: g.area,
      targetDate: day(g.targetDate),
      status: effectiveGoalStatus(g.status, g.targetDate, ctx.today),
      progressPercent: g.progressPercent,
      owner: memberRef(names, g.ownerUserId),
      planId: g.planId,
      workstreamId: g.workstreamId,
      milestoneCount: g.milestones.length,
      milestonesDone: g.milestones.filter((m) => m.status === 'COMPLETED').length,
      archived: g.archivedAt !== null,
      updatedAt: g.updatedAt.toISOString(),
    }));
  }

  milestone(
    ctx: AdvisoryCtx,
    m: Prisma.AdvisoryMilestoneGetPayload<object>,
    names: Map<string, string>,
  ): AdvisoryMilestone {
    return {
      id: m.id,
      goalId: m.goalId,
      title: m.title,
      targetDate: day(m.targetDate),
      status: effectiveGoalStatus(m.status, m.targetDate, ctx.today),
      progressPercent: m.progressPercent,
      owner: memberRef(names, m.ownerUserId),
      sortOrder: m.sortOrder,
      completedAt: iso(m.completedAt),
    };
  }

  async recRows(
    ctx: AdvisoryCtx,
    rows: Prisma.AdvisoryRecommendationGetPayload<object>[],
  ): Promise<AdvisoryRecommendationRow[]> {
    const names = await memberNames(
      ctx.tx,
      ctx.businessId,
      rows.map((r) => r.createdByUserId),
    );
    return rows.map((r) => ({
      id: r.id,
      advisoryClientId: r.advisoryClientId,
      planId: r.planId,
      goalId: r.goalId,
      title: r.title,
      category: r.category,
      rationale: r.rationale,
      impactLabel: r.impactLabel,
      impactCents: r.impactCents,
      status: r.status,
      clientVisible: r.clientVisible,
      decidedAt: iso(r.decidedAt),
      createdBy: memberRef(names, r.createdByUserId),
      updatedAt: r.updatedAt.toISOString(),
    }));
  }

  async actionRows(
    ctx: AdvisoryCtx,
    rows: Prisma.AdvisoryActionItemGetPayload<{
      include: { advisoryClient: { select: { client: { select: typeof clientRefSelect } } } };
    }>[],
  ): Promise<AdvisoryActionItemRow[]> {
    const names = await memberNames(
      ctx.tx,
      ctx.businessId,
      rows.map((r) => r.assigneeUserId),
    );
    return rows.map((r) => ({
      id: r.id,
      advisoryClientId: r.advisoryClientId,
      client: clientRef(r.advisoryClient.client),
      planId: r.planId,
      goalId: r.goalId,
      milestoneId: r.milestoneId,
      title: r.title,
      details: r.details,
      assigneeKind: r.assigneeKind,
      assignee: memberRef(names, r.assigneeUserId),
      dueOn: day(r.dueOn),
      priority: r.priority,
      status: r.status,
      overdue:
        r.dueOn !== null &&
        (OPEN_ACTION as readonly string[]).includes(r.status) &&
        day(r.dueOn)! < ctx.today,
      clientVisible: r.clientVisible,
      completedAt: iso(r.completedAt),
      updatedAt: r.updatedAt.toISOString(),
    }));
  }

  // ---------- The Business Health Score ----------

  /** Works the score out again from the client's figures, goals and action items, and keeps it with its factors. */
  async recomputeHealth(ctx: AdvisoryCtx, advisoryClientId: string): Promise<void> {
    const { tx, businessId } = ctx;
    const [snapshots, goals, actions] = await Promise.all([
      this.latestSnapshots(ctx, advisoryClientId, 2),
      tx.advisoryGoal.findMany({
        where: { businessId, advisoryClientId, archivedAt: null },
        select: { status: true, progressPercent: true },
      }),
      tx.advisoryActionItem.groupBy({
        by: ['status'],
        where: { businessId, advisoryClientId },
        _count: { _all: true },
      }),
    ]);
    const counted = actions.filter((a) => a.status !== 'CANCELLED');
    const input: HealthInput = {
      periods: snapshots.map((s) => ({
        revenueCents: s.revenueCents,
        netProfitCents: s.netProfitCents,
        cashFlowCents: s.cashFlowCents,
        debtCents: s.debtCents,
        budgetRevenueCents: s.budgetRevenueCents,
      })),
      goalProgress: goals
        .filter((g) => g.status !== 'CANCELLED' && g.status !== 'COMPLETED')
        .map((g) => g.progressPercent),
      actionsDone: counted.find((a) => a.status === 'DONE')?._count._all ?? 0,
      actionsCounted: counted.reduce((n, a) => n + a._count._all, 0),
    };
    const { score, factors } = computeHealth(ctx.settings.formula, input);
    // The score is not a change a person made: the client's version (etag) stays as it was.
    const cur = await tx.advisoryClient.findFirstOrThrow({
      where: { businessId, id: advisoryClientId },
      select: { updatedAt: true },
    });
    await tx.advisoryClient.update({
      where: { businessId_id: { businessId, id: advisoryClientId } },
      data: {
        updatedAt: cur.updatedAt,
        healthScore: score,
        healthFactors: factors as unknown as Prisma.InputJsonValue,
        healthComputedAt: score === null ? null : new Date(),
      },
      select: { id: true },
    });
  }
}
