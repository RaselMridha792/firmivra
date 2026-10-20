'use client';

import { Skeleton, tileTones, type TileTone } from '@firmivra/ui';
import {
  ArrowDown,
  ArrowUp,
  CalendarBlank,
  ChartBar,
  ChartPieSlice,
  Clock,
  CurrencyDollar,
  Flask,
  UsersThree,
  type Icon,
} from '@phosphor-icons/react';
import type { UseQueryResult } from '@tanstack/react-query';
import { money } from './format';
import {
  CHURN_FILTER,
  type Figure,
  type StatusFilter,
  type SubscriptionStats,
} from './subscriptions-api';

interface Trend {
  text: string;
  /** null: no change. */
  up: boolean | null;
  good: boolean;
}

/** How a count or amount moved against 30 days ago. */
function trendOf(figure: Figure, goodWhenUp: boolean): Trend | null {
  const { value, previous } = figure;
  if (previous === null) return null;
  if (previous === 0)
    return value === 0
      ? { text: 'No change', up: null, good: true }
      : { text: 'New', up: true, good: goodWhenUp };
  const percent = Math.round(((value - previous) / previous) * 100);
  if (percent === 0) return { text: 'No change', up: null, good: true };
  return { text: `${Math.abs(percent)}%`, up: percent > 0, good: percent > 0 === goodWhenUp };
}

/** The churn rate moves in points: 3.2% against 4.3% is "↓ 1.1%". */
function churnTrend(rate: number, previousRate: number | null): Trend | null {
  if (previousRate === null) return null;
  const points = Math.round((rate - previousRate) * 10) / 10;
  if (points === 0) return { text: 'No change', up: null, good: true };
  return { text: `${Math.abs(points).toFixed(1)}%`, up: points > 0, good: points < 0 };
}

interface Kpi {
  key: string;
  filter: StatusFilter;
  icon: Icon;
  tone: TileTone;
  label: string;
  value: string;
  trend: Trend | null;
  note: string;
}

function kpis(stats: SubscriptionStats | undefined): Kpi[] {
  const count = (figure: Figure | undefined) =>
    figure ? figure.value.toLocaleString('en-US') : '—';
  // Whole dollars, as the design's cards show them ("$12,480"); the trend still uses the cents.
  const amount = (figure: Figure | undefined) =>
    figure ? money(Math.round(figure.value / 100) * 100) : '—';
  const month = 'vs. last month';
  return [
    {
      key: 'active',
      filter: 'ACTIVE',
      icon: UsersThree,
      tone: 'green',
      label: 'Active Subscriptions',
      value: count(stats?.active),
      trend: stats ? trendOf(stats.active, true) : null,
      note: month,
    },
    {
      key: 'trial',
      filter: 'TRIAL',
      icon: Flask,
      tone: 'purple',
      label: 'Trial Accounts',
      value: count(stats?.trial),
      trend: stats ? trendOf(stats.trial, true) : null,
      note: month,
    },
    {
      key: 'mrr',
      filter: 'PAYING',
      icon: CurrencyDollar,
      tone: 'green',
      label: 'Monthly Recurring Revenue (MRR)',
      value: amount(stats?.mrrCents),
      trend: stats ? trendOf(stats.mrrCents, true) : null,
      note: month,
    },
    {
      key: 'arr',
      filter: 'PAYING',
      icon: ChartBar,
      tone: 'blue',
      label: 'Annual Recurring Revenue (ARR)',
      value: amount(stats?.arrCents),
      trend: stats ? trendOf(stats.arrCents, true) : null,
      note: month,
    },
    {
      key: 'past-due',
      filter: 'PAST_DUE',
      icon: Clock,
      tone: 'red',
      label: 'Past Due Accounts',
      value: count(stats?.pastDue),
      trend: stats ? trendOf(stats.pastDue, false) : null,
      note: month,
    },
    {
      key: 'renewals',
      filter: 'RENEWING_SOON',
      icon: CalendarBlank,
      tone: 'amber',
      label: 'Renewals Next 30 Days',
      value: count(stats?.renewals),
      trend: stats ? trendOf(stats.renewals, true) : null,
      note: 'vs. last 30 days',
    },
    {
      key: 'churn',
      filter: CHURN_FILTER,
      icon: ChartPieSlice,
      tone: 'blue',
      label: 'Churn Rate',
      value: stats ? `${stats.churn.rate.toFixed(1)}%` : '—',
      trend: stats ? churnTrend(stats.churn.rate, stats.churn.previousRate) : null,
      note: 'vs. previous period',
    },
  ];
}

/**
 * The seven summary cards. Each one filters the table (MRR and ARR to the paying subscriptions,
 * Churn to the canceled and closed ones); pressing the pressed one clears that filter.
 */
export function SubscriptionKpis({
  stats,
  status,
  onFilter,
}: {
  stats: UseQueryResult<SubscriptionStats>;
  status: StatusFilter | '';
  onFilter: (status: StatusFilter | '') => void;
}) {
  const failed = stats.isError && !stats.data;
  return (
    <section
      aria-label="Subscription summary"
      className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 min-[1440px]:grid-cols-7"
    >
      {kpis(stats.data).map((kpi) => {
        const pressed = status === kpi.filter;
        const Arrow = kpi.trend?.up ? ArrowUp : ArrowDown;
        return (
          <button
            key={kpi.key}
            type="button"
            data-testid={`kpi-${kpi.key}`}
            aria-pressed={pressed}
            onClick={() => onFilter(pressed ? '' : kpi.filter)}
            className={`flex min-w-0 items-start gap-2.5 rounded-xl bg-surface p-3 text-left shadow-md hover:bg-subtle focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus ${pressed ? 'ring-2 ring-action' : ''}`}
          >
            <span
              className={`flex size-10 shrink-0 items-center justify-center rounded-lg ${tileTones[kpi.tone]}`}
            >
              <kpi.icon aria-hidden weight="fill" className="size-6" />
            </span>
            <span className="flex min-w-0 flex-col gap-0.5">
              {stats.isPending ? (
                <Skeleton className="h-6 w-14" />
              ) : (
                <span
                  data-testid={`kpi-${kpi.key}-value`}
                  className="text-lg leading-tight font-bold whitespace-nowrap text-heading min-[1440px]:text-base 2xl:text-xl"
                >
                  {kpi.value}
                </span>
              )}
              <span className="text-xs text-text">{kpi.label}</span>
              {kpi.trend ? (
                <span
                  className={`mt-1 inline-flex items-center gap-1 text-xs font-semibold ${kpi.trend.up === null ? 'text-muted' : kpi.trend.good ? 'text-success' : 'text-danger'}`}
                >
                  {kpi.trend.up === null ? null : (
                    <Arrow aria-hidden weight="bold" className="size-3" />
                  )}
                  <span className="sr-only">
                    {kpi.trend.up === null ? '' : kpi.trend.up ? 'Up ' : 'Down '}
                  </span>
                  {kpi.trend.text}
                </span>
              ) : null}
              <span className="text-xs text-muted">
                {failed ? 'Could not load this right now' : stats.isPending ? '' : kpi.note}
              </span>
            </span>
          </button>
        );
      })}
    </section>
  );
}
