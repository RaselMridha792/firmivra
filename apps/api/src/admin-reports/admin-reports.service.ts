import { Injectable } from '@nestjs/common';
import type { Prisma, TxClient } from '@firmivra/db';
import {
  ADMIN_REPORT_FEATURES,
  type AdminFeatureUsageQuery,
  type AdminFeatureUsageReport,
  type AdminFeatureUsageRow,
  type AdminFirmReport,
  type AdminFirmsReport,
  type AdminFirmsReportQuery,
  type AdminReportActivity,
  type AdminReportRange,
  type AdminReportsOverview,
  type AdminRevenueReport,
  type AdminSupportReport,
  type AdminUsersReport,
} from '@firmivra/types';
import type { z } from 'zod';
import { PlatformPrisma } from '../database/database.module.js';
import { AdminPrisma } from '../firm-applications/admin-prisma.js';
import { notFound } from '../workspaces/common.js';
import {
  collectedByFirm,
  contactsByFirm,
  dayEnd,
  dayStart,
  latestMetrics,
  monthOf,
  monthStart,
  monthsTo,
  mrrOn,
  plansByFirm,
  type Range,
  rangeOf,
  series,
} from './reports.common.js';

type Out<S extends z.ZodType> = z.output<S>;
const kpi = (value: number | null, previous: number | null) => ({ value, previous });
const label = (feature: string) =>
  (ADMIN_REPORT_FEATURES as Record<string, string>)[feature] ??
  feature
    .split('.')
    .pop()!
    .replace(/_/g, ' ')
    .replace(/^\w/, (c) => c.toUpperCase());

/**
 * Super Admin Reports & Analytics (R55; contract in packages/types/src/admin-reports). Admin scope
 * reads the platform's tables (firms, applications, subscriptions, billing, support, audit, the
 * daily rollups); user counts come from the platform's users (platform scope, for a Super Admin).
 * Every figure is live; one with no source is null, never zero.
 */
@Injectable()
export class AdminReportsService {
  constructor(
    private readonly admin: AdminPrisma,
    private readonly platform: PlatformPrisma,
  ) {}

  private usersUpTo(day: string) {
    return this.platform.db.user.count({
      where: { pool: { in: ['STAFF', 'CLIENT'] }, createdAt: { lte: dayEnd(day) } },
    });
  }

  /** Feature use in a range across firms (or one firm), as the share of active firms. */
  private async featureRows(
    tx: TxClient,
    r: { from: string; to: string },
    where: Prisma.PlatformFeatureUsageDailyWhereInput = {},
  ): Promise<{ rows: AdminFeatureUsageRow[]; hasData: boolean }> {
    const grouped = await tx.platformFeatureUsageDaily.groupBy({
      by: ['feature', 'businessId'],
      where: { day: { gte: dayStart(r.from), lte: dayStart(r.to) }, ...where },
      _sum: { events: true },
    });
    const active = await tx.business.count({ where: { status: 'ACTIVE' } });
    const by = new Map<string, { events: number; firms: number }>();
    for (const g of grouped) {
      const e = by.get(g.feature) ?? { events: 0, firms: 0 };
      e.events += g._sum.events ?? 0;
      if ((g._sum.events ?? 0) > 0) e.firms += 1;
      by.set(g.feature, e);
    }
    const keys = [...new Set([...Object.keys(ADMIN_REPORT_FEATURES), ...by.keys()])];
    const hasData = grouped.length > 0;
    return {
      hasData,
      rows: keys.map((feature) => {
        const e = by.get(feature) ?? { events: 0, firms: 0 };
        return {
          feature,
          label: label(feature),
          events: e.events,
          firms: e.firms,
          percent: hasData && active ? Math.round((e.firms / active) * 1000) / 10 : null,
        };
      }),
    };
  }

