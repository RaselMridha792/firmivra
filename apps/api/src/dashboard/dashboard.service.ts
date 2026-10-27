import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { type Database, Prisma } from '@firmivra/db';
import {
  type DashboardSummary,
  type DashboardSummaryQuery,
  TAX_RETURN_IN_PROGRESS_STATUSES,
  type TaskPriority,
} from '@firmivra/types';
import type { z } from 'zod';
import { AuditService } from '../audit/audit.service.js';
import type { ClientsActor } from '../clients/clients.service.js';
import { legacyFirmRole } from '../common/request-context.js';
import { DATABASE } from '../database/database.module.js';
import { LIVE_TASK } from '../tasks/task-common.js';
import { TasksService } from '../workspaces/tasks.service.js';
import {
  addDays,
  dueTasks,
  kpi,
  rangeOf,
  revenueOf,
  revenueRangeOf,
  type RevenueRow,
} from './dashboard-math.js';

type SummaryQuery = z.output<typeof DashboardSummaryQuery>;

interface Counts {
  clients_now: number;
  clients_before: number;
  leads_now: number;
  leads_before: number;
  leads_pipeline: number;
  returns_now: number;
  returns_before: number;
  returns_current: number;
  accepted_now: number;
  accepted_before: number;
  accepted_pipeline: number;
  intakes_open: number;
  appointments_today: number;
  outstanding: number;
}

/** The firm's time zone (business settings), so "today" and "this month" are the firm's. */
const zone = (businessId: string) => Prisma.sql`
  SELECT COALESCE(
    (SELECT timezone FROM business_settings WHERE business_id = ${businessId}::uuid),
    'America/New_York') AS tz`;

const invalid = (path: string, message: string) =>
  new BadRequestException({
    code: 'VALIDATION_FAILED',
    message,
    details: [{ path, message }],
  });

/**
 * The dashboard (R30): counts, money and tasks in one read, each query in the firm's scope with
 * `businessId` from TenantGuard. Staff reach only the clients assigned to them, as the clients,
 * tax returns, invoices and tasks lists do (appointments: theirs too); leads are every member's.
 * Periods (C1) are the firm's calendar days: the global one drives the first four KPI cards, the
 * Client Pipeline and Revenue Overview have their own.
 */
@Injectable()
export class DashboardService {
  constructor(
    @Inject(DATABASE) private readonly database: Database,
    private readonly audit: AuditService,
    private readonly tasks: TasksService,
  ) {}

