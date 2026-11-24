import { Injectable } from '@nestjs/common';
import type { TxClient } from '@firmivra/db';
import {
  SUBSCRIPTION_CYCLE_LABELS,
  SUBSCRIPTION_STATUS_LABELS,
  SUBSCRIPTION_TRIAL_DAYS,
  type SubscriptionAvailableFirmList,
  type SubscriptionExportQuery,
  type SubscriptionMeta,
  type SubscriptionPage,
  type SubscriptionRecord,
  SubscriptionRequestSource,
  type SubscriptionsQuery,
  type SubscriptionSummary,
  type SubscriptionSummaryQuery,
  subscriptionAddDays,
  subscriptionDaysBetween,
} from '@firmivra/types';
import type { z } from 'zod';
import {
  invoiceStatus,
  loadFirms,
  loadTeam,
  NOT_EMAILED,
  today as billingToday,
} from '../admin-billing/billing-common.js';
import { BillingService } from '../admin-billing/billing.service.js';
import { AuditService } from '../audit/audit.service.js';
import { AdminPrisma } from '../firm-applications/admin-prisma.js';
import {
  amountDue,
  ENTITY,
  inTransaction,
  type Loaded,
  loadOne,
  loadPlans,
  loadSubscriptions,
} from './subscriptions-common.js';
import {
  ACTIONS,
  eventsOf,
  keptSuspensionKind,
  notesByRow,
  subscriptionNotesOf,
} from './subscriptions-events.js';
import {
  asDate,
  churnOf,
  csvCell,
  DAY_MS,
  dayOf,
  dayOrNull,
  dollars,
  inForce,
  iso,
  isPaying,
  matchesSearch,
  matchesStatus,
  periodOf,
  previousPeriod,
  renewsSoon,
  sortRows,
  suspensionKindOf,
  utcDay,
} from './subscriptions-math.js';

type Out<S extends z.ZodType> = z.output<S>;
type Filters = Pick<
  Out<typeof SubscriptionsQuery>,
  'search' | 'planId' | 'status' | 'billingCycle' | 'from' | 'to'
>;

/** The most subscriptions one export holds (each gets an EXPORTED event). */
const EXPORT_CAP = 1000;
/** The sales record kind a subscription is linked as (B5). */
const SALES_SUBSCRIPTION_KIND = 'platform_subscription';

/**
 * Super Admin Subscriptions reads (R60 on R0's stage A, B3 and the MRR rollup), in the Super
 * Admin's admin scope: the plans, the KPI row, the table, the firms without a subscription, the
 * detail panel and the export. Nothing here opens a firm's scope: seats in use come from the
 * daily firm rollup, the firm's contact from its billing profile or its active owner.
 */
@Injectable()
export class SubscriptionsReadService {
  constructor(
    private readonly admin: AdminPrisma,
    private readonly audit: AuditService,
    private readonly billing: BillingService,
  ) {}

  meta(): Promise<SubscriptionMeta> {
    return inTransaction(this.admin, async (tx) => ({
      today: utcDay(Date.now()),
      trialDays: SUBSCRIPTION_TRIAL_DAYS,
      plans: await loadPlans(tx),
    }));
  }

  // ---------- The KPI row ----------

