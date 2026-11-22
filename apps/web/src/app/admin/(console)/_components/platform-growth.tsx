'use client';

import type { AdminGrowth } from '@firmivra/types';
import { DateRangePicker } from '@firmivra/ui';
import { ChartColumn, ChevronDown } from 'lucide-react';
import { useId, useState } from 'react';
import { PageState } from '../../../../components/page-state';
import { api } from '../../../../lib/api';
import {
  easternToday,
  GROWTH_MAX_DAYS,
  GROWTH_RANGES,
  type GrowthRange,
  rangeDates,
  spanDays,
} from '../../../../lib/growth-ranges';
import { useApiQuery } from '../../../../lib/query';
import { SectionTitle } from './section-title';

/** Chart area in SVG units; the SVG scales to the card's width. */
const W = 420;
const H = 170;
const PAD = { left: 28, right: 40, top: 10, bottom: 26 };

const SERIES = [
  {
    key: 'applications',
    label: 'Applications',
    line: 'stroke-info',
    dot: 'fill-info',
    swatch: 'bg-info',
  },
  {
    key: 'activeFirms',
    label: 'Active Firms',
    line: 'stroke-success',
    dot: 'fill-success',
    swatch: 'bg-success',
  },
  {
    key: 'revenueCents',
    label: 'Revenue',
    line: 'stroke-purple',
    dot: 'fill-purple',
    swatch: 'bg-purple',
  },
] as const;

const LABEL = Object.fromEntries(GROWTH_RANGES) as Record<GrowthRange, string>;
const dollars = (cents: number) =>
  new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(cents / 100);

/**
 * Platform Growth (SA-DSH-F06): applications, active firms and Firmivra's revenue over the
 * chosen range, by day, week or month as the API buckets it. Nine ranges and a Custom Date
 * Range; each loads its own data. Days are US Eastern; This Week starts on Monday (Y02).
 */
