import {
  bucketsOf,
  type DashboardKpi,
  type DashboardRevenue,
  type DashboardRevenuePeriod,
  type DashboardTask,
  shapeOf,
  type Task,
  type TaskPriority,
} from '@firmivra/types';

// The periods live in packages/types (the web's mock and selectors use the same days).
export {
  addDays,
  bucketsOf,
  rangeOf,
  revenueRangeOf,
  shapeOf,
  type BucketShape,
} from '@firmivra/types';

/** One row of the revenue query: net cents received on one firm-local day for one service. */
export interface RevenueRow {
  day: string;
  serviceId: string | null;
  name: string | null;
  cents: number;
}

export const kpi = (value: number, previous: number | null): DashboardKpi => ({ value, previous });

/**
 * The span's money by bar and by service. A bar or a service can be negative when refunds exceed
 * the money received in it; services at or below zero are left out of the breakdown, since a
 * share of a donut cannot be negative. The total is always the sum of the bars.
 */
export function revenueOf(
  rows: RevenueRow[],
  range: { period: DashboardRevenuePeriod; from: string; to: string },
  previousCents: number | null,
): DashboardRevenue {
  const buckets = bucketsOf(range.from, range.to, shapeOf(range.period)).map((b) => ({
    ...b,
    cents: 0,
  }));
  const services = new Map<string, DashboardRevenue['byService'][number]>();
  for (const row of rows) {
    const bucket = buckets.find((b) => b.from <= row.day && row.day <= b.to);
    if (!bucket) continue;
    bucket.cents += row.cents;
    const key = row.serviceId ?? '';
    const service = services.get(key) ?? { serviceId: row.serviceId, name: row.name, cents: 0 };
    service.cents += row.cents;
    services.set(key, service);
  }
  return {
    period: range.period,
    from: range.from,
    to: range.to,
    totalCents: buckets.reduce((sum, b) => sum + b.cents, 0),
    previousCents,
    buckets,
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
