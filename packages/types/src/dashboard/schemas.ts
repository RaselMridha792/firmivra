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

/**
 * The six cards. `range` (the global period) drives the first four, each compared with the
 * equivalent period before (`range.previousFrom` to `previousTo`); the last two never follow it.
 */
export const DashboardKpis = z.object({
  /** Clients not archived at the end of the period; previous: at the end of the period before. */
  totalClients: DashboardKpi,
  /**
   * Leads still at New Lead (SUBMITTED) that came in the period, as Leads lists them with Stage
   * New Lead and the period's dates; previous: those of the period before, still at New Lead.
   */
  newLeads: DashboardKpi,
  /**
   * Tax returns in one of the in-progress workflow statuses (TAX_RETURN_IN_PROGRESS_STATUSES) at
   * the end of the period, as Tax Returns lists them with Status In Progress (now: their status;
   * earlier: the status history); previous: the same at the end of the period before.
   */
  returnsInProgress: DashboardKpi,
  /**
   * Tax returns Accepted in the period (Octavia's K5: not Transmitted, not Rejected), as Tax
   * Returns lists them with Status Accepted and the period's accepted dates; previous: in the
   * period before.
   */
  acceptedReturns: DashboardKpi,
  /**
   * Balance due on OPEN invoices now, in cents, whatever the period; previous is null (partial
   * payments keep no history to compare).
   */
  outstandingInvoicesCents: DashboardKpi,
  /** Scheduled appointments on the firm's today, whatever the period; previous is null. */
  appointmentsToday: DashboardKpi,
});
export type DashboardKpis = z.infer<typeof DashboardKpis>;

/**
 * The dashboard's periods (Octavia's review of Oct 25, C1), on the firm's calendar. This Week
 * (from Monday), This Month, This Quarter and This Year run to today; Last Month and Last Year
 * are the whole period; Custom is `from` to `to`, both included, ending today at the latest.
 */
export const DashboardPeriod = z.enum([
  'TODAY',
  'THIS_WEEK',
  'THIS_MONTH',
  'LAST_MONTH',
  'THIS_QUARTER',
  'THIS_YEAR',
  'LAST_YEAR',
  'CUSTOM',
]);
export type DashboardPeriod = z.infer<typeof DashboardPeriod>;

/** Kept for older callers: the Client Pipeline now takes any DashboardPeriod. */
export const DashboardPipelinePeriod = DashboardPeriod;
export type DashboardPipelinePeriod = DashboardPeriod;

/** Revenue Overview and Service Breakdown (C2): this month, this quarter, a year, or Custom. */
export const DashboardRevenuePeriod = z.enum(['MONTH', 'QUARTER', 'YEAR', 'CUSTOM']);
export type DashboardRevenuePeriod = z.infer<typeof DashboardRevenuePeriod>;

/** A period's days (both included) and the equivalent period before, for comparisons. */
export const DashboardRange = z.object({
  period: DashboardPeriod,
  from: Day,
  to: Day,
  /**
   * The equivalent elapsed period before: yesterday; last week, last month, the quarter before
   * or last year to the same point; the whole period before for Last Month and Last Year; the
   * same number of days just before a Custom range.
   */
  previousFrom: Day,
  previousTo: Day,
});
export type DashboardRange = z.infer<typeof DashboardRange>;

/** CUSTOM needs both days, `from` on or before `to`; other periods take neither. */
const customRange =
  (period: string, from: string, to: string) =>
  (q: Record<string, unknown>, ctx: z.RefinementCtx) => {
    const custom = q[period] === 'CUSTOM';
    const a = q[from] as string | undefined;
    const b = q[to] as string | undefined;
    if (custom && (!a || !b)) {
      ctx.addIssue({
        code: 'custom',
        path: [a ? to : from],
        message: 'Choose a start and an end date',
      });
    } else if (custom && a && b && a > b) {
      ctx.addIssue({
        code: 'custom',
        path: [to],
        message: 'The end date must be on or after the start date',
      });
    } else if (!custom && (a || b)) {
      ctx.addIssue({
        code: 'custom',
        path: [a ? from : to],
        message: 'Dates go with a Custom period only',
      });
    }
  };