  summary(query: Out<typeof SubscriptionSummaryQuery>): Promise<SubscriptionSummary> {
    return inTransaction(this.admin, async (tx) => {
      const now = Date.now();
      const today = utcDay(now);
      const period = periodOf(query, today);
      const previous = previousPeriod(period);
      const comparedWith = subscriptionAddDays(today, -30);
      const [loaded, rollup, moves, renewed] = await Promise.all([
        loadSubscriptions(tx, {}, now),
        tx.platformMrrDaily.findUnique({ where: { day: asDate(comparedWith) } }),
        tx.platformSubscriptionChange.findMany({
          where: { effectiveAt: { lt: new Date(asDate(period.to).getTime() + DAY_MS) } },
          select: { subscriptionId: true, toStatus: true, effectiveAt: true },
        }),
        tx.platformSubscriptionChange.findMany({
          where: {
            kind: 'RENEWED',
            effectiveAt: { gte: asDate(comparedWith), lt: asDate(today) },
          },
          distinct: ['subscriptionId'],
          select: { subscriptionId: true },
        }),
      ]);
      const rows = loaded.map((l) => l.row);
      const count = (status: string) => rows.filter((r) => r.status === status).length;
      const mrr = rows.filter((r) => isPaying(r.status)).reduce((s, r) => s + r.monthlyCents, 0);
      const statusMoves = moves.map((m) => ({
        subscriptionId: m.subscriptionId,
        toStatus: m.toStatus,
        at: m.effectiveAt.getTime(),
      }));
      const current = churnOf(statusMoves, period);
      const before = churnOf(statusMoves, previous);
      return {
        from: period.from,
        to: period.to,
        previousFrom: previous.from,
        previousTo: previous.to,
        comparedWith,
        active: { value: count('ACTIVE'), previous: rollup?.activeCount ?? null },
        trial: { value: count('TRIAL'), previous: rollup?.trialCount ?? null },
        mrrCents: { value: mrr, previous: rollup?.mrrCents ?? null },
        arrCents: { value: mrr * 12, previous: rollup ? rollup.mrrCents * 12 : null },
        pastDue: { value: count('PAST_DUE'), previous: rollup?.pastDueCount ?? null },
        renewals: {
          value: rows.filter((r) => renewsSoon(r, today)).length,
          previous: renewed.length,
        },
        churn: {
          rateBp: current.rateBp,
          previousRateBp: before.base ? before.rateBp : null,
          churned: current.churned,
          base: current.base,
        },
      };
    });
  }

  // ---------- The table ----------

  private filtered(all: readonly Loaded[], q: Filters, today: string): Loaded[] {
    const period = periodOf(q, today);
    return all.filter(
      (l) =>
        matchesSearch(l.row, q.search) &&
        (!q.planId || l.row.plan.id === q.planId) &&
        (!q.billingCycle || l.row.billingCycle === q.billingCycle) &&
        matchesStatus(l.row, q.status, today) &&
        inForce(l, period),
    );
  }

  list(query: Out<typeof SubscriptionsQuery>): Promise<SubscriptionPage> {
    return inTransaction(this.admin, async (tx) => {
      const now = Date.now();
      const [all, plans] = await Promise.all([loadSubscriptions(tx, {}, now), loadPlans(tx)]);
      const order = new Map(plans.map((p, i) => [p.id, i]));
      const rows = sortRows(
        this.filtered(all, query, utcDay(now)).map((l) => l.row),
        query.sort,
        query.dir,
        order,
      );
      const pageSize = query.pageSize ?? 25;
      const pages = Math.max(1, Math.ceil(rows.length / pageSize));
      const page = Math.min(query.page ?? 1, pages);
      return {
        items: rows.slice((page - 1) * pageSize, page * pageSize),
        total: rows.length,
        all: all.length,
        page,
        pageSize,
      };
    });
  }

