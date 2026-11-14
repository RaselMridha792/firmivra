'use client';

import type { DashboardPeriod, DashboardRevenuePeriod } from '@firmivra/types';
import { useId, useState } from 'react';

/** The dashboard's periods (Octavia's review of Oct 25, C1), in her order. */
export const PERIOD_LABELS: Record<DashboardPeriod, string> = {
  TODAY: 'Today',
  THIS_WEEK: 'This Week',
  THIS_MONTH: 'This Month',
  LAST_MONTH: 'Last Month',
  THIS_QUARTER: 'This Quarter',
  THIS_YEAR: 'This Year',
  LAST_YEAR: 'Last Year',
  CUSTOM: 'Custom',
};

/** Revenue Overview's periods (C2). */
export const REVENUE_LABELS: Record<DashboardRevenuePeriod, string> = {
  MONTH: 'This Month',
  QUARTER: 'This Quarter',
  YEAR: 'This Year',
  CUSTOM: 'Custom',
};

/**
 * What a comparison is against, worded as the API counts it: the equivalent elapsed period
 * before (rangeOf in packages/types).
 */
export function comparedWith(period: DashboardPeriod, days?: number): string {
  switch (period) {
    case 'TODAY':
      return 'vs yesterday';
    case 'THIS_WEEK':
      return 'vs last week to date';
    case 'THIS_MONTH':
      return 'vs last month to date';
    case 'LAST_MONTH':
      return 'vs the month before';
    case 'THIS_QUARTER':
      return 'vs last quarter to date';
    case 'THIS_YEAR':
      return 'vs last year to date';
    case 'LAST_YEAR':
      return 'vs the year before';
    case 'CUSTOM':
      return days === 1
        ? 'vs the day before'
        : days
          ? `vs the ${days} days before`
          : 'vs the days before';
  }
}

export type PeriodChoice<P extends string> = { period: P; from?: string; to?: string };

/**
 * A period dropdown; Custom adds a start and an end date, applied once both are valid (the start
 * on or before the end, the end not after the firm's today). A bad pair stays in the fields with
 * the reason and changes nothing.
 *
 * Dashboard Review 2 (R2 NEW3 to NEW5): it sits in its parent's wrapping row, the dropdown beside
 * the title, and Custom's From and To, each label with its field, take the next row whole (side by
 * side on a desktop, one under the other when narrow), so the title never wraps.
 */
export function PeriodSelect<P extends string>({
  label,
  value,
  labels,
  today,
  onChange,
  align = 'start',
}: {
  /** The accessible name: "Dashboard period", "Client Pipeline period"… */
  label: string;
  value: PeriodChoice<P>;
  labels: Record<P, string>;
  /** The firm's today (YYYY-MM-DD), the latest end a Custom period may have. */
  today: string | undefined;
  onChange: (next: PeriodChoice<P>) => void;
  /** Where Custom's dates line up on their row: under the title, or under the dropdown. */
  align?: 'start' | 'end';
}) {
  const id = useId();
  const [custom, setCustom] = useState({ from: value.from ?? '', to: value.to ?? '' });
  const [choosing, setChoosing] = useState(value.period === 'CUSTOM');
  const problem =
    custom.from && custom.to
      ? custom.from > custom.to
        ? 'The end date must be on or after the start date.'
        : today && custom.to > today
          ? 'The end date cannot be after today.'
          : null
      : null;
  const apply = (next: { from: string; to: string }) => {
    setCustom(next);
    const bad = next.from > next.to || (today !== undefined && next.to > today);
    if (next.from && next.to && !bad) onChange({ period: 'CUSTOM' as P, ...next });
  };
  const pair = 'flex items-center gap-2';
  return (
    <>
      <select
        aria-label={label}
        value={choosing ? 'CUSTOM' : value.period}
        onChange={(e) => {
          const period = e.target.value as P;
          if (period === 'CUSTOM') {
            setChoosing(true);
            if (custom.from && custom.to) apply(custom);
          } else {
            setChoosing(false);
            onChange({ period });
          }
        }}
        className="min-h-10 rounded-control border border-control-border bg-surface px-3 text-sm text-heading"
      >
        {(Object.keys(labels) as P[]).map((p) => (
          <option key={p} value={p}>
            {labels[p]}
          </option>
        ))}
      </select>
      {choosing ? (
        <fieldset
          data-testid="custom-dates"
          className={`flex basis-full flex-wrap items-center gap-x-4 gap-y-2 text-sm ${align === 'end' ? 'justify-end' : ''}`}
        >
          <legend className="sr-only">{label}: custom dates</legend>
          <div className={pair}>
            <label htmlFor={`${id}-from`} className="text-muted">
              From
            </label>
            <input
              id={`${id}-from`}
              type="date"
              value={custom.from}
              max={today}
              onChange={(e) => apply({ ...custom, from: e.target.value })}
              aria-invalid={problem ? true : undefined}
              aria-describedby={problem ? `${id}-problem` : undefined}
              className="min-h-10 rounded-control border border-control-border bg-surface px-2 text-heading"
            />
          </div>
          <div className={pair}>
            <label htmlFor={`${id}-to`} className="text-muted">
              To
            </label>
            <input
              id={`${id}-to`}
              type="date"
              value={custom.to}
              max={today}
              onChange={(e) => apply({ ...custom, to: e.target.value })}
              aria-invalid={problem ? true : undefined}
              aria-describedby={problem ? `${id}-problem` : undefined}
              className="min-h-10 rounded-control border border-control-border bg-surface px-2 text-heading"
            />
          </div>
          {problem ? (
            <span
              id={`${id}-problem`}
              role="alert"
              className={`basis-full text-danger ${align === 'end' ? 'text-right' : ''}`}
            >
              {problem}
            </span>
          ) : null}
        </fieldset>
      ) : null}
    </>
  );
}
