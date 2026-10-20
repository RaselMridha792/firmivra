import { Injectable } from '@nestjs/common';
import type { Prisma } from '@firmivra/db';
import {
  SALES_LEAD_SOURCE_LABELS,
  SalesLostReason,
  type SalesCenterSummary,
  type SalesFeedList,
  type SalesFeedQuery,
  type SalesFollowUpList,
  type SalesLeadSources,
  type SalesPeriodQuery,
  type SalesRevenueByPlan,
  type SalesStageCounts,
  type SalesStageType,
  salesStageTone,
  type SalesUpcomingQuery,
} from '@firmivra/types';
import type { z } from 'zod';
import { AuditService } from '../audit/audit.service.js';
import { AdminPrisma } from '../firm-applications/admin-prisma.js';
import {
  defaultPipelineId,
  followUpSelect,
  followUpView,
  loadContext,
  notFound,
  stageOrder,
  stageSelect,
  SUBSCRIPTION_KIND,
} from './sales-common.js';
import { feedOf } from './sales-feed.js';
import {
  type Bounds,
  change,
  csvCell,
  dayOf,
  monthlyCents,
  periodBounds,
  within,
} from './sales-math.js';

type Out<S extends z.ZodType> = z.output<S>;

/** The most rows the report holds. */
const REPORT_CAP = 50_000;
const range = (b: Bounds) => ({ gte: new Date(b.start), lt: new Date(b.end) });

/**
 * Super Admin Sales numbers (R60 on R0's B5 and D1): the Sales Center's KPIs, the stage counts and
 * lost reasons, revenue by plan, lead sources, Recent Activity, the upcoming follow-ups and the
 * report, all counted from the records (zeros with none; a trend is null with nothing to compare).
 */
@Injectable()
export class SalesAnalyticsService {
  constructor(
    private readonly admin: AdminPrisma,
    private readonly audit: AuditService,
  ) {}

  center(query: Out<typeof SalesPeriodQuery>): Promise<SalesCenterSummary> {
    return this.admin.transaction(async (tx) => {
      const ctx = await loadContext(tx, this.admin.adminUserId);
      const { current, previous } = periodBounds(query, ctx.now);
      const scope: Prisma.SalesOpportunityWhereInput = query.pipelineId
        ? { pipelineId: query.pipelineId }
        : {};
      const created = (b: Bounds) =>
        tx.salesOpportunity.count({ where: { ...scope, createdAt: range(b) } });
      const demos = (b: Bounds) =>
        tx.salesFollowUp.count({
          where: {
            kind: 'DEMO',
            status: { not: 'CANCELLED' },
            dueAt: range(b),
            opportunity: scope,
          },
        });
      const won = (b: Bounds) =>
        tx.salesOpportunity.aggregate({
          where: { ...scope, convertedAt: range(b) },
          _count: { _all: true },
          _sum: { valueCents: true },
        });
      const lost = async (b: Bounds) =>
        (
          await tx.salesStageHistory.findMany({
            where: { toStageType: 'LOST', createdAt: range(b), opportunity: scope },
            distinct: ['opportunityId'],
            select: { opportunityId: true },
          })
        ).length;
      const [leadsNow, leadsBefore, demosNow, demosBefore, wonNow, wonBefore, lostNow, lostBefore] =
        await Promise.all([
          created(current),
          created(previous),
          demos(current),
          demos(previous),
          won(current),
          won(previous),
          lost(current),
          lost(previous),
        ]);
      // Trials and MRR: the platform subscriptions linked to the records (D1).
      const linked = await tx.salesOpportunity.findMany({
        where: { ...scope, transactionKind: SUBSCRIPTION_KIND, transactionId: { not: null } },
        select: { transactionId: true, convertedAt: true },
      });
      const subs = linked.length
        ? await tx.platformFirmSubscription.findMany({
            where: { id: { in: linked.map((l) => l.transactionId!) } },
            select: {
              id: true,
              status: true,
              trialStartedAt: true,
              trialEndsAt: true,
              priceCentsOverride: true,
              seatsPurchased: true,
              locationsPurchased: true,
              plan: {
                select: {
                  basePriceCents: true,
                  overagePriceCentsPerSeat: true,
                  overagePriceCentsPerLocation: true,
                  billingCycle: true,
                },
              },
            },
          })
        : [];
      const convertedOf = new Map(linked.map((l) => [l.transactionId!, l.convertedAt]));
      const trials = (b: Bounds) => subs.filter((s) => within(s.trialStartedAt, b)).length;
      const mrr = (b: Bounds) =>
        subs
          .filter((s) => within(convertedOf.get(s.id) ?? null, b) || within(s.trialStartedAt, b))
          .reduce((sum, s) => sum + monthlyCents(s, s.plan), 0);
      const activeTrials = subs.filter(
        (s) =>
          s.status === 'TRIAL' &&
          s.trialStartedAt !== null &&
          s.trialStartedAt.getTime() <= ctx.now &&
          (s.trialEndsAt === null || s.trialEndsAt.getTime() > ctx.now),
      ).length;
      const metric = (now: number, before: number) => ({ value: now, trend: change(now, before) });
      return {
        from: current.from,
        to: current.to,
        previousFrom: previous.from,
        previousTo: previous.to,
        totalLeads: metric(leadsNow, leadsBefore),
        demosScheduled: metric(demosNow, demosBefore),
        trialsStarted: metric(trials(current), trials(previous)),
        activeTrials: { value: activeTrials, trend: null },
        wonDeals: metric(wonNow._count._all, wonBefore._count._all),
        lostDeals: metric(lostNow, lostBefore),
        revenueWonCents: metric(wonNow._sum.valueCents ?? 0, wonBefore._sum.valueCents ?? 0),
        projectedMrrCents: metric(mrr(current), mrr(previous)),
      };
    });
  }