/**
 * GET /business/dashboard/summary's query: the global period (default this month), the Client
 * Pipeline's own period (default this month), and Revenue Overview's period (default the year;
 * `revenueYear` picks an earlier year). Custom days end today at the latest (400 otherwise).
 */
export const DashboardSummaryQuery = z
  .strictObject({
    period: DashboardPeriod.optional().default('THIS_MONTH'),
    from: Day.optional(),
    to: Day.optional(),
    pipelinePeriod: DashboardPeriod.optional().default('THIS_MONTH'),
    pipelineFrom: Day.optional(),
    pipelineTo: Day.optional(),
    revenuePeriod: DashboardRevenuePeriod.optional().default('YEAR'),
    revenueFrom: Day.optional(),
    revenueTo: Day.optional(),
    revenueYear: z.coerce.number().int().min(2000).max(2100).optional(),
  })
  .superRefine(customRange('period', 'from', 'to'))
  .superRefine(customRange('pipelinePeriod', 'pipelineFrom', 'pipelineTo'))
  .superRefine(customRange('revenuePeriod', 'revenueFrom', 'revenueTo'))
  .refine((q) => q.revenueYear === undefined || q.revenuePeriod === 'YEAR', {
    path: ['revenueYear'],
    message: 'A revenue year goes with the Year period only',
  });
export type DashboardSummaryQuery = z.input<typeof DashboardSummaryQuery>;

/**
 * The design's five stages (Octavia's C5: each opens its list filtered to exactly what it counts).
 * Null: no record holds that stage (Consultation, for now). Leads and Completed follow `from` to
 * `to`; Intake and In Progress are open now, as their lists show them.
 */
export const DashboardPipeline = z.object({
  /**
   * Leads at New Lead that came in the period, as the Leads list shows them with Stage New Lead
   * and the period's dates (Staff: those assigned to them, as kpis.newLeads).
   */
  leads: Count.nullable(),
  consultation: Count.nullable(),
  /**
   * Intakes not finished now (sent, being filled, to correct, submitted or under review): the
   * Intake Forms list's Not Finished view (`tab=open`).
   */
  intake: Count.nullable(),
  /**
   * Tax returns in an in-progress workflow status now (TAX_RETURN_IN_PROGRESS_STATUSES), as Tax
   * Returns lists them with Status In Progress; the same as kpis.returnsInProgress when the global
   * period ends today.
   */
  inProgress: Count.nullable(),
  /**
   * Tax returns Accepted in the period (K5: not Transmitted, not Rejected), as Tax Returns lists
   * them with Status Accepted and the period's accepted dates. The stage reads "Accepted".
   */
  completed: Count.nullable(),
  /** The period `completed` counts, and its days. */
  period: DashboardPeriod,
  from: Day,
  to: Day,
});
export type DashboardPipeline = z.infer<typeof DashboardPipeline>;

/**
 * Money received in the revenue period (Stripe payments less confirmed refunds, plus live check
 * and cash), on the firm's calendar.
 */
export const DashboardRevenue = z.object({
  period: DashboardRevenuePeriod,
  /** The days counted (a year to date for this year; the whole year for an earlier one). */
  from: Day,
  to: Day,
  totalCents: z.number().int(),
  /**
   * The equivalent span before (last month or the quarter before to the same day, last year to
   * the same day or the whole year, the same number of days before a Custom range), for the
   * comparison; null when the firm received no money in it.
   */
  previousCents: z.number().int().nullable(),
  /**
   * The chart's bars, each with its days: days for a month or a Custom range of up to 62 days,
   * months otherwise. A year shows all twelve months (the months to come at zero).
   */
  buckets: z.array(z.object({ from: Day, to: Day, cents: z.number().int() })).max(62),
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
  /** The global period, which the first four KPI cards follow. */
  range: DashboardRange,
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
