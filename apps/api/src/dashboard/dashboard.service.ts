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
import { completedIn, dueTasks, kpi, revenueOf, type RevenueRow } from './dashboard-math.js';

type SummaryQuery = z.output<typeof DashboardSummaryQuery>;

interface Counts {
  today: string;
  clients_now: number;
  clients_before: number;
  leads_now: number;
  leads_before: number;
  leads_open: number;
  returns_now: number;
  returns_before: number;
  accepted_now: number;
  accepted_before: number;
  filed_now: number;
  filed_before: number;
  filed_year: number;
  intakes_open: number;
  appointments_today: number;
  outstanding: number;
}

/** The firm's time zone (business settings), so "today" and "this month" are the firm's. */
const zone = (businessId: string) => Prisma.sql`
  SELECT COALESCE(
    (SELECT timezone FROM business_settings WHERE business_id = ${businessId}::uuid),
    'America/New_York') AS tz`;

/**
 * The dashboard (R30): counts, money and tasks in one read, each query in the firm's scope with
 * `businessId` from TenantGuard. Staff reach only the clients assigned to them, as the clients,
 * tax returns, invoices and tasks lists do (appointments: theirs too); leads are every member's.
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
    q: SummaryQuery = { pipelinePeriod: 'THIS_MONTH' },
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
    const { counts, revenue, year, previousYearCents } = await this.database.withScope(
      { kind: 'business', businessId },
      async (tx) => {
        const [counts] = await tx.$queryRaw<Counts[]>`
          WITH s AS (${zone(businessId)}),
          p AS (
            SELECT (now() AT TIME ZONE tz)::date AS today,
              date_trunc('month', now() AT TIME ZONE tz) AT TIME ZONE tz AS month_start,
              date_trunc('year', now() AT TIME ZONE tz) AT TIME ZONE tz AS year_start,
              (date_trunc('month', now() AT TIME ZONE tz) - interval '1 month') AT TIME ZONE tz AS last_month_start,
              date_trunc('day', now() AT TIME ZONE tz) AT TIME ZONE tz AS day_start,
              (date_trunc('day', now() AT TIME ZONE tz) + interval '1 day') AT TIME ZONE tz AS day_end,
              now() - interval '7 days' AS week_ago
            FROM s)
          SELECT p.today::text AS today,
            (SELECT count(*)::int FROM clients c WHERE c.business_id = ${businessId}::uuid
              AND c.archived_at IS NULL AND ${mine}) AS clients_now,
            (SELECT count(*)::int FROM clients c WHERE c.business_id = ${businessId}::uuid
              AND c.created_at < p.month_start
              AND (c.archived_at IS NULL OR c.archived_at >= p.month_start) AND ${mine}) AS clients_before,
            (SELECT count(*)::int FROM leads l WHERE l.business_id = ${businessId}::uuid
              AND l.status = 'SUBMITTED' AND l.archived_at IS NULL AND ${reachLead}
              AND l.created_at >= p.month_start) AS leads_now,
            (SELECT count(*)::int FROM leads l WHERE l.business_id = ${businessId}::uuid
              AND l.status = 'SUBMITTED' AND l.archived_at IS NULL AND ${reachLead}
              AND l.created_at >= p.last_month_start AND l.created_at < p.month_start) AS leads_before,
            (SELECT count(*)::int FROM leads l WHERE l.business_id = ${businessId}::uuid
              AND l.status IN ('SUBMITTED', 'IN_REVIEW') AND l.archived_at IS NULL) AS leads_open,
            (SELECT count(*)::int FROM tax_returns t ${ofClient('t')} WHERE t.business_id = ${businessId}::uuid
              AND t.archived_at IS NULL AND t.workflow_status IN (${inProgress})
              AND ${reachReturn}) AS returns_now,
            (SELECT count(*)::int FROM tax_returns t ${ofClient('t')} WHERE t.business_id = ${businessId}::uuid
              AND t.archived_at IS NULL AND ${reachReturn}
              AND t.created_at < p.week_ago
              -- Its status then; a return with no change before then still had its first one.
              AND COALESCE((SELECT h.workflow_status FROM tax_return_history h
                    WHERE h.business_id = t.business_id AND h.tax_return_id = t.id
                      AND h.changed_at < p.week_ago ORDER BY h.seq DESC LIMIT 1),
                    'IN_PREPARATION') IN (${inProgress})
              ) AS returns_before,
            (SELECT count(*)::int FROM tax_returns t ${ofClient('t')} WHERE t.business_id = ${businessId}::uuid
              AND t.archived_at IS NULL AND t.workflow_status = 'ACCEPTED' AND ${reachReturn}
              AND EXISTS (SELECT 1 FROM tax_return_history h
                    WHERE h.business_id = t.business_id AND h.tax_return_id = t.id
                      AND h.workflow_status = 'ACCEPTED' AND h.changed_at >= p.month_start)
              ) AS accepted_now,
            (SELECT count(*)::int FROM tax_returns t ${ofClient('t')} WHERE t.business_id = ${businessId}::uuid
              AND t.archived_at IS NULL AND ${reachReturn}
              AND EXISTS (SELECT 1 FROM tax_return_history h
                    WHERE h.business_id = t.business_id AND h.tax_return_id = t.id
                      AND h.workflow_status = 'ACCEPTED' AND h.changed_at >= p.last_month_start
                      AND h.changed_at < p.month_start)
              ) AS accepted_before,
            (SELECT count(*)::int FROM tax_returns t ${ofClient('t')} WHERE t.business_id = ${businessId}::uuid
              AND t.first_filed_at >= p.month_start AND ${mine}) AS filed_now,
            (SELECT count(*)::int FROM tax_returns t ${ofClient('t')} WHERE t.business_id = ${businessId}::uuid
              AND t.first_filed_at >= p.last_month_start AND t.first_filed_at < p.month_start
              AND ${mine}) AS filed_before,
            (SELECT count(*)::int FROM tax_returns t ${ofClient('t')} WHERE t.business_id = ${businessId}::uuid
              AND t.first_filed_at >= p.year_start AND ${mine}) AS filed_year,
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
          FROM p`;
        if (!counts) throw new Error('dashboard counts returned no row');
        const thisYear = Number(counts.today.slice(0, 4));
        const year = q.revenueYear ?? thisYear;
        if (year > thisYear) {
          throw new BadRequestException({
            code: 'VALIDATION_FAILED',
            message: 'The revenue year cannot be in the future',
            details: [{ path: 'revenueYear', message: 'Choose this year or an earlier one' }],
          });
        }
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
          SELECT extract(month FROM m.day)::int AS month, sv.id AS "serviceId", sv.name,
            sum(m.cents)::float8 AS cents
          FROM money m
          JOIN invoices i ON i.business_id = ${businessId}::uuid AND i.id = m.invoice_id
          ${ofClient('i')}
          LEFT JOIN engagements e ON e.business_id = i.business_id AND e.id = i.engagement_id
          LEFT JOIN services sv ON sv.business_id = e.business_id AND sv.id = e.service_id
          WHERE extract(year FROM m.day) = ${year}
            AND ${mine}
          GROUP BY 1, 2, 3`;
        // The year before over the same span: to today's month and day for this year, the whole
        // year for a past one. Null when no money was received in it at all.
        const span =
          year < thisYear
            ? Prisma.sql`TRUE`
            : Prisma.sql`to_char(m.day, 'MM-DD') <= ${counts.today.slice(5)}`;
        const [before] = await tx.$queryRaw<{ cents: number | null }[]>`
          WITH s AS (${zone(businessId)}),
          ${money}
          SELECT sum(m.cents)::float8 AS cents
          FROM money m
          JOIN invoices i ON i.business_id = ${businessId}::uuid AND i.id = m.invoice_id
          ${ofClient('i')}
          WHERE extract(year FROM m.day) = ${year - 1}
            AND ${span}
            AND ${mine}`;
        return { counts, revenue, year, previousYearCents: before?.cents ?? null };
      },
    );
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
    return {
      today: c.today,
      kpis: {
        totalClients: kpi(c.clients_now, c.clients_before),
        newLeads: kpi(c.leads_now, c.leads_before),
        returnsInProgress: kpi(c.returns_now, c.returns_before),
        acceptedReturns: kpi(c.accepted_now, c.accepted_before),
        outstandingInvoicesCents: kpi(c.outstanding, null),
        appointmentsToday: kpi(c.appointments_today, null),
      },
      pipeline: {
        leads: c.leads_open,
        consultation: null,
        intake: c.intakes_open,
        inProgress: c.returns_now,
        completed: completedIn(q.pipelinePeriod, {
          thisMonth: c.filed_now,
          lastMonth: c.filed_before,
          thisYear: c.filed_year,
        }),
        period: q.pipelinePeriod,
      },
      revenue: revenueOf(revenue, year, previousYearCents),
      tasksDue: dueTasks(open.items, priorities),
      // The firm's settings hold no tax season yet (R0 adds the columns); then it is filled here.
      taxSeason: null,
    };
  }
}