  private async activity(
    tx: TxClient,
    r: Range,
    businessId?: string,
    take = 10,
  ): Promise<AdminReportActivity[]> {
    const inRange = { gte: dayStart(r.from), lte: dayEnd(r.to) };
    const firm = businessId ? { businessId } : {};
    const [firms, changes, failed, tickets, names] = await Promise.all([
      businessId
        ? []
        : tx.business.findMany({
            where: { createdAt: inRange },
            select: { id: true, name: true, createdAt: true },
            orderBy: { createdAt: 'desc' },
            take,
          }),
      tx.platformSubscriptionChange.findMany({
        where: { effectiveAt: inRange, ...firm },
        select: {
          businessId: true,
          kind: true,
          effectiveAt: true,
          fromPlanId: true,
          toPlanId: true,
        },
        orderBy: { effectiveAt: 'desc' },
        take,
      }),
      tx.platformPayment.findMany({
        where: { status: 'FAILED', paidOn: inRange, ...firm },
        select: { businessId: true, amountCents: true, paidOn: true },
        orderBy: { paidOn: 'desc' },
        take,
      }),
      tx.supportTicket.findMany({
        where: { createdAt: inRange, deletedAt: null, ...firm },
        select: { businessId: true, number: true, subject: true, createdAt: true },
        orderBy: { createdAt: 'desc' },
        take,
      }),
      tx.business.findMany({ select: { id: true, name: true } }),
    ]);
    const plans = new Map(
      (await tx.platformPlan.findMany({ select: { id: true, name: true } })).map((p) => [
        p.id,
        p.name,
      ]),
    );
    const firmName = new Map(names.map((n) => [n.id, n.name]));
    const ref = (id: string) => ({ id, name: firmName.get(id) ?? 'Unknown firm' });
    const items: AdminReportActivity[] = [
      ...firms.map((f) => ({
        at: f.createdAt.toISOString(),
        kind: 'firm_registered',
        title: 'New Firm Registration',
        detail: f.name,
        firm: { id: f.id, name: f.name },
      })),
      ...changes.map((c) => ({
        at: c.effectiveAt.toISOString(),
        kind: 'subscription_changed',
        title: `Subscription ${c.kind.charAt(0)}${c.kind.slice(1).toLowerCase().replace(/_/g, ' ')}`,
        detail:
          c.fromPlanId && c.toPlanId && c.fromPlanId !== c.toPlanId
            ? `${plans.get(c.fromPlanId) ?? ''} → ${plans.get(c.toPlanId) ?? ''}`
            : null,
        firm: ref(c.businessId),
      })),
      ...failed.map((p) => ({
        at: p.paidOn.toISOString(),
        kind: 'payment_failed',
        title: 'Payment Failed',
        detail: `$${(p.amountCents / 100).toFixed(2)}`,
        firm: ref(p.businessId),
      })),
      ...tickets.map((t) => ({
        at: t.createdAt.toISOString(),
        kind: 'ticket_opened',
        title: 'Support Ticket',
        detail: `#${t.number} ${t.subject}`,
        firm: ref(t.businessId),
      })),
    ];
    return items.sort((a, b) => b.at.localeCompare(a.at)).slice(0, take);
  }

  // ---------- Overview ----------

