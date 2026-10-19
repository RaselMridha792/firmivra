import { Injectable } from '@nestjs/common';
import type { Prisma } from '@firmivra/db';
import type { AdvisoryReports } from '@firmivra/types';
import type { z } from 'zod';
import type { TenantContext } from '../common/request-context.js';
import { memberNames, memberRef } from '../workspaces/common.js';
import { AdvisoryReadService, advisoryAppointment } from './advisory-read.service.js';
import type { ReportsQuery } from './advisory-input.js';
import { DISCLAIMER, effectiveGoalStatus, OPEN_GOAL_STATUSES } from './advisory.common.js';

type Out<S extends z.ZodType> = z.output<S>;

const DAY = 86_400_000;
const OPEN_ACTION = ['NOT_STARTED', 'IN_PROGRESS'] as const;
const CLIENT_ORDER = [
  'IN_PROGRESS',
  'SCHEDULED',
  'NEEDS_REVIEW',
  'ON_HOLD',
  'COMPLETED',
  'ARCHIVED',
] as const;
const PLAN_ORDER = [
  'DRAFT',
  'IN_REVIEW',
  'FINALIZED',
  'SENT',
  'IN_PROGRESS',
  'COMPLETED',
  'ARCHIVED',
] as const;
const GOAL_ORDER = [
  'NOT_STARTED',
  'PLANNING',
  'IN_PROGRESS',
  'ON_TRACK',
  'AT_RISK',
  'OVERDUE',
  'COMPLETED',
  'CANCELLED',
] as const;
const REC_ORDER = [
  'PROPOSED',
  'ACCEPTED',
  'IN_PROGRESS',
  'IMPLEMENTED',
  'NOT_APPLICABLE',
  'DECLINED',
] as const;

/** Each status of `order` that occurs, with its count, in that order. */
const tally = <T extends string>(order: readonly T[], values: readonly string[]) =>
  order
    .map((status) => ({ status, count: values.filter((v) => v === status).length }))
    .filter((x) => x.count > 0);
const sumOrNull = (values: (number | null)[]): number | null => {
  const known = values.filter((v): v is number => v !== null);
  return known.length ? known.reduce((n, v) => n + v, 0) : null;
};
const isOpenAction = (status: string) => (OPEN_ACTION as readonly string[]).includes(status);

/**
 * The Reports tab (GET .../reports): live counts over the advisory clients the caller reaches,
 * optionally for one advisor. Archived clients and their records are left out. A read: not audited.
 */
@Injectable()
export class AdvisoryReportsService {
  constructor(private readonly read: AdvisoryReadService) {}

