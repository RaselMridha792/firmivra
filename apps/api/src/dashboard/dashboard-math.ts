import type { DashboardKpi, DashboardRevenue, DashboardTask, Task } from '@firmivra/types';

/** One row of the revenue query: net cents received in one month of the year for one service. */
export interface RevenueRow {
  month: number;
  serviceId: string | null;
  name: string | null;
  cents: number;
}

export const kpi = (value: number, previous: number | null): DashboardKpi => ({ value, previous });

/**
 * The year's money by month and by service. A month or a service can be negative when refunds
 * exceed the money received in it; services at or below zero are left out of the breakdown,
 * since a share of a donut cannot be negative. The total is always the sum of the months.
 */
export function revenueOf(rows: RevenueRow[], year: number): DashboardRevenue {
  const byMonthCents = Array.from({ length: 12 }, () => 0);
  const services = new Map<string, DashboardRevenue['byService'][number]>();
  for (const row of rows) {
    if (row.month < 1 || row.month > 12) continue;
    byMonthCents[row.month - 1] = (byMonthCents[row.month - 1] ?? 0) + row.cents;
    const key = row.serviceId ?? '';
    const service = services.get(key) ?? { serviceId: row.serviceId, name: row.name, cents: 0 };
    service.cents += row.cents;
    services.set(key, service);
  }
  return {
    year,
    totalCents: byMonthCents.reduce((sum, cents) => sum + cents, 0),
    byMonthCents,
    byService: [...services.values()]
      .filter((s) => s.cents > 0)
      .sort((a, b) => b.cents - a.cents || (a.name ?? '').localeCompare(b.name ?? '')),
  };
}

/** Open tasks with a due date, in the order given (the tasks list's: soonest first), at most 5. */
export function dueTasks(tasks: Task[]): DashboardTask[] {
  return tasks
    .flatMap((t) =>
      t.status === 'OPEN' && t.dueOn
        ? [{ id: t.id, title: t.title, dueOn: t.dueOn, client: t.client }]
        : [],
    )
    .slice(0, 5);
}