  async overview(q: Out<typeof AdminReportRange>): Promise<AdminReportsOverview> {
    const r = rangeOf(q);
    const [usersNow, usersBefore] = await Promise.all([
      this.usersUpTo(r.to),
      this.usersUpTo(r.previousTo),
    ]);
    return this.admin.transaction(async (tx) => {
      const upTo = (d: string): Prisma.BusinessWhereInput => ({ createdAt: { lte: dayEnd(d) } });
      const months = monthsTo(r.to);
      const sixAgo = monthStart(months[0]!);
      const overdue = (d: string) =>
        tx.platformInvoice.count({
          where: {
            status: { in: ['SENT', 'PARTIALLY_PAID'] },
            dueDate: { lt: dayStart(d) },
            invoiceDate: { lte: dayEnd(d) },
          },
        });
      const open = (d: string) =>
        tx.supportTicket.count({
          where: {
            deletedAt: null,
            createdAt: { lte: dayEnd(d) },
            OR: [{ resolvedAt: null }, { resolvedAt: { gt: dayEnd(d) } }],
            status: { notIn: ['CLOSED'] },
          },
        });
      const [
        totalNow,
        totalBefore,
        activeNow,
        activeBefore,
        pendingNow,
        pendingBefore,
        mrrNow,
        mrrBefore,
        overdueNow,
        overdueBefore,
        openNow,
        openBefore,
        newFirms,
        payments,
        active,
        subs,
        collected,
        features,
      ] = await Promise.all([
        tx.business.count({ where: upTo(r.to) }),
        tx.business.count({ where: upTo(r.previousTo) }),
        tx.business.count({ where: { status: 'ACTIVE', activatedAt: { lte: dayEnd(r.to) } } }),
        tx.business.count({
          where: { status: 'ACTIVE', activatedAt: { lte: dayEnd(r.previousTo) } },
        }),
        tx.firmApplication.count({
          where: { status: { in: ['PENDING_REVIEW', 'INFO_REQUESTED'] } },
        }),
        tx.firmApplication.count({
          where: {
            status: { in: ['PENDING_REVIEW', 'INFO_REQUESTED'] },
            createdAt: { lte: dayEnd(r.previousTo) },
          },
        }),
        mrrOn(tx, r.to),
        mrrOn(tx, r.previousTo),
        overdue(r.to),
        overdue(r.previousTo),
        open(r.to),
        open(r.previousTo),
        tx.business.findMany({
          where: { createdAt: { gte: sixAgo, lte: dayEnd(r.to) } },
          select: { createdAt: true },
        }),
        tx.platformPayment.findMany({
          where: {
            status: { in: ['COMPLETED', 'PARTIALLY_REFUNDED'] },
            paidOn: { gte: sixAgo, lte: dayEnd(r.to) },
          },
          select: { paidOn: true, amountCents: true, refundedCents: true },
        }),
        tx.business.findMany({ where: { status: 'ACTIVE' }, select: { id: true, name: true } }),
        plansByFirm(tx),
        collectedByFirm(tx, r.from, r.to),
        this.featureRows(tx, r),
      ]);
      const planCounts = new Map<
        string,
        { planCode: string | null; planName: string; firms: number }
      >();
      for (const f of active) {
        const p = subs.get(f.id);
        const key = p?.code ?? '';
        const e = planCounts.get(key) ?? {
          planCode: p?.code ?? null,
          planName: p?.name ?? 'No plan',
          firms: 0,
        };
        e.firms += 1;
        planCounts.set(key, e);
      }
      const names = new Map(active.map((f) => [f.id, f.name]));
      const allNames = new Map(
        (
          await tx.business.findMany({
            where: { id: { in: [...collected.keys()] } },
            select: { id: true, name: true },
          })
        ).map((b) => [b.id, b.name]),
      );
      return {
        range: r,
        kpis: {
          totalFirms: kpi(totalNow, totalBefore),
          activeFirms: kpi(activeNow, activeBefore),
          pendingApplications: kpi(pendingNow, pendingBefore),
          totalUsers: kpi(usersNow, usersBefore),
          mrrCents: kpi(mrrNow, mrrBefore),
          overduePayments: kpi(overdueNow, overdueBefore),
          openSupportIssues: kpi(openNow, openBefore),
          uptimePercent: kpi(null, null),
        },
        firmGrowth: series(months, newFirms, (b) => b.createdAt),
        revenueTrend: series(
          months,
          payments,
          (p) => p.paidOn,
          (p) => p.amountCents - p.refundedCents,
        ),
        planDistribution: [...planCounts.values()].sort((a, b) => b.firms - a.firms),
        featureUsage: features.rows,
        recentActivity: await this.activity(tx, r),
        topFirms: [...collected.entries()]
          .sort((a, b) => b[1] - a[1])
          .slice(0, 10)
          .map(([id, revenueCents]) => ({
            id,
            name: names.get(id) ?? allNames.get(id) ?? 'Unknown firm',
            revenueCents,
          })),
      };
    });
  }