  reports(
    businessId: string,
    tenant: TenantContext,
    userId: string,
    q: Out<typeof ReportsQuery>,
  ): Promise<AdvisoryReports> {
    return this.read.inFirm(businessId, async (tx) => {
      const ctx = await this.read.ctx(tx, businessId, tenant, userId);
      const now = new Date();
      const today = new Date(`${ctx.today}T00:00:00.000Z`);
      const year = Number(ctx.today.slice(0, 4));
      const scope: Prisma.AdvisoryClientWhereInput = {
        ...this.read.reach(ctx),
        archivedAt: null,
        ...(q.advisorUserId ? { advisorUserId: q.advisorUserId } : {}),
      };
      const inScope = { businessId, advisoryClient: scope };
      const meetingClient: Prisma.ClientWhereInput = {
        advisoryRecords: {
          some: {
            archivedAt: null,
            ...(q.advisorUserId ? { advisorUserId: q.advisorUserId } : {}),
          },
        },
        ...(ctx.reachOnly ? { assignedUserId: ctx.actor.userId } : {}),
      };

      const [clients, workstreams, plans, sentThisYear, goals, recs, actions] = await Promise.all([
        tx.advisoryClient.findMany({
          where: { businessId, ...scope },
          select: { id: true, clientId: true, status: true, advisorUserId: true },
          take: 10_000,
        }),
        tx.advisoryWorkstream.findMany({
          where: inScope,
          select: {
            serviceId: true,
            role: true,
            status: true,
            service: { select: { name: true } },
          },
          take: 50_000,
        }),
        tx.advisoryPlan.findMany({
          where: inScope,
          select: { advisoryClientId: true, status: true, archivedAt: true },
          take: 50_000,
        }),
        tx.advisoryPlanVersion.count({
          where: {
            businessId,
            plan: { advisoryClient: scope },
            deliveredAt: { gte: new Date(`${year}-01-01T00:00:00.000Z`) },
          },
        }),
        tx.advisoryGoal.findMany({
          where: { ...inScope, archivedAt: null },
          select: { advisoryClientId: true, status: true, targetDate: true, progressPercent: true },
          take: 50_000,
        }),
        tx.advisoryRecommendation.findMany({
          where: inScope,
          select: { status: true, impactCents: true },
          take: 50_000,
        }),
        tx.advisoryActionItem.findMany({
          where: inScope,
          select: {
            advisoryClientId: true,
            status: true,
            dueOn: true,
            completedAt: true,
            assigneeKind: true,
          },
          take: 50_000,
        }),
      ]);
      const [upcoming, past90Days] = await Promise.all([
        tx.appointment.findMany({
          where: {
            businessId,
            ...advisoryAppointment,
            client: meetingClient,
            status: 'SCHEDULED',
            startsAt: { gte: now, lte: new Date(now.getTime() + 30 * DAY) },
          },
          select: { clientId: true },
          take: 10_000,
        }),
        tx.appointment.count({
          where: {
            businessId,
            ...advisoryAppointment,
            client: meetingClient,
            status: { not: 'CANCELLED' },
            startsAt: { gte: new Date(now.getTime() - 90 * DAY), lt: now },
          },
        }),
      ]);

      // Services in use.
      const services = new Map<string, AdvisoryReports['services'][number]>();
      for (const w of workstreams) {
        const row = services.get(w.serviceId) ?? {
          serviceId: w.serviceId,
          name: w.service.name,
          primary: 0,
          additional: 0,
          inProgress: 0,
          completed: 0,
        };
        if (w.role === 'PRIMARY') row.primary++;
        else row.additional++;
        if (w.status === 'IN_PROGRESS') row.inProgress++;
        if (w.status === 'COMPLETED') row.completed++;
        services.set(w.serviceId, row);
      }

      // Goals as shown (an open one past its target date is overdue).
      const shown = goals.map((g) => ({
        ...g,
        shown: effectiveGoalStatus(g.status, g.targetDate, ctx.today),
        open: (OPEN_GOAL_STATUSES as readonly string[]).includes(g.status),
      }));
      const openGoals = shown.filter((g) => g.open);
      const planStatus = (p: (typeof plans)[number]) => (p.archivedAt ? 'ARCHIVED' : p.status);
      const overdue = (a: (typeof actions)[number]) =>
        isOpenAction(a.status) && a.dueOn !== null && a.dueOn < today;
      const implemented = recs.filter((r) => r.status === 'IMPLEMENTED');

      // The yearly trend of the current figures (the newest row of each client and period).
      let financialTrend: AdvisoryReports['financialTrend'] = null;
      if (ctx.perms.viewFinancials) {
        const rows = await tx.advisoryFinancialSnapshot.findMany({
          where: {
            ...inScope,
            periodEnd: {
              gte: new Date(`${year - 3}-01-01T00:00:00.000Z`),
              lt: new Date(`${year}-01-01T00:00:00.000Z`),
            },
          },
          select: {
            advisoryClientId: true,
            periodStart: true,
            periodEnd: true,
            revenueCents: true,
            expensesCents: true,
            netProfitCents: true,
          },
          orderBy: [
            { periodEnd: 'desc' },
            { periodStart: 'desc' },
            { createdAt: 'desc' },
            { id: 'desc' },
          ],
          take: 50_000,
        });
        const seen = new Set<string>();
        const current = rows.filter((r) => {
          const key = `${r.advisoryClientId}|${r.periodStart.toISOString()}|${r.periodEnd.toISOString()}`;
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        });
        financialTrend = [year - 3, year - 2, year - 1].map((y) => {
          const inYear = current.filter((r) => r.periodEnd.getUTCFullYear() === y);
          return {
            year: y,
            clients: new Set(inYear.map((r) => r.advisoryClientId)).size,
            revenueCents: sumOrNull(inYear.map((r) => r.revenueCents)),
            expensesCents: sumOrNull(inYear.map((r) => r.expensesCents)),
            netProfitCents: sumOrNull(inYear.map((r) => r.netProfitCents)),
          };
        });
      }

      // Each advisor's workload.
      const names = await memberNames(
        tx,
        businessId,
        clients.map((c) => c.advisorUserId),
      );
      const advisoryOf = new Map(clients.map((c) => [c.clientId, c.id]));
      const meetingsOf = new Map<string, number>();
      for (const a of upcoming) {
        const id = a.clientId ? advisoryOf.get(a.clientId) : undefined;
        if (id) meetingsOf.set(id, (meetingsOf.get(id) ?? 0) + 1);
      }
      const workload = new Map<string, AdvisoryReports['advisorWorkload'][number]>();
      for (const c of clients) {
        const advisor = memberRef(names, c.advisorUserId);
        const key = advisor?.userId ?? 'none';
        const row = workload.get(key) ?? {
          advisor,
          clients: 0,
          activePlans: 0,
          openGoals: 0,
          openActionItems: 0,
          upcomingMeetings: 0,
        };
        row.clients++;
        row.activePlans += plans.filter(
          (p) =>
            p.advisoryClientId === c.id &&
            planStatus(p) !== 'COMPLETED' &&
            planStatus(p) !== 'ARCHIVED',
        ).length;
        row.openGoals += openGoals.filter((g) => g.advisoryClientId === c.id).length;
        row.openActionItems += actions.filter(
          (a) => a.advisoryClientId === c.id && isOpenAction(a.status),
        ).length;
        row.upcomingMeetings += meetingsOf.get(c.id) ?? 0;
        workload.set(key, row);
      }

      return {
        generatedAt: now.toISOString(),
        clients: {
          total: clients.length,
          byStatus: tally(
            CLIENT_ORDER,
            clients.map((c) => c.status),
          ),
        },
        plans: {
          total: plans.length,
          byStatus: tally(PLAN_ORDER, plans.map(planStatus)),
          sentThisYear,
        },
        services: [...services.values()].sort(
          (a, b) =>
            b.primary + b.additional - (a.primary + a.additional) || a.name.localeCompare(b.name),
        ),
        goals: {
          total: goals.length,
          byStatus: tally(
            GOAL_ORDER,
            shown.map((g) => g.shown),
          ),
          averageProgress: openGoals.length
            ? Math.round(openGoals.reduce((n, g) => n + g.progressPercent, 0) / openGoals.length)
            : null,
        },
        recommendations: {
          total: recs.length,
          byStatus: tally(
            REC_ORDER,
            recs.map((r) => r.status),
          ),
          implementedImpactCents: sumOrNull(implemented.map((r) => r.impactCents)),
        },
        actionItems: {
          open: actions.filter((a) => isOpenAction(a.status)).length,
          overdue: actions.filter(overdue).length,
          doneLast30Days: actions.filter(
            (a) =>
              a.status === 'DONE' &&
              a.completedAt !== null &&
              a.completedAt.getTime() >= now.getTime() - 30 * DAY,
          ).length,
          byAssignee: (['STAFF', 'CLIENT', 'TEAM'] as const).map((kind) => ({
            kind,
            open: actions.filter((a) => a.assigneeKind === kind && isOpenAction(a.status)).length,
          })),
        },
        meetings: { upcoming30Days: upcoming.length, past90Days },
        financialTrend,
        advisorWorkload: [...workload.values()].sort(
          (a, b) =>
            b.clients - a.clients || (a.advisor?.name ?? '~').localeCompare(b.advisor?.name ?? '~'),
        ),
        canViewFinancials: ctx.perms.viewFinancials,
        disclaimer: DISCLAIMER,
      };
    });
  }
}
