import {
  bucketsOf,
  type DashboardClient,
  type DashboardSummary,
  DashboardSummaryQuery,
  parseInput,
  rangeOf,
  revenueRangeOf,
  shapeOf,
} from '@firmivra/types';
import { mockDelay } from '../lib/mock';

/**
 * Mock data for `api.dashboard` (R30): every widget filled. Synthetic data only. The numbers are
 * the firm's as a whole; the real API gives Staff those of their assigned clients. Built on
 * first use, around today.
 */
function build(query: DashboardSummaryQuery = {}): DashboardSummary {
  const q = parseInput(DashboardSummaryQuery, query);
  const today = new Date().toISOString().slice(0, 10);
  const thisYear = Number(today.slice(0, 4));
  const custom = (from?: string, to?: string) => (from && to ? { from, to } : undefined);
  const range = rangeOf(q.period, today, custom(q.from, q.to));
  const pipeline = rangeOf(q.pipelinePeriod, today, custom(q.pipelineFrom, q.pipelineTo));
  const revenueRange = revenueRangeOf(q.revenuePeriod, today, {
    year: q.revenueYear,
    custom: custom(q.revenueFrom, q.revenueTo),
  });
  const day = (offset: number) =>
    new Date(Date.parse(`${today}T12:00:00Z`) + offset * 86_400_000).toISOString().slice(0, 10);
  const client = (n: number, displayName: string) => ({
    id: `0199b6a1-0000-7000-8000-00000000000${n}`,
    displayName,
  });
  const service = (n: number, name: string, cents: number) => ({
    serviceId: `0199b6a3-0000-7000-8000-00000000000${n}`,
    name,
    cents,
  });
  // Money on every bar up to today, nothing after it (a year's months to come are zero).
  const pattern = [8, 14, 22, 30, 11, 18, 6, 12, 9, 15, 10, 7];
  const daily =
    shapeOf(q.revenuePeriod) === 'days' ||
    revenueRange.to.slice(0, 7) === revenueRange.from.slice(0, 7);
  const buckets = bucketsOf(revenueRange.from, revenueRange.to, shapeOf(q.revenuePeriod)).map(
    (b, i) => ({
      ...b,
      cents: b.from > today ? 0 : (pattern[i % pattern.length] ?? 0) * (daily ? 4_000 : 100_000),
    }),
  );
  const totalCents = buckets.reduce((sum, b) => sum + b.cents, 0);
  // Flow cards scale with the period's length; Today shows a first acceptance (New) and no leads.
  const days = (Date.parse(range.to) - Date.parse(range.from)) / 86_400_000 + 1;
  // This Month keeps the design's numbers.
  const scale = (n: number) =>
    q.period === 'THIS_MONTH' ? n : Math.max(0, Math.round((n * days) / 30));
  const flows =
    q.period === 'TODAY'
      ? { newLeads: { value: 0, previous: 0 }, acceptedReturns: { value: 3, previous: 0 } }
      : {
          newLeads: { value: scale(24), previous: scale(17) },
          acceptedReturns: { value: scale(52), previous: scale(41) },
        };

  const pipelineDays = (Date.parse(pipeline.to) - Date.parse(pipeline.from)) / 86_400_000 + 1;
  return {
    today,
    range,
    kpis: {
      totalClients: { value: 127, previous: 113 },
      newLeads: flows.newLeads,
      returnsInProgress: { value: 38, previous: 38 },
      acceptedReturns: flows.acceptedReturns,
      outstandingInvoicesCents: { value: 1_856_000, previous: null },
      appointmentsToday: { value: 6, previous: null },
    },
    pipeline: {
      leads: 24,
      consultation: null,
      intake: 15,
      inProgress: 38,
      completed: pipeline.period === 'THIS_MONTH' ? 52 : Math.round((52 * pipelineDays) / 30),
      period: pipeline.period,
      from: pipeline.from,
      to: pipeline.to,
    },
    revenue: {
      period: q.revenuePeriod,
      from: revenueRange.from,
      to: revenueRange.to,
      totalCents,
      previousCents: totalCents > 0 ? Math.round(totalCents / 1.27) : null,
      buckets,
      byService: [
        service(1, 'Personal Tax Prep', Math.round(totalCents * 0.42)),
        service(2, 'Business Tax Prep', Math.round(totalCents * 0.24)),
        service(3, 'Bookkeeping', Math.round(totalCents * 0.14)),
        service(4, 'Payroll', Math.round(totalCents * 0.08)),
        service(5, 'Tax Planning & Strategy', Math.round(totalCents * 0.07)),
        { serviceId: null, name: null, cents: Math.round(totalCents * 0.05) },
      ],
    },
    tasksDue: [
      {
        id: '0199b6a4-0000-7000-8000-000000000001',
        title: 'Review missing docs',
        priority: 'HIGH',
        dueOn: day(0),
        client: client(1, 'Jamie Sample'),
      },
      {
        id: '0199b6a4-0000-7000-8000-000000000002',
        title: 'Send organizer to new lead',
        priority: 'MEDIUM',
        dueOn: day(0),
        client: client(3, 'Riley Example'),
      },
      {
        id: '0199b6a4-0000-7000-8000-000000000003',
        title: 'Complete 1120S draft',
        priority: 'HIGH',
        dueOn: day(1),
        client: client(2, 'Morgan Placeholder'),
      },
      {
        id: '0199b6a4-0000-7000-8000-000000000004',
        title: 'Follow up on payment',
        priority: 'MEDIUM',
        dueOn: day(1),
        client: client(4, 'Taylor Demo'),
      },
      {
        id: '0199b6a4-0000-7000-8000-000000000005',
        title: 'Review bookkeeping Q3',
        priority: 'LOW',
        dueOn: day(3),
        client: client(5, 'Casey Fixture'),
      },
    ],
    // The real API sends null until the firm's settings hold a season (R0's columns); the mock
    // shows one so the date card can be built.
    taxSeason: { start: `${thisYear + 1}-01-15`, end: `${thisYear + 1}-05-15`, inSeason: false },
  };
}

export function createDashboardMock(): DashboardClient {
  return { summary: async (query = {}) => (await mockDelay(), build(query)) };
}