  // ---------- Tabs ----------

  revenue(q: Out<typeof AdminReportRange>): Promise<AdminRevenueReport> {
    const r = rangeOf(q);
    return this.admin.transaction(async (tx) => {
      const paid = (from: string, to: string) =>
        tx.platformPayment.aggregate({
          where: {
            status: { in: ['COMPLETED', 'PARTIALLY_REFUNDED'] },
            paidOn: { gte: dayStart(from), lte: dayEnd(to) },
          },
          _sum: { amountCents: true, refundedCents: true },
        });
      const refunded = (from: string, to: string) =>
        tx.platformRefund.aggregate({
          where: { status: 'COMPLETED', completedAt: { gte: dayStart(from), lte: dayEnd(to) } },
          _sum: { amountCents: true },
        });
      const failed = (from: string, to: string) =>
        tx.platformPayment.count({
          where: { status: 'FAILED', paidOn: { gte: dayStart(from), lte: dayEnd(to) } },
        });
      const months = monthsTo(r.to);
      const [
        mrrNow,
        mrrBefore,
        paidNow,
        paidBefore,
        refNow,
        refBefore,
        failNow,
        failBefore,
        overdue,
        changes,
        payments,
        subs,
        byFirm,
      ] = await Promise.all([
        mrrOn(tx, r.to),
        mrrOn(tx, r.previousTo),
        paid(r.from, r.to),
        paid(r.previousFrom, r.previousTo),
        refunded(r.from, r.to),
        refunded(r.previousFrom, r.previousTo),
        failed(r.from, r.to),
        failed(r.previousFrom, r.previousTo),
        tx.platformInvoice.findMany({
          where: { status: { in: ['SENT', 'PARTIALLY_PAID'] }, dueDate: { lt: dayStart(r.to) } },
          select: { totalCents: true, paidCents: true, creditedCents: true },
        }),
        tx.platformSubscriptionChange.groupBy({
          by: ['kind'],
          where: { effectiveAt: { gte: dayStart(r.from), lte: dayEnd(r.to) } },
          _count: { _all: true },
        }),
        tx.platformPayment.findMany({
          where: {
            status: { in: ['COMPLETED', 'PARTIALLY_REFUNDED'] },
            paidOn: { gte: monthStart(months[0]!), lte: dayEnd(r.to) },
          },
          select: { paidOn: true, amountCents: true, refundedCents: true },
        }),
        plansByFirm(tx),
        collectedByFirm(tx, r.from, r.to),
      ]);
      const net = (a: { _sum: { amountCents: number | null; refundedCents: number | null } }) =>
        (a._sum.amountCents ?? 0) - (a._sum.refundedCents ?? 0);
      const changesOf = (k: string) => changes.find((c) => c.kind === k)?._count._all ?? 0;
      const byPlan = new Map<string, { planName: string; revenueCents: number; firms: number }>();
      for (const [firm, cents] of byFirm) {
        const name = subs.get(firm)?.name ?? 'No plan';
        const e = byPlan.get(name) ?? { planName: name, revenueCents: 0, firms: 0 };
        e.revenueCents += cents;
        e.firms += 1;
        byPlan.set(name, e);
      }
      const names = new Map(
        (
          await tx.business.findMany({
            where: { id: { in: [...byFirm.keys()] } },
            select: { id: true, name: true },
          })
        ).map((b) => [b.id, b.name]),
      );
      return {
        mrrCents: kpi(mrrNow, mrrBefore),
        arrCents: kpi(mrrNow * 12, mrrBefore * 12),
        collectedCents: kpi(net(paidNow), net(paidBefore)),
        refundedCents: kpi(refNow._sum.amountCents ?? 0, refBefore._sum.amountCents ?? 0),
        failedPayments: kpi(failNow, failBefore),
        overdueCents: overdue.reduce(
          (a, i) => a + Math.max(0, i.totalCents - i.paidCents - i.creditedCents),
          0,
        ),
        upgrades: changesOf('UPGRADED'),
        downgrades: changesOf('DOWNGRADED'),
        cancellations: changesOf('CANCELED'),
        trend: series(
          months,
          payments,
          (p) => p.paidOn,
          (p) => p.amountCents - p.refundedCents,
        ),
        byPlan: [...byPlan.values()].sort((a, b) => b.revenueCents - a.revenueCents),
        byFirm: [...byFirm.entries()]
          .sort((a, b) => b[1] - a[1])
          .slice(0, 25)
          .map(([id, revenueCents]) => ({
            id,
            name: names.get(id) ?? 'Unknown firm',
            revenueCents,
          })),
      };
    });
  }