  async summary(
    businessId: string,
    actor: ClientsActor,
    q: SummaryQuery = { period: 'THIS_MONTH', pipelinePeriod: 'THIS_MONTH', revenuePeriod: 'YEAR' },
  ): Promise<DashboardSummary> {
    const staff = actor.role === 'STAFF' ? actor.userId : null;
    // The clients in reach, on a query that names the client `c`.
    const mine = Prisma.sql`(${staff}::uuid IS NULL OR c.assigned_user_id = ${staff}::uuid)`;
    // Leads and Tax Returns scope Staff (and the roles that act as Staff) as those modules do, so
    // each card's count is what its list shows (Octavia's K3 to K5).
    const reachUser = legacyFirmRole(actor.role) === 'STAFF' ? actor.userId : null;
    const reachLead = Prisma.sql`(${reachUser}::uuid IS NULL OR l.assigned_user_id = ${reachUser}::uuid)`;
    const reachReturn = Prisma.sql`(${reachUser}::uuid IS NULL OR c.assigned_user_id = ${reachUser}::uuid)`;
    const inProgress = Prisma.join(
      TAX_RETURN_IN_PROGRESS_STATUSES.map((v) => Prisma.sql`${v}::"TaxReturnWorkflowStatus"`),
    );
    const ofClient = (alias: string) =>
      Prisma.sql`JOIN clients c ON c.business_id = ${Prisma.raw(alias)}.business_id AND c.id = ${Prisma.raw(alias)}.client_id`;
    // A return's workflow status at an instant (its last change before then; a return with no
    // change before then still had its first one), and whether it was Accepted within a span.
    const statusAt = (instant: string) => Prisma.sql`COALESCE(
      (SELECT h.workflow_status FROM tax_return_history h
        WHERE h.business_id = t.business_id AND h.tax_return_id = t.id
          AND h.changed_at < ${Prisma.raw(instant)} ORDER BY h.seq DESC LIMIT 1),
      'IN_PREPARATION')`;
    const acceptedIn = (start: string, end: string) => Prisma.sql`EXISTS (
      SELECT 1 FROM tax_return_history h
        WHERE h.business_id = t.business_id AND h.tax_return_id = t.id
          AND h.workflow_status = 'ACCEPTED' AND h.changed_at >= ${Prisma.raw(start)}
          AND h.changed_at < ${Prisma.raw(end)})`;
    const { today, range, pipeline, revenueRange, counts, revenue, previousCents } =
      await this.database.withScope({ kind: 'business', businessId }, async (tx) => {
        const [day] = await tx.$queryRaw<{ today: string }[]>`
          WITH s AS (${zone(businessId)}) SELECT (now() AT TIME ZONE tz)::date::text AS today FROM s`;
        if (!day) throw new Error('dashboard today returned no row');
        const today = day.today;
        // A Custom period ends today at the latest; a revenue year is never in the future.
        for (const [path, to] of [
          ['to', q.to],
          ['pipelineTo', q.pipelineTo],
          ['revenueTo', q.revenueTo],
        ] as const) {
          if (to && to > today) throw invalid(path, 'The end date cannot be after today');
        }
        if (q.revenueYear && q.revenueYear > Number(today.slice(0, 4))) {
          throw invalid('revenueYear', 'The revenue year cannot be in the future');
        }
        const custom = (from?: string, to?: string) => (from && to ? { from, to } : undefined);
        const range = rangeOf(q.period, today, custom(q.from, q.to));
        const pipeline = rangeOf(q.pipelinePeriod, today, custom(q.pipelineFrom, q.pipelineTo));
        const revenueRange = revenueRangeOf(q.revenuePeriod, today, {
          year: q.revenueYear,
          custom: custom(q.revenueFrom, q.revenueTo),
        });
        // Each period as instants: its first day's midnight to the midnight after its last day.
        const at = (day: string) => Prisma.sql`(${day}::date)::timestamp AT TIME ZONE s.tz`;
        const [counts] = await tx.$queryRaw<Counts[]>`
          WITH s AS (${zone(businessId)}),
          p AS (
            SELECT ${at(range.from)} AS k_start, ${at(addDays(range.to, 1))} AS k_end,
              ${at(range.previousFrom)} AS pk_start, ${at(addDays(range.previousTo, 1))} AS pk_end,
              ${at(pipeline.from)} AS pl_start, ${at(addDays(pipeline.to, 1))} AS pl_end,
              date_trunc('day', now() AT TIME ZONE tz) AT TIME ZONE tz AS day_start,
              (date_trunc('day', now() AT TIME ZONE tz) + interval '1 day') AT TIME ZONE tz AS day_end
            FROM s)
          SELECT
            (SELECT count(*)::int FROM clients c WHERE c.business_id = ${businessId}::uuid
              AND c.created_at < p.k_end
              AND (c.archived_at IS NULL OR c.archived_at >= p.k_end) AND ${mine}) AS clients_now,
            (SELECT count(*)::int FROM clients c WHERE c.business_id = ${businessId}::uuid
              AND c.created_at < p.pk_end
              AND (c.archived_at IS NULL OR c.archived_at >= p.pk_end) AND ${mine}) AS clients_before,
            (SELECT count(*)::int FROM leads l WHERE l.business_id = ${businessId}::uuid
              AND l.status = 'SUBMITTED' AND l.archived_at IS NULL AND ${reachLead}
              AND l.created_at >= p.k_start AND l.created_at < p.k_end) AS leads_now,
            (SELECT count(*)::int FROM leads l WHERE l.business_id = ${businessId}::uuid
              AND l.status = 'SUBMITTED' AND l.archived_at IS NULL AND ${reachLead}
              AND l.created_at >= p.pk_start AND l.created_at < p.pk_end) AS leads_before,
            (SELECT count(*)::int FROM leads l WHERE l.business_id = ${businessId}::uuid
              AND l.status = 'SUBMITTED' AND l.archived_at IS NULL AND ${reachLead}
              AND l.created_at >= p.pl_start AND l.created_at < p.pl_end) AS leads_pipeline,
            (SELECT count(*)::int FROM tax_returns t ${ofClient('t')} WHERE t.business_id = ${businessId}::uuid
              AND t.archived_at IS NULL AND t.workflow_status IN (${inProgress})
              AND ${reachReturn}) AS returns_current,
            (SELECT count(*)::int FROM tax_returns t ${ofClient('t')} WHERE t.business_id = ${businessId}::uuid
              AND t.archived_at IS NULL AND ${reachReturn}
              AND t.created_at < p.k_end AND ${statusAt('p.k_end')} IN (${inProgress})) AS returns_now,
            (SELECT count(*)::int FROM tax_returns t ${ofClient('t')} WHERE t.business_id = ${businessId}::uuid
              AND t.archived_at IS NULL AND ${reachReturn}
              AND t.created_at < p.pk_end AND ${statusAt('p.pk_end')} IN (${inProgress})) AS returns_before,
            (SELECT count(*)::int FROM tax_returns t ${ofClient('t')} WHERE t.business_id = ${businessId}::uuid
              AND t.archived_at IS NULL AND t.workflow_status = 'ACCEPTED' AND ${reachReturn}
              AND ${acceptedIn('p.k_start', 'p.k_end')}) AS accepted_now,
            (SELECT count(*)::int FROM tax_returns t ${ofClient('t')} WHERE t.business_id = ${businessId}::uuid
              AND t.archived_at IS NULL AND ${reachReturn}
              AND ${acceptedIn('p.pk_start', 'p.pk_end')}) AS accepted_before,
            (SELECT count(*)::int FROM tax_returns t ${ofClient('t')} WHERE t.business_id = ${businessId}::uuid
              AND t.archived_at IS NULL AND t.workflow_status = 'ACCEPTED' AND ${reachReturn}
              AND ${acceptedIn('p.pl_start', 'p.pl_end')}) AS accepted_pipeline,
            (SELECT count(*)::int FROM intakes i
              JOIN engagements e ON e.business_id = i.business_id AND e.id = i.engagement_id
              ${ofClient('e')} WHERE i.business_id = ${businessId}::uuid
              AND i.status IN ('SENT', 'IN_PROGRESS', 'SUBMITTED', 'NEEDS_CORRECTION', 'UNDER_REVIEW')
              AND ${mine}) AS intakes_open,
            (SELECT count(*)::int FROM appointments a ${ofClient('a')} WHERE a.business_id = ${businessId}::uuid
              AND a.status = 'SCHEDULED' AND a.starts_at >= p.day_start AND a.starts_at < p.day_end
              AND (${mine} OR a.staff_user_id = ${staff}::uuid)) AS appointments_today,
            (SELECT COALESCE(sum(GREATEST(0, i.total_cents - app_invoice_paid_cents(i.id))), 0)::float8
              FROM invoices i ${ofClient('i')} WHERE i.business_id = ${businessId}::uuid
              AND i.status = 'OPEN' AND ${mine}) AS outstanding
          FROM p, s`;
        if (!counts) throw new Error('dashboard counts returned no row');
        // Money received, on the firm's calendar: Stripe payments when paid, less refunds when
        // confirmed, plus check and cash on the day received (a voided one never counts).
        const money = Prisma.sql`
          money AS (
            SELECT pm.invoice_id, (pm.paid_at AT TIME ZONE s.tz)::date AS day, pm.amount_cents AS cents
              FROM payments pm, s WHERE pm.business_id = ${businessId}::uuid
              AND pm.status IN ('SUCCEEDED', 'REFUNDED') AND pm.paid_at IS NOT NULL
            UNION ALL
            SELECT pm.invoice_id, (r.refunded_at AT TIME ZONE s.tz)::date, -r.amount_cents
              FROM payment_refunds r
              JOIN payments pm ON pm.business_id = r.business_id AND pm.id = r.payment_id, s
              WHERE r.business_id = ${businessId}::uuid AND r.status = 'SUCCEEDED'
              AND r.refunded_at IS NOT NULL
            UNION ALL
            SELECT o.invoice_id, o.received_on, o.amount_cents FROM offline_payments o
              WHERE o.business_id = ${businessId}::uuid AND o.voided_at IS NULL)`;
        const revenue = await tx.$queryRaw<RevenueRow[]>`
          WITH s AS (${zone(businessId)}),
          ${money}
          SELECT m.day::text AS day, sv.id AS "serviceId", sv.name, sum(m.cents)::float8 AS cents
          FROM money m
          JOIN invoices i ON i.business_id = ${businessId}::uuid AND i.id = m.invoice_id
          ${ofClient('i')}
          LEFT JOIN engagements e ON e.business_id = i.business_id AND e.id = i.engagement_id
          LEFT JOIN services sv ON sv.business_id = e.business_id AND sv.id = e.service_id
          WHERE m.day BETWEEN ${revenueRange.from}::date AND ${revenueRange.to}::date
            AND ${mine}
          GROUP BY 1, 2, 3`;
        // The equivalent span before; null when no money was received in it at all.
        const [before] = await tx.$queryRaw<{ cents: number | null }[]>`
          WITH s AS (${zone(businessId)}),
          ${money}
          SELECT sum(m.cents)::float8 AS cents
          FROM money m
          JOIN invoices i ON i.business_id = ${businessId}::uuid AND i.id = m.invoice_id
          ${ofClient('i')}
          WHERE m.day BETWEEN ${revenueRange.previousFrom}::date AND ${revenueRange.previousTo}::date
            AND ${mine}`;
        return {
          today,
          range,
          pipeline,
          revenueRange,
          counts,
          revenue,
          previousCents: before?.cents ?? null,
        };
      });
    const open = await this.tasks.list(businessId, actor, { status: 'OPEN', limit: 5 });
    const priorities = new Map(
      (
        await this.database.forBusiness(businessId).task.findMany({
          where: { businessId, id: { in: open.items.map((t) => t.id) }, ...LIVE_TASK },
          select: { id: true, priority: true },
        })
      ).map((t): [string, TaskPriority] => [t.id, t.priority]),
    );
    await this.audit.log('dashboard.viewed', { type: 'dashboard' });
    const c = counts;
    // Now: the exact count by status; a period that ended earlier: the status history then.
    const returnsNow = range.to === today ? c.returns_current : c.returns_now;
    return {
      today,
      range,
      kpis: {
        totalClients: kpi(c.clients_now, c.clients_before),
        newLeads: kpi(c.leads_now, c.leads_before),
        returnsInProgress: kpi(returnsNow, c.returns_before),
        acceptedReturns: kpi(c.accepted_now, c.accepted_before),
        outstandingInvoicesCents: kpi(c.outstanding, null),
        appointmentsToday: kpi(c.appointments_today, null),
      },
      pipeline: {
        leads: c.leads_pipeline,
        consultation: null,
        intake: c.intakes_open,
        inProgress: c.returns_current,
        completed: c.accepted_pipeline,
        period: pipeline.period,
        from: pipeline.from,
        to: pipeline.to,
      },
      revenue: revenueOf(
        revenue,
        { period: q.revenuePeriod, from: revenueRange.from, to: revenueRange.to },
        previousCents,
      ),
      tasksDue: dueTasks(open.items, priorities),
      // The firm's settings hold no tax season yet (R0 adds the columns); then it is filled here.
      taxSeason: null,
    };
  }
}
