import { Inject, Injectable } from '@nestjs/common';
import { type Database, Prisma } from '@firmivra/db';
import type { DashboardSummary } from '@firmivra/types';
import { AuditService } from '../audit/audit.service.js';
import type { ClientsActor } from '../clients/clients.service.js';
import { DATABASE } from '../database/database.module.js';
import { TasksService } from '../workspaces/tasks.service.js';
import { dueTasks, kpi, revenueOf, type RevenueRow } from './dashboard-math.js';

interface Counts {
  today: string;
  clients_now: number;
  clients_before: number;
  leads_now: number;
  leads_before: number;
  leads_open: number;
  returns_now: number;
  returns_before: number;
  filed_now: number;
  filed_before: number;
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

  async summary(businessId: string, actor: ClientsActor): Promise<DashboardSummary> {
    const staff = actor.role === 'STAFF' ? actor.userId : null;
    // The clients in reach, on a query that names the client `c`.
    const mine = Prisma.sql`(${staff}::uuid IS NULL OR c.assigned_user_id = ${staff}::uuid)`;
    const ofClient = (alias: string) =>
      Prisma.sql`JOIN clients c ON c.business_id = ${Prisma.raw(alias)}.business_id AND c.id = ${Prisma.raw(alias)}.client_id`;
    const { counts, revenue } = await this.database.withScope(
      { kind: 'business', businessId },
      async (tx) => {
        const [counts] = await tx.$queryRaw<Counts[]>`
          WITH s AS (${zone(businessId)}),
          p AS (
            SELECT (now() AT TIME ZONE tz)::date AS today,
              date_trunc('month', now() AT TIME ZONE tz) AT TIME ZONE tz AS month_start,
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
              AND l.submitted_at >= p.month_start) AS leads_now,
            (SELECT count(*)::int FROM leads l WHERE l.business_id = ${businessId}::uuid
              AND l.submitted_at >= p.last_month_start AND l.submitted_at < p.month_start) AS leads_before,
            (SELECT count(*)::int FROM leads l WHERE l.business_id = ${businessId}::uuid
              AND l.status IN ('SUBMITTED', 'IN_REVIEW')) AS leads_open,
            (SELECT count(*)::int FROM tax_returns t ${ofClient('t')} WHERE t.business_id = ${businessId}::uuid
              AND t.status = 'IN_PROGRESS' AND ${mine}) AS returns_now,
            (SELECT count(*)::int FROM tax_returns t ${ofClient('t')} WHERE t.business_id = ${businessId}::uuid
              AND t.created_at < p.week_ago
              AND (t.first_filed_at IS NULL OR t.first_filed_at >= p.week_ago) AND ${mine}) AS returns_before,
            (SELECT count(*)::int FROM tax_returns t ${ofClient('t')} WHERE t.business_id = ${businessId}::uuid
              AND t.first_filed_at >= p.month_start AND ${mine}) AS filed_now,
            (SELECT count(*)::int FROM tax_returns t ${ofClient('t')} WHERE t.business_id = ${businessId}::uuid
              AND t.first_filed_at >= p.last_month_start AND t.first_filed_at < p.month_start
              AND ${mine}) AS filed_before,
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
        // Money received, on the firm's calendar: Stripe payments when paid, less refunds when
        // confirmed, plus check and cash on the day received (a voided one never counts).
        const revenue = await tx.$queryRaw<RevenueRow[]>`
          WITH s AS (${zone(businessId)}),
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
              WHERE o.business_id = ${businessId}::uuid AND o.voided_at IS NULL)
          SELECT extract(month FROM m.day)::int AS month, sv.id AS "serviceId", sv.name,
            sum(m.cents)::float8 AS cents
          FROM money m
          JOIN invoices i ON i.business_id = ${businessId}::uuid AND i.id = m.invoice_id
          ${ofClient('i')}
          LEFT JOIN engagements e ON e.business_id = i.business_id AND e.id = i.engagement_id
          LEFT JOIN services sv ON sv.business_id = e.business_id AND sv.id = e.service_id
          WHERE extract(year FROM m.day) = (SELECT extract(year FROM now() AT TIME ZONE tz) FROM s)
            AND ${mine}
          GROUP BY 1, 2, 3`;
        if (!counts) throw new Error('dashboard counts returned no row');
        return { counts, revenue };
      },
    );
    const open = await this.tasks.list(businessId, actor, { status: 'OPEN', limit: 5 });
    await this.audit.log('dashboard.viewed', { type: 'dashboard' });
    const c = counts;
    return {
      today: c.today,
      kpis: {
        totalClients: kpi(c.clients_now, c.clients_before),
        newLeads: kpi(c.leads_now, c.leads_before),
        returnsInProgress: kpi(c.returns_now, c.returns_before),
        completedReturns: kpi(c.filed_now, c.filed_before),
        outstandingInvoicesCents: kpi(c.outstanding, null),
        appointmentsToday: kpi(c.appointments_today, null),
      },
      pipeline: {
        leads: c.leads_open,
        consultation: null,
        intake: c.intakes_open,
        inProgress: c.returns_now,
        completed: c.filed_now,
      },
      revenue: revenueOf(revenue, Number(c.today.slice(0, 4))),
      tasksDue: dueTasks(open.items),
    };
  }
}