  async users(q: Out<typeof AdminReportRange>): Promise<AdminUsersReport> {
    const r = rangeOf(q);
    const [nowTotal, beforeTotal] = await Promise.all([
      this.usersUpTo(r.to),
      this.usersUpTo(r.previousTo),
    ]);
    const byPoolRows = await this.platform.db.user.groupBy({
      by: ['pool'],
      where: { pool: { in: ['STAFF', 'CLIENT'] } },
      _count: { _all: true },
    });
    return this.admin.transaction(async (tx) => {
      const months = monthsTo(r.to);
      const signups = (from: Date, to: Date) =>
        tx.platformUserSignups.findMany({
          where: { day: { gte: from, lte: to }, pool: { in: ['STAFF', 'CLIENT'] } },
          select: { day: true, users: true },
        });
      const [inRange, before, trend, metrics, actNow, actBefore] = await Promise.all([
        signups(dayStart(r.from), dayStart(r.to)),
        signups(dayStart(r.previousFrom), dayStart(r.previousTo)),
        signups(monthStart(months[0]!), dayStart(r.to)),
        latestMetrics(tx, r.to),
        tx.platformFirmMetricsDaily.aggregate({
          where: { day: dayStart(r.to) },
          _sum: { activeUsers: true },
          _count: { _all: true },
        }),
        tx.platformFirmMetricsDaily.aggregate({
          where: { day: dayStart(r.previousTo) },
          _sum: { activeUsers: true },
          _count: { _all: true },
        }),
      ]);
      const sum = (rows: { users: number }[]) => rows.reduce((a, x) => a + x.users, 0);
      const names = new Map(
        (
          await tx.business.findMany({
            where: { id: { in: [...metrics.keys()] } },
            select: { id: true, name: true },
          })
        ).map((b) => [b.id, b.name]),
      );
      return {
        totalUsers: kpi(nowTotal, beforeTotal),
        newUsers: kpi(sum(inRange), sum(before)),
        activeUsers: kpi(
          actNow._count._all ? (actNow._sum.activeUsers ?? 0) : null,
          actBefore._count._all ? (actBefore._sum.activeUsers ?? 0) : null,
        ),
        byPool: (['STAFF', 'CLIENT'] as const).map((pool) => ({
          pool,
          users: byPoolRows.find((p) => p.pool === pool)?._count._all ?? 0,
        })),
        signups: series(
          months,
          trend,
          (s) => s.day,
          (s) => s.users,
        ),
        byFirm: [...metrics.values()]
          .sort((a, b) => b.totalUsers - a.totalUsers)
          .slice(0, 50)
          .map((m) => ({
            id: m.businessId,
            name: names.get(m.businessId) ?? 'Unknown firm',
            totalUsers: m.totalUsers,
            activeUsers: m.activeUsers,
            lastLoginAt: m.lastLoginAt?.toISOString() ?? null,
          })),
      };
    });
  }