  stageCounts(query: Out<typeof SalesPeriodQuery>): Promise<SalesStageCounts> {
    return this.admin.transaction(async (tx) => {
      const ctx = await loadContext(tx, this.admin.adminUserId);
      const { current } = periodBounds(query, ctx.now);
      const pipelineId = query.pipelineId ?? (await defaultPipelineId(tx));
      const pipeline = await tx.salesPipeline.findUnique({
        where: { id: pipelineId },
        include: { stages: { select: stageSelect } },
      });
      if (!pipeline) throw notFound('Pipeline');
      const [records, entries] = await Promise.all([
        tx.salesOpportunity.findMany({
          where: { pipelineId },
          select: { stageId: true, valueCents: true, createdAt: true, stageEnteredAt: true },
        }),
        tx.salesStageHistory.groupBy({
          by: ['lostReason'],
          where: { toStageType: 'LOST', createdAt: range(current), opportunity: { pipelineId } },
          _count: { _all: true },
        }),
      ]);
      const stages = [...pipeline.stages].sort(stageOrder);
      const lostCount = new Map(entries.map((e) => [e.lostReason, e._count._all]));
      return {
        pipelineId,
        from: current.from,
        to: current.to,
        stages: stages
          .filter((s) => s.isActive || records.some((r) => r.stageId === s.id))
          .map((s) => {
            const ended = s.stageType === 'CLOSED' || s.stageType === 'LOST';
            const open = records.filter(
              (r) =>
                r.stageId === s.id &&
                r.createdAt.getTime() < current.end &&
                (!ended || r.stageEnteredAt.getTime() >= current.start),
            );
            return {
              stageId: s.id,
              name: s.name,
              type: s.stageType,
              tone: stageTone(s),
              count: open.length,
              valueCents: open.reduce((sum, r) => sum + (r.valueCents ?? 0), 0),
            };
          }),
        lostReasons: SalesLostReason.options.map((reason) => ({
          reason,
          count: lostCount.get(reason) ?? 0,
        })),
      };
    });
  }

  revenueByPlan(query: Out<typeof SalesPeriodQuery>): Promise<SalesRevenueByPlan> {
    return this.admin.transaction(async (tx) => {
      const ctx = await loadContext(tx, this.admin.adminUserId);
      const { current } = periodBounds(query, ctx.now);
      const [plans, won] = await Promise.all([
        tx.platformPlan.findMany({
          orderBy: [{ displayOrder: 'asc' }, { name: 'asc' }],
          select: { id: true, code: true, name: true, isActive: true },
        }),
        tx.salesOpportunity.groupBy({
          by: ['planId'],
          where: {
            convertedAt: range(current),
            ...(query.pipelineId ? { pipelineId: query.pipelineId } : {}),
          },
          _count: { _all: true },
          _sum: { valueCents: true },
        }),
      ]);
      const of = new Map(won.map((w) => [w.planId, w]));
      const slices: SalesRevenueByPlan['slices'] = plans
        .filter((p) => p.isActive || of.has(p.id))
        .map((p) => ({
          planId: p.id,
          code: p.code,
          name: p.name,
          cents: of.get(p.id)?._sum.valueCents ?? 0,
          deals: of.get(p.id)?._count._all ?? 0,
        }));
      const none = of.get(null);
      if (none)
        slices.push({
          planId: null,
          code: null,
          name: 'No plan',
          cents: none._sum.valueCents ?? 0,
          deals: none._count._all,
        });
      return {
        from: current.from,
        to: current.to,
        totalCents: slices.reduce((sum, s) => sum + s.cents, 0),
        slices,
      };
    });
  }