  availableFirms(): Promise<SubscriptionAvailableFirmList> {
    return inTransaction(this.admin, async (tx) => {
      const [firms, subscribed] = await Promise.all([
        loadFirms(tx),
        tx.platformFirmSubscription.findMany({ select: { businessId: true } }),
      ]);
      const taken = new Set(subscribed.map((s) => s.businessId));
      const items = [...firms.values()]
        .filter((f) => (f.status === 'ACTIVE' || f.status === 'PENDING_SETUP') && !taken.has(f.id))
        .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id))
        .map((f) => ({
          id: f.id,
          name: f.name,
          slug: f.slug,
          status: f.status,
          email: f.contactEmail || null,
          canBill: f.canBill,
        }));
      return { items };
    });
  }

  // ---------- The detail panel ----------

  async detail(id: string): Promise<SubscriptionRecord> {
    // The firm's schedules make their due invoices first (Billing's runner), so the Billing tab
    // shows them.
    await this.billing.runDue();
    return inTransaction(this.admin, (tx) => this.record(tx, id));
  }

  private async record(tx: TxClient, id: string): Promise<SubscriptionRecord> {
    const now = Date.now();
    const today = utcDay(now);
    const loaded = await loadOne(tx, id, now);
    const { sub, firm, row } = loaded;
    const [team, plans, changes, audits, invoices, payments, failed, due, sales] =
      await Promise.all([
        loadTeam(tx),
        tx.platformPlan.findMany({ select: { id: true, name: true } }),
        tx.platformSubscriptionChange.findMany({
          where: { subscriptionId: id },
          orderBy: [{ effectiveAt: 'desc' }, { id: 'desc' }],
          take: 500,
        }),
        tx.auditLog.findMany({
          where: { businessId: null, entityType: ENTITY, entityId: id },
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          take: 1000,
          select: { id: true, action: true, actorUserId: true, metadata: true, createdAt: true },
        }),
        tx.platformInvoice.findMany({
          where: { businessId: firm.id, status: { not: 'DRAFT' } },
          orderBy: [{ invoiceDate: 'desc' }, { createdAt: 'desc' }],
          take: 50,
          include: {
            lines: { orderBy: { sortOrder: 'asc' }, take: 1, select: { description: true } },
          },
        }),
        tx.platformPayment.findMany({
          where: { businessId: firm.id },
          orderBy: [{ paidOn: 'desc' }, { createdAt: 'desc' }],
          take: 50,
          include: { invoice: { select: { number: true } } },
        }),
        tx.platformPayment.findMany({
          where: {
            businessId: firm.id,
            status: 'FAILED',
            invoice: { status: { in: ['SENT', 'PARTIALLY_PAID'] } },
          },
          orderBy: [{ paidOn: 'desc' }, { createdAt: 'desc' }],
          select: { paidOn: true, failureReason: true },
        }),
        amountDue(tx, firm.id),
        tx.salesOpportunity.findMany({
          where: {
            assignedToUserId: { not: null },
            OR: [
              { transactionKind: SALES_SUBSCRIPTION_KIND, transactionId: id },
              { linkedBusinessId: firm.id },
            ],
          },
          orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
          take: 20,
          select: { id: true, assignedToUserId: true, transactionId: true },
        }),
      ]);
    const notes = notesByRow(
      await tx.auditInvestigationNote.findMany({
        where: { auditLogId: { in: audits.map((a) => a.id) } },
        select: {
          id: true,
          auditLogId: true,
          authorUserId: true,
          body: true,
          supersedesNoteId: true,
          retractedAt: true,
          createdAt: true,
        },
      }),
    );
    const planNames = new Map(plans.map((p) => [p.id, p.name]));
    const lastInto = (status: string) => changes.find((c) => c.toStatus === status) ?? null;
    const trialEnds = dayOrNull(sub.trialEndsAt);
    const owner = sales.find((s) => s.transactionId === id) ?? sales[0];
    const billingDay = billingToday(now);
    const intoSuspension = lastInto('SUSPENDED');
    return {
      ...row,
      today,
      startedOn: loaded.startedOn,
      currentPeriodStart: dayOrNull(sub.currentPeriodStart),
      currentPeriodEnd: dayOrNull(sub.currentPeriodEnd),
      paidThroughOn: dayOrNull(sub.paidThroughDate),
      trial:
        sub.trialStartedAt && trialEnds
          ? {
              startedOn: dayOf(sub.trialStartedAt),
              endsOn: trialEnds,
              daysLeft:
                sub.status === 'TRIAL' ? Math.max(0, subscriptionDaysBetween(today, trialEnds)) : 0,
              convertedOn:
                sub.status !== 'TRIAL' && sub.status !== 'EXPIRED' && sub.startedAt
                  ? dayOf(sub.startedAt)
                  : null,
            }
          : null,
      cancellation:
        sub.cancelRequestedAt && sub.cancelReason !== null
          ? {
              requestedAt: sub.cancelRequestedAt.toISOString(),
              source: SubscriptionRequestSource.safeParse(sub.cancelRequestSource).data ?? 'OTHER',
              notes: sub.cancelReason,
            }
          : null,
      suspension:
        sub.status === 'SUSPENDED' && sub.suspendedAt
          ? {
              kind: suspensionKindOf(
                keptSuspensionKind(audits),
                intoSuspension?.fromStatus ?? null,
              ),
              since: sub.suspendedAt.toISOString(),
              reason: sub.suspendedReason ?? '',
            }
          : null,
      closure:
        sub.status === 'CANCELLED' && sub.closedAt
          ? { closedAt: sub.closedAt.toISOString(), reason: sub.closedReason ?? '' }
          : null,
      pastDue:
        sub.status === 'PAST_DUE'
          ? {
              since: iso(lastInto('PAST_DUE')?.effectiveAt ?? null),
              failedPayments: failed.length,
              lastFailure: failed[0]
                ? { on: dayOf(failed[0].paidOn), reason: failed[0].failureReason ?? '' }
                : null,
            }
          : null,
      accountOwner: owner
        ? { opportunityId: owner.id, name: team.nameOf(owner.assignedToUserId) }
        : null,
      amountDueCents: due,
      invoices: invoices.map((i) => ({
        id: i.id,
        number: i.number,
        issueDate: dayOf(i.invoiceDate),
        dueDate: dayOf(i.dueDate),
        totalCents: i.totalCents,
        balanceCents: Math.max(0, i.totalCents - i.paidCents - i.creditedCents),
        status: invoiceStatus(i, billingDay),
        description: i.lines[0]?.description ?? '',
        forSubscription: i.subscriptionId === id,
        sentAt: iso(i.sentAt),
        sendError: i.sendError === NOT_EMAILED ? null : i.sendError,
      })),
      payments: payments.map((p) => ({
        id: p.id,
        invoiceId: p.invoiceId,
        invoiceNumber: p.invoice.number,
        paidOn: dayOf(p.paidOn),
        amountCents: p.amountCents,
        refundedCents: p.refundedCents,
        method: p.method,
        status: p.status,
        reference: p.reference,
        failureReason: p.failureReason,
      })),
      events: eventsOf({
        changes,
        audits,
        notes,
        planName: (planId) => (planId ? (planNames.get(planId) ?? 'Former plan') : null),
        nameOf: team.nameOf,
      }),
      notes: subscriptionNotesOf(audits, notes, team.nameOf),
    };
  }

  // ---------- Export ----------

  /**
   * Export Subscription Data: the given ids, else the table's filters (by firm name, at most
   * 1,000), with an EXPORTED event on each subscription.
   */
  exportCsv(query: Out<typeof SubscriptionExportQuery>): Promise<string> {
    return inTransaction(this.admin, async (tx) => {
      const now = Date.now();
      const picked = query.ids?.length
        ? await loadSubscriptions(tx, { id: { in: query.ids } }, now)
        : this.filtered(await loadSubscriptions(tx, {}, now), query, utcDay(now));
      const rows = sortRows(picked.map((l) => l.row)).slice(0, EXPORT_CAP);
      const head = [
        'Firm',
        'Email',
        'Domain',
        'Plan',
        'Billing cycle',
        'Status',
        'List price (USD)',
        'Billed price (USD)',
        'Monthly (USD)',
        'Seats used',
        'Seats allowed',
        'Extra locations',
        'Next billing',
        'Access ends',
        'Auto-Renew',
        'Negotiated base price (USD)',
      ];
      const lines = rows.map((r) =>
        [
          r.firm.name,
          r.firm.email,
          r.firm.domain,
          r.plan.name,
          SUBSCRIPTION_CYCLE_LABELS[r.billingCycle],
          SUBSCRIPTION_STATUS_LABELS[r.status],
          dollars(r.listPriceCents),
          dollars(r.priceCents),
          dollars(r.monthlyCents),
          r.seatsUsed,
          r.seatsAllowed,
          r.extraLocations,
          r.nextBillingOn,
          r.accessEndsOn,
          r.autoRenew ? 'On' : 'Off',
          dollars(r.baseOverrideCents),
        ]
          .map(csvCell)
          .join(','),
      );
      for (const r of rows)
        await this.audit.logIn(
          tx,
          ACTIONS.exported,
          { type: ENTITY, id: r.id },
          { firmId: r.firm.id, event: 'EXPORTED' },
          { businessId: null },
        );
      return [head.join(','), ...lines].join('\r\n') + '\r\n';
    });
  }
}
