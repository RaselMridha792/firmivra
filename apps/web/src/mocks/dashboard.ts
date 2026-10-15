import type { DashboardClient, DashboardSummary } from '@firmivra/types';
import { mockDelay } from '../lib/mock';

/**
 * Mock data for `api.dashboard` (R30): every widget filled. Synthetic data only. The numbers are
 * the firm's as a whole; the real API gives Staff those of their assigned clients. Built on
 * first use, around today.
 */
function build(): DashboardSummary {
  const today = new Date().toISOString().slice(0, 10);
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
  const month = Number(today.slice(5, 7));
  const byMonthCents = [8, 14, 22, 30, 11, 18, 6, 12, 9, 15, 10, 7].map((k, i) =>
    i < month ? k * 100_000 : 0,
  );
  const totalCents = byMonthCents.reduce((sum, c) => sum + c, 0);

  return {
    today,
    kpis: {
      totalClients: { value: 127, previous: 113 },
      newLeads: { value: 24, previous: 17 },
      returnsInProgress: { value: 38, previous: 32 },
      completedReturns: { value: 52, previous: 41 },
      outstandingInvoicesCents: { value: 1_856_000, previous: null },
      appointmentsToday: { value: 6, previous: null },
    },
    pipeline: { leads: 24, consultation: null, intake: 15, inProgress: 38, completed: 52 },
    revenue: {
      year: Number(today.slice(0, 4)),
      totalCents,
      byMonthCents,
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
        dueOn: day(0),
        client: client(1, 'Jamie Sample'),
      },
      {
        id: '0199b6a4-0000-7000-8000-000000000002',
        title: 'Send organizer to new lead',
        dueOn: day(0),
        client: client(3, 'Riley Example'),
      },
      {
        id: '0199b6a4-0000-7000-8000-000000000003',
        title: 'Complete 1120S draft',
        dueOn: day(1),
        client: client(2, 'Morgan Placeholder'),
      },
      {
        id: '0199b6a4-0000-7000-8000-000000000004',
        title: 'Follow up on payment',
        dueOn: day(1),
        client: client(4, 'Taylor Demo'),
      },
      {
        id: '0199b6a4-0000-7000-8000-000000000005',
        title: 'Review bookkeeping Q3',
        dueOn: day(3),
        client: client(5, 'Casey Fixture'),
      },
    ],
  };
}

export function createDashboardMock(): DashboardClient {
  return { summary: async () => (await mockDelay(), build()) };
}