  leadSources(query: Out<typeof SalesPeriodQuery>): Promise<SalesLeadSources> {
    return this.admin.transaction(async (tx) => {
      const ctx = await loadContext(tx, this.admin.adminUserId);
      const { current } = periodBounds(query, ctx.now);
      const groups = await tx.salesOpportunity.groupBy({
        by: ['source'],
        where: {
          createdAt: range(current),
          ...(query.pipelineId ? { pipelineId: query.pipelineId } : {}),
        },
        _count: { _all: true },
      });
      const total = groups.reduce((sum, g) => sum + g._count._all, 0);
      return {
        from: current.from,
        to: current.to,
        total,
        items: groups
          .filter((g) => g._count._all > 0)
          .sort(
            (a, b) =>
              b._count._all - a._count._all ||
              SALES_LEAD_SOURCE_LABELS[a.source].localeCompare(SALES_LEAD_SOURCE_LABELS[b.source]),
          )
          .map((g) => ({
            source: g.source,
            count: g._count._all,
            percent: total ? Math.round((g._count._all / total) * 100) : 0,
          })),
      };
    });
  }

  activity(query: Out<typeof SalesFeedQuery>): Promise<SalesFeedList> {
    return this.admin.transaction(async (tx) => {
      const ctx = await loadContext(tx, this.admin.adminUserId);
      return {
        items: await feedOf(tx, ctx, {
          pipelineId: query.pipelineId,
          kinds: query.kinds,
          limit: query.limit ?? 50,
        }),
      };
    });
  }

  upcoming(query: Out<typeof SalesUpcomingQuery>): Promise<SalesFollowUpList> {
    return this.admin.transaction(async (tx) => {
      const ctx = await loadContext(tx, this.admin.adminUserId);
      const rows = await tx.salesFollowUp.findMany({
        where: {
          status: 'SCHEDULED',
          dueAt: { gte: new Date(ctx.now) },
          ...(query.kinds?.length ? { kind: { in: query.kinds } } : {}),
          ...(query.assigneeId ? { assignedToUserId: query.assigneeId } : {}),
          ...(query.pipelineId ? { opportunity: { pipelineId: query.pipelineId } } : {}),
        },
        orderBy: [{ dueAt: 'asc' }, { id: 'asc' }],
        take: query.limit ?? 50,
        select: followUpSelect,
      });
      return { items: rows.map((f) => followUpView(ctx, f)) };
    });
  }

  /** Export Sales Report: the records created in the period, as CSV. */
  report(query: Out<typeof SalesPeriodQuery>): Promise<string> {
    return this.admin.transaction(async (tx) => {
      const ctx = await loadContext(tx, this.admin.adminUserId);
      const { current } = periodBounds(query, ctx.now);
      const rows = await tx.salesOpportunity.findMany({
        where: {
          createdAt: range(current),
          ...(query.pipelineId ? { pipelineId: query.pipelineId } : {}),
        },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        take: REPORT_CAP,
        select: {
          title: true,
          source: true,
          valueCents: true,
          assignedToUserId: true,
          createdAt: true,
          contact: { select: { name: true, email: true } },
          stage: { select: { name: true } },
          plan: { select: { name: true } },
        },
      });
      const head = [
        'Firm',
        'Contact',
        'Email',
        'Stage',
        'Owner',
        'Source',
        'Plan',
        'Value (USD)',
        'Created',
      ];
      const lines = rows.map((r) =>
        [
          r.title,
          r.contact.name,
          r.contact.email ?? '',
          r.stage.name,
          r.assignedToUserId ? ctx.nameOf(r.assignedToUserId) : 'Unassigned',
          SALES_LEAD_SOURCE_LABELS[r.source],
          r.plan?.name ?? '',
          r.valueCents === null ? '' : (r.valueCents / 100).toFixed(2),
          dayOf(r.createdAt.getTime()),
        ]
          .map(csvCell)
          .join(','),
      );
      await this.audit.logIn(
        tx,
        'sales_report.exported',
        { type: 'sales_report' },
        {
          from: current.from,
          to: current.to,
          pipelineId: query.pipelineId ?? null,
          rows: rows.length,
        },
        { businessId: null },
      );
      return [head.join(','), ...lines].join('\r\n') + '\r\n';
    });
  }
}

const stageTone = (s: { systemKey: string | null; stageType: SalesStageType }) =>
  salesStageTone({ systemKey: s.systemKey, type: s.stageType });
