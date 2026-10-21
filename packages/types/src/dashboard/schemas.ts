import { z } from 'zod';
import { TaskPriority } from '../db-enums.js';

// The firm dashboard (R30): one read, GET /api/v1/business/dashboard/summary, for Owner, Admin and
// Staff. Staff get the numbers of the clients assigned to them (as the clients, tax returns,
// invoices, appointments and tasks lists show them); leads count for every member. Only values
// the data holds: a number it cannot give is null, never an estimate. Money is whole cents
// ("usd"). Months, "today" and "this month" are the firm's (business settings time zone).

const Count = z.number().int().nonnegative();
const Day = z.iso.date();

/** A KPI card: the number now, and the same number for the period before it. */
export const DashboardKpi = z.object({
  value: Count,
  /** Null when no history keeps it: the card shows no trend. */
  previous: Count.nullable(),
});
export type DashboardKpi = z.infer<typeof DashboardKpi>;

export const DashboardKpis = z.object({
  /** Clients not archived; previous: at the start of this month. */
  totalClients: DashboardKpi,
  /** Leads sent this month; previous: last month. */
  newLeads: DashboardKpi,
  /** Tax returns IN_PROGRESS; previous: 7 days ago (a return reworked after a rejection counts from its first filing). */
  returnsInProgress: DashboardKpi,
  /** Tax returns first filed this month; previous: last month. */
  completedReturns: DashboardKpi,
  /** Balance due on OPEN invoices, in cents; previous is null (partial payments keep no history). */
  outstandingInvoicesCents: DashboardKpi,
  /** Scheduled appointments today; previous is null (the design compares none). */
  appointmentsToday: DashboardKpi,
});
export type DashboardKpis = z.infer<typeof DashboardKpis>;

/** The Client Pipeline's period selector: "Completed" counts returns first filed in it. */
export const DashboardPipelinePeriod = z.enum(['THIS_MONTH', 'LAST_MONTH', 'THIS_YEAR']);
export type DashboardPipelinePeriod = z.infer<typeof DashboardPipelinePeriod>;

/**
 * GET /business/dashboard/summary's query: the Client Pipeline period (default this month) and
 * the year of Revenue Overview and Service Breakdown (default this year; a future year is refused).
 */
export const DashboardSummaryQuery = z.strictObject({
  pipelinePeriod: DashboardPipelinePeriod.optional().default('THIS_MONTH'),
  revenueYear: z.coerce.number().int().min(2000).max(2100).optional(),
});
export type DashboardSummaryQuery = z.input<typeof DashboardSummaryQuery>;

/** The design's five stages. Null: no record holds that stage (Consultation, for now). */
export const DashboardPipeline = z.object({
  /** Leads waiting for the firm (SUBMITTED or IN_REVIEW). */
  leads: Count.nullable(),
  consultation: Count.nullable(),
  /** Intakes not finished (sent, being filled, submitted, to correct or under review). */
  intake: Count.nullable(),
  /** The same as kpis.returnsInProgress.value. */
  inProgress: Count.nullable(),
  /** Tax returns first filed in `period` (this month: the same as kpis.completedReturns.value). */
  completed: Count.nullable(),
  /** The period `completed` counts. */
  period: DashboardPipelinePeriod,
});
export type DashboardPipeline = z.infer<typeof DashboardPipeline>;

/** Money received this year (Stripe payments less confirmed refunds, plus live check and cash). */
export const DashboardRevenue = z.object({
  year: z.number().int(),
  totalCents: z.number().int(),
  /**
   * The year before over the same span (to the same day of the year for this year, the whole year
   * for a past year), for "vs last year"; null when the firm has no payments that early.
   */
  previousYearCents: z.number().int().nullable(),
  /** Twelve months, January first. */
  byMonthCents: z.array(z.number().int()).length(12),
  /** Through the invoice's engagement; serviceId null: invoices with no engagement. Largest first. */
  byService: z.array(
    z.object({
      serviceId: z.uuid().nullable(),
      name: z.string().nullable(),
      cents: z.number().int(),
    }),
  ),
});
export type DashboardRevenue = z.infer<typeof DashboardRevenue>;

/** An open task with a due date, soonest first (at most 5). */
export const DashboardTask = z.object({
  id: z.uuid(),
  title: z.string(),
  dueOn: Day,
  priority: TaskPriority,
  client: z.object({ id: z.uuid(), displayName: z.string() }),
});
export type DashboardTask = z.infer<typeof DashboardTask>;

export const DashboardSummary = z.object({
  /** The firm's today (YYYY-MM-DD), the day every period above is counted from. */
  today: Day,
  kpis: DashboardKpis,
  pipeline: DashboardPipeline,
  revenue: DashboardRevenue,
  tasksDue: z.array(DashboardTask).max(5),
  /**
   * The firm's tax season (the date card: "Tax Season: Jan 15 – May 15, 2027", In Season or
   * Off-Season);  null until the firm's settings hold one.
   */
  taxSeason: z.object({ start: Day, end: Day, inSeason: z.boolean() }).nullable(),
});
export type DashboardSummary = z.infer<typeof DashboardSummary>;
