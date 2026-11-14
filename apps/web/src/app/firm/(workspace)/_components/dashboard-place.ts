import { DashboardPeriod, DashboardRevenuePeriod } from '@firmivra/types';

// Octavia's K2, C1 and V9 (Dashboard Review 2): the dashboard's three periods live in its address,
// so Back to Dashboard (and the browser's Back) returns to the periods the member chose. Plain
// functions: the server page reads the address with them too.

export type PeriodChoice<P extends string> = { period: P; from?: string; to?: string };

export type DashboardPlace = {
  period: PeriodChoice<DashboardPeriod>;
  pipeline: PeriodChoice<DashboardPeriod>;
  revenue: PeriodChoice<DashboardRevenuePeriod>;
};

export const DEFAULT_PLACE: DashboardPlace = {
  period: { period: 'THIS_MONTH' },
  pipeline: { period: 'THIS_MONTH' },
  revenue: { period: 'YEAR' },
};

/** Each period's address keys: the period, and a Custom period's first and last day. */
const KEYS = {
  period: ['period', 'start', 'end'],
  pipeline: ['pipeline', 'pipelineStart', 'pipelineEnd'],
  revenue: ['revenue', 'revenueStart', 'revenueEnd'],
} as const;

const DAY = /^\d{4}-\d{2}-\d{2}$/;
type Read = (key: string) => string | undefined;

function choice<P extends string>(
  read: Read,
  [periodKey, startKey, endKey]: readonly [string, string, string],
  allowed: readonly P[],
  fallback: PeriodChoice<P>,
): PeriodChoice<P> {
  const period = allowed.find((p) => p === read(periodKey));
  if (!period) return fallback;
  if (period !== 'CUSTOM') return { period };
  const from = read(startKey);
  const to = read(endKey);
  // A Custom period without both valid days is not one the API takes: the default instead.
  return from && to && DAY.test(from) && DAY.test(to) && from <= to
    ? { period, from, to }
    : fallback;
}

/** The dashboard's periods from its address (anything unknown or invalid: the default). */
export function placeFrom(read: Read): DashboardPlace {
  return {
    period: choice(read, KEYS.period, DashboardPeriod.options, DEFAULT_PLACE.period),
    pipeline: choice(read, KEYS.pipeline, DashboardPeriod.options, DEFAULT_PLACE.pipeline),
    revenue: choice(read, KEYS.revenue, DashboardRevenuePeriod.options, DEFAULT_PLACE.revenue),
  };
}

/** The dashboard's address for these periods: `/`, plus each period that is not the default. */
export function addressOf(place: DashboardPlace): string {
  const params = new URLSearchParams();
  for (const name of ['period', 'pipeline', 'revenue'] as const) {
    const value = place[name];
    if (value.period === DEFAULT_PLACE[name].period) continue;
    const [periodKey, startKey, endKey] = KEYS[name];
    params.set(periodKey, value.period);
    if (value.period === 'CUSTOM' && value.from && value.to) {
      params.set(startKey, value.from);
      params.set(endKey, value.to);
    }
  }
  const query = params.toString();
  return query ? `/?${query}` : '/';
}