  featureUsage(q: Out<typeof AdminFeatureUsageQuery>): Promise<AdminFeatureUsageReport> {
    const r = rangeOf(q);
    return this.admin.transaction(async (tx) => {
      let firms: string[] | undefined;
      if (q.planCode) {
        const subs = await tx.platformFirmSubscription.findMany({
          where: { plan: { code: q.planCode } },
          select: { businessId: true },
        });
        firms = subs.map((s) => s.businessId);
      }
      const out = await this.featureRows(tx, r, {
        ...(q.feature ? { feature: q.feature } : {}),
        ...(firms ? { businessId: { in: firms } } : {}),
      });
      return {
        rows: q.feature ? out.rows.filter((x) => x.feature === q.feature) : out.rows,
        hasData: out.hasData,
      };
    });
  }

  support(q: Out<typeof AdminReportRange>): Promise<AdminSupportReport> {
    const r = rangeOf(q);
    return this.admin.transaction(async (tx) => {
      const created = (from: string, to: string) => ({
        deletedAt: null,
        createdAt: { gte: dayStart(from), lte: dayEnd(to) },
      });
      const months = monthsTo(r.to);
      const [
        total,
        totalBefore,
        open,
        inProgress,
        closed,
        closedBefore,
        answered,
        resolved,
        byPriority,
        byFirm,
        volume,
      ] = await Promise.all([
        tx.supportTicket.count({ where: created(r.from, r.to) }),
        tx.supportTicket.count({ where: created(r.previousFrom, r.previousTo) }),
        tx.supportTicket.count({
          where: { deletedAt: null, status: { in: ['OPEN', 'WAITING_ON_CUSTOMER'] } },
        }),
        tx.supportTicket.count({ where: { deletedAt: null, status: 'IN_PROGRESS' } }),
        tx.supportTicket.count({
          where: { deletedAt: null, resolvedAt: { gte: dayStart(r.from), lte: dayEnd(r.to) } },
        }),
        tx.supportTicket.count({
          where: {
            deletedAt: null,
            resolvedAt: { gte: dayStart(r.previousFrom), lte: dayEnd(r.previousTo) },
          },
        }),
        tx.supportTicket.findMany({
          where: {
            deletedAt: null,
            firstRespondedAt: { gte: dayStart(r.from), lte: dayEnd(r.to) },
          },
          select: { createdAt: true, firstRespondedAt: true },
        }),
        tx.supportTicket.findMany({
          where: { deletedAt: null, resolvedAt: { gte: dayStart(r.from), lte: dayEnd(r.to) } },
          select: { createdAt: true, resolvedAt: true, slaPausedSeconds: true },
        }),
        tx.supportTicket.groupBy({
          by: ['priorityId'],
          where: created(r.from, r.to),
          _count: { _all: true },
        }),
        tx.supportTicket.groupBy({
          by: ['businessId'],
          where: created(r.from, r.to),
          _count: { _all: true },
        }),
        tx.supportTicket.findMany({
          where: { deletedAt: null, createdAt: { gte: monthStart(months[0]!), lte: dayEnd(r.to) } },
          select: { createdAt: true },
        }),
      ]);
      const priorities = new Map(
        (await tx.supportPriority.findMany({ select: { id: true, name: true } })).map((p) => [
          p.id,
          p.name,
        ]),
      );
      const names = new Map(
        (
          await tx.business.findMany({
            where: { id: { in: byFirm.map((b) => b.businessId) } },
            select: { id: true, name: true },
          })
        ).map((b) => [b.id, b.name]),
      );
      const avg = (xs: number[]) =>
        xs.length ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 10) / 10 : null;
      return {
        total: kpi(total, totalBefore),
        open,
        inProgress,
        closed: kpi(closed, closedBefore),
        avgFirstResponseMinutes: avg(
          answered.map((t) => (t.firstRespondedAt!.getTime() - t.createdAt.getTime()) / 60_000),
        ),
        avgResolutionHours: avg(
          resolved.map(
            (t) =>
              (t.resolvedAt!.getTime() - t.createdAt.getTime() - t.slaPausedSeconds * 1000) /
              3_600_000,
          ),
        ),
        byPriority: byPriority
          .map((p) => ({
            priority: priorities.get(p.priorityId) ?? 'Unknown',
            tickets: p._count._all,
          }))
          .sort((a, b) => b.tickets - a.tickets),
        byFirm: byFirm
          .map((b) => ({
            id: b.businessId,
            name: names.get(b.businessId) ?? 'Unknown firm',
            tickets: b._count._all,
          }))
          .sort((a, b) => b.tickets - a.tickets)
          .slice(0, 25),
        volume: series(months, volume, (t) => t.createdAt),
      };
    });
  }

  // ---------- Firms ----------

  firms(q: Out<typeof AdminFirmsReportQuery>): Promise<AdminFirmsReport> {
    const r = rangeOf(q);
    return this.admin.transaction(async (tx) => {
      const [firms, plans, contacts, collected, metrics, tickets] = await Promise.all([
        tx.business.findMany({
          where: {
            ...(q.status ? { status: q.status } : {}),
            ...(q.search
              ? {
                  OR: [
                    { name: { contains: q.search, mode: 'insensitive' } },
                    { slug: { contains: q.search, mode: 'insensitive' } },
                  ],
                }
              : {}),
          },
          select: { id: true, name: true, status: true, createdAt: true },
        }),
        plansByFirm(tx),
        contactsByFirm(tx),
        collectedByFirm(tx, r.from, r.to),
        latestMetrics(tx, r.to),
        tx.supportTicket.groupBy({
          by: ['businessId'],
          where: { deletedAt: null, status: { notIn: ['RESOLVED', 'CLOSED'] } },
          _count: { _all: true },
        }),
      ]);
      const open = new Map(tickets.map((t) => [t.businessId, t._count._all]));
      let rows = firms
        .filter((f) => !q.planCode || plans.get(f.id)?.code === q.planCode)
        .map((f) => ({
          id: f.id,
          name: f.name,
          status: f.status,
          planName: plans.get(f.id)?.name ?? null,
          joinedAt: f.createdAt.toISOString(),
          contactName: contacts.get(f.id)?.name ?? null,
          contactEmail: contacts.get(f.id)?.email ?? null,
          totalUsers: metrics.get(f.id)?.totalUsers ?? null,
          revenueCents: collected.get(f.id) ?? 0,
          openTickets: open.get(f.id) ?? 0,
          lastLoginAt: metrics.get(f.id)?.lastLoginAt?.toISOString() ?? null,
        }));
      const dir = q.descending ? -1 : 1;
      const cmp: Record<string, (a: (typeof rows)[number], b: (typeof rows)[number]) => number> = {
        name: (a, b) => a.name.localeCompare(b.name),
        joined: (a, b) => a.joinedAt.localeCompare(b.joinedAt),
        revenue: (a, b) => a.revenueCents - b.revenueCents,
        users: (a, b) => (a.totalUsers ?? -1) - (b.totalUsers ?? -1),
      };
      rows = rows.sort((a, b) => dir * cmp[q.sort]!(a, b) || a.id.localeCompare(b.id));
      return {
        items: rows.slice((q.page - 1) * q.pageSize, q.page * q.pageSize),
        total: rows.length,
        page: q.page,
        pageSize: q.pageSize,
      };
    });
  }

  firm(businessId: string, q: Out<typeof AdminReportRange>): Promise<AdminFirmReport> {
    const r = rangeOf(q);
    return this.admin.transaction(async (tx) => {
      const firm = await tx.business.findUnique({
        where: { id: businessId },
        select: { id: true, name: true, status: true, businessType: true, createdAt: true },
      });
      if (!firm) throw notFound();
      const months = monthsTo(r.to);
      const metricsIn = (from: string, to: string) =>
        tx.platformFirmMetricsDaily.findMany({
          where: { businessId, day: { gte: dayStart(from), lte: dayStart(to) } },
          orderBy: { day: 'asc' },
        });
      const [
        plans,
        contacts,
        now,
        before,
        history,
        revenueNow,
        revenueBefore,
        ticketsNow,
        ticketsBefore,
        open,
        features,
      ] = await Promise.all([
        plansByFirm(tx),
        contactsByFirm(tx),
        metricsIn(r.from, r.to),
        metricsIn(r.previousFrom, r.previousTo),
        tx.platformFirmMetricsDaily.findMany({
          where: { businessId, day: { gte: monthStart(months[0]!), lte: dayStart(r.to) } },
          orderBy: { day: 'asc' },
        }),
        collectedByFirm(tx, r.from, r.to),
        collectedByFirm(tx, r.previousFrom, r.previousTo),
        tx.supportTicket.count({
          where: {
            businessId,
            deletedAt: null,
            createdAt: { gte: dayStart(r.from), lte: dayEnd(r.to) },
          },
        }),
        tx.supportTicket.count({
          where: {
            businessId,
            deletedAt: null,
            createdAt: { gte: dayStart(r.previousFrom), lte: dayEnd(r.previousTo) },
          },
        }),
        tx.supportTicket.findMany({
          where: { businessId, deletedAt: null, status: { notIn: ['RESOLVED', 'CLOSED'] } },
          select: {
            id: true,
            number: true,
            subject: true,
            status: true,
            createdAt: true,
            priority: { select: { name: true } },
          },
          orderBy: { createdAt: 'desc' },
          take: 10,
        }),
        this.featureRows(tx, r, { businessId }),
      ]);
      const last = <T>(xs: T[]) => xs[xs.length - 1];
      const sumOf = (xs: { leadsCreated: number }[]) =>
        xs.length ? xs.reduce((a, x) => a + x.leadsCreated, 0) : null;
      const byMonth = new Map<string, { totalUsers: number; created: number; completed: number }>();
      for (const h of history) {
        const m = monthOf(h.day);
        const e = byMonth.get(m) ?? { totalUsers: 0, created: 0, completed: 0 };
        e.totalUsers = h.totalUsers;
        e.created += h.documentsCreated;
        e.completed += h.documentsCompleted;
        byMonth.set(m, e);
      }
      const contact = contacts.get(businessId);
      return {
        firm: {
          id: firm.id,
          name: firm.name,
          status: firm.status,
          businessType: firm.businessType,
          planName: plans.get(businessId)?.name ?? null,
          since: firm.createdAt.toISOString(),
          contactName: contact?.name ?? null,
          contactEmail: contact?.email ?? null,
          contactPhone: contact?.phone ?? null,
          location: null,
        },
        kpis: {
          totalUsers: kpi(last(now)?.totalUsers ?? null, last(before)?.totalUsers ?? null),
          revenueCents: kpi(revenueNow.get(businessId) ?? 0, revenueBefore.get(businessId) ?? 0),
          activeDocuments: kpi(
            last(now)?.activeDocuments ?? null,
            last(before)?.activeDocuments ?? null,
          ),
          leads: kpi(sumOf(now), sumOf(before)),
          supportTickets: kpi(ticketsNow, ticketsBefore),
        },
        userGrowth: months
          .filter((m) => byMonth.has(m))
          .map((m) => ({ month: m, value: byMonth.get(m)!.totalUsers })),
        documentActivity: months
          .filter((m) => byMonth.has(m))
          .map((m) => ({
            month: m,
            created: byMonth.get(m)!.created,
            completed: byMonth.get(m)!.completed,
          })),
        featureUsage: features.rows,
        recentActivity: await this.activity(tx, r, businessId),
        openTickets: open.map((t) => ({
          id: t.id,
          number: t.number,
          subject: t.subject,
          priority: t.priority.name,
          status: t.status,
          createdAt: t.createdAt.toISOString(),
        })),
        hasActivityData: history.length > 0,
      };
    });
  }
}