export function PlatformGrowth() {
  const id = useId();
  const [range, setRange] = useState<GrowthRange>('LAST_30');
  const [custom, setCustom] = useState({ from: '', to: '' });
  const [reversed, setReversed] = useState(false);
  const [today] = useState(easternToday);
  const dates =
    range === 'CUSTOM'
      ? custom.from && custom.to && !reversed
        ? custom
        : null
      : rangeDates(range, today);
  const tooLong = dates !== null && spanDays(dates.from, dates.to) > GROWTH_MAX_DAYS;
  return (
    <>
      <SectionTitle
        icon={ChartColumn}
        nowrap
        className="flex-wrap sm:flex-nowrap"
        action={
          <span className="relative ml-auto shrink-0">
            <label className="sr-only" htmlFor={id}>
              Range
            </label>
            <select
              id={id}
              value={range}
              onChange={(event) => setRange(event.target.value as GrowthRange)}
              className="min-h-0 appearance-none rounded-control border border-border bg-surface py-1.5 pl-2.5 pr-7 text-sm text-text"
            >
              {GROWTH_RANGES.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
            <ChevronDown
              aria-hidden
              className="pointer-events-none absolute top-1/2 right-2 size-4 -translate-y-1/2 text-muted"
            />
          </span>
        }
      >
        Platform Growth <span className="text-sm font-normal text-muted">(Beta)</span>
      </SectionTitle>
      {range === 'CUSTOM' ? (
        <div className="mt-2">
          <DateRangePicker
            label="Custom Date Range"
            value={custom}
            onChange={setCustom}
            strict
            onReversedChange={setReversed}
          />
          {tooLong ? (
            <p role="alert" className="mt-1 text-sm text-danger">
              Choose two years or less.
            </p>
          ) : null}
        </div>
      ) : null}
      {dates && !tooLong ? (
        <Growth from={dates.from} to={dates.to} label={LABEL[range]} />
      ) : range === 'CUSTOM' && !tooLong ? (
        <p className="mt-3 text-sm text-muted">Choose a start and an end date.</p>
      ) : null}
    </>
  );
}

function Growth({ from, to, label }: { from: string; to: string; label: string }) {
  const growth = useApiQuery(['admin-dashboard', 'growth', from, to], () =>
    api.firmApplications.growth({ from, to }),
  );
  return <PageState query={growth}>{(data) => <Chart data={data} rangeLabel={label} />}</PageState>;
}

const shortDay = (day: string, withYear: boolean) =>
  new Intl.DateTimeFormat('en-US', {
    timeZone: 'UTC',
    month: 'short',
    ...(withYear ? { year: '2-digit' } : { day: 'numeric' }),
  }).format(new Date(`${day}T00:00:00Z`));

function Chart({ data, rangeLabel }: { data: AdminGrowth; rangeLabel: string }) {
  const points = data.points;
  const n = points.length;
  const counts = points.flatMap((p) => [p.applications, p.activeFirms]);
  // A multiple of 4 keeps the five gridlines evenly spaced.
  const max = Math.ceil(Math.max(4, ...counts) / 4) * 4;
  const revenueMax = Math.max(1, ...points.map((p) => p.revenueCents));
  const x = (i: number) => PAD.left + (i * (W - PAD.left - PAD.right)) / Math.max(1, n - 1);
  const y = (v: number, top = max) => H - PAD.bottom - (v * (H - PAD.top - PAD.bottom)) / top;
  const yTicks = Array.from({ length: 5 }, (_, i) => (max * i) / 4);
  const xTicks =
    n <= 8
      ? points.map((_, i) => i)
      : Array.from({ length: 5 }, (_, i) => Math.round((i * (n - 1)) / 4));
  const monthly = data.bucket === 'MONTH';
  const total = (key: 'applications' | 'activations' | 'revenueCents') =>
    points.reduce((sum, p) => sum + p[key], 0);
  const per = data.bucket === 'DAY' ? 'day' : data.bucket === 'WEEK' ? 'week' : 'month';
  const summary = `${rangeLabel}, per ${per}: ${total('applications')} applications, ${total('activations')} firms set up, ${points.at(-1)?.activeFirms ?? 0} active firms at the end, ${dollars(total('revenueCents'))} revenue.`;

  return (
    <div className="mt-2" data-testid="platform-growth-chart" data-bucket={data.bucket}>
      <svg
        role="img"
        aria-label={summary}
        viewBox={`0 0 ${W} ${H}`}
        className="h-auto w-full text-xs"
      >
        {yTicks.map((tick) => (
          <g key={tick}>
            <line
              x1={PAD.left}
              x2={W - PAD.right}
              y1={y(tick)}
              y2={y(tick)}
              className="stroke-border"
            />
            <text x={PAD.left - 8} y={y(tick) + 4} textAnchor="end" className="fill-muted">
              {tick}
            </text>
            {/* Revenue has its own scale, on the right. */}
            <text x={W - PAD.right + 4} y={y(tick) + 4} textAnchor="start" className="fill-purple">
              {dollars((revenueMax * tick) / max)}
            </text>
          </g>
        ))}
        {xTicks.map((i) => (
          <g key={i}>
            <line x1={x(i)} x2={x(i)} y1={PAD.top} y2={H - PAD.bottom} className="stroke-border" />
            <text x={x(i)} y={H - 6} textAnchor="middle" className="fill-muted">
              {shortDay(points[i]!.start, monthly)}
            </text>
          </g>
        ))}
        {[...SERIES].reverse().map((series) => {
          const value = (p: (typeof points)[number]) =>
            series.key === 'revenueCents' ? y(p.revenueCents, revenueMax) : y(p[series.key]);
          return (
            <g key={series.label}>
              <polyline
                fill="none"
                strokeWidth={2}
                className={series.line}
                points={points.map((p, i) => `${x(i)},${value(p)}`).join(' ')}
              />
              {xTicks.map((i) => (
                <circle key={i} cx={x(i)} cy={value(points[i]!)} r={3.5} className={series.dot} />
              ))}
            </g>
          );
        })}
      </svg>
      <ul className="mt-2 flex flex-wrap justify-center gap-x-6 gap-y-1 text-sm text-text">
        {SERIES.map((series) => (
          <li key={series.label} className="flex items-center gap-2">
            <span aria-hidden className={`size-2.5 rounded-pill ${series.swatch}`} />
            {series.label}
          </li>
        ))}
      </ul>
      <p data-testid="platform-growth-summary" className="sr-only">
        {summary}
      </p>
    </div>
  );
}
