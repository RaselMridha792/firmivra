import type {
  DashboardKpi,
  DashboardRevenue,
  DashboardTask,
  Task,
  TaskPriority,
} from '@firmivra/types';

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
export function revenueOf(
  rows: RevenueRow[],
  year: number,
  previousYearCents: number | null,
): DashboardRevenue {
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
    previousYearCents,
    byMonthCents,
    byService: [...services.values()]
      .filter((s) => s.cents > 0)
      .sort((a, b) => b.cents - a.cents || (a.name ?? '').localeCompare(b.name ?? '')),
  };
}

/**
 * Open tasks with a due date, in the order given (the tasks list's: soonest first), at most 5,
 * each with its priority (MEDIUM, the column's default, when the lookup has none).
 */
export function dueTasks(tasks: Task[], priorities: Map<string, TaskPriority>): DashboardTask[] {
  return tasks
    .flatMap((t) =>
      t.status === 'OPEN' && t.dueOn
        ? [
            {
              id: t.id,
              title: t.title,
              dueOn: t.dueOn,
              priority: priorities.get(t.id) ?? 'MEDIUM',
              client: t.client,
            },
          ]
        : [],
    )
    .slice(0, 5);
}

/** The pipeline's Completed count for the chosen period (DashboardPipelinePeriod). */
export function completedIn(
  period: 'THIS_MONTH' | 'LAST_MONTH' | 'THIS_YEAR',
  counts: { thisMonth: number; lastMonth: number; thisYear: number },
): number {
  return period === 'LAST_MONTH'
    ? counts.lastMonth
    : period === 'THIS_YEAR'
      ? counts.thisYear
      : counts.thisMonth;
}
