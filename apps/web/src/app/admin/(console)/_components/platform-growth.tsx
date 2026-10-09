'use client';

import type { ListFirmApplicationsResponse } from '@firmivra/types';
import { useState } from 'react';
import { api } from '../../../../lib/api';
import { useApiQuery } from '../../../../lib/query';

const RANGES = [7, 30, 90] as const;
type Range = (typeof RANGES)[number];
const DAY = 86_400_000;

/** Chart area in SVG units; the SVG scales to the card's width. */
const W = 420;
const H = 170;
const PAD = { left: 28, right: 24, top: 10, bottom: 26 };

const SERIES = [
  { label: 'Applications', line: 'stroke-info', dot: 'fill-info', swatch: 'bg-info' },
  { label: 'Active Firms', line: 'stroke-success', dot: 'fill-success', swatch: 'bg-success' },
  { label: 'Revenue', line: 'stroke-purple', dot: 'fill-purple', swatch: 'bg-purple' },
] as const;

/** Midnight (local) `n` days before today. */
const daysAgo = (n: number) => {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  return new Date(date.getTime() - n * DAY);
};

/**
 * Platform Growth (Beta): new applications per day over the range, from the applications list.
 * Firm activations and revenue have no daily history in the API yet, so they draw as zero.
 */
export function PlatformGrowth() {
  const [range, setRange] = useState<Range>(30);
  const [today] = useState(() => daysAgo(0));
  const start = new Date(today.getTime() - 89 * DAY);
  const applications = useApiQuery(['firm-applications', 'growth'], () =>
    api.firmApplications.list({ from: start.toISOString(), pageSize: 100 }),
  );
  return (
    <>
      <label className="sr-only" htmlFor="growth-range">
        Range
      </label>
      <select
        id="growth-range"
        value={range}
        onChange={(event) => setRange(Number(event.target.value) as Range)}
        className="absolute top-4 right-4 min-h-0 rounded-control border border-border bg-surface px-3 py-1.5 text-sm text-text"
      >
        {RANGES.map((days) => (
          <option key={days} value={days}>
            Last {days} Days
          </option>
        ))}
      </select>
      <Chart today={today} range={range} data={applications.data} />
    </>
  );
}

function Chart({
  today,
  range,
  data,
}: {
  today: Date;
  range: Range;
  data: ListFirmApplicationsResponse | undefined;
}) {
  const first = new Date(today.getTime() - (range - 1) * DAY);
  const days = Array.from({ length: range }, (_, i) => new Date(first.getTime() + i * DAY));
  const perDay = days.map(
    (day) =>
      (data?.items ?? []).filter((item) => {
        const at = Date.parse(item.submittedAt);
        return at >= day.getTime() && at < day.getTime() + DAY;
      }).length,
  );
  const values = [perDay, days.map(() => 0), days.map(() => 0)];
  const max = Math.max(4, ...perDay);
  const x = (i: number) => PAD.left + (i * (W - PAD.left - PAD.right)) / Math.max(1, range - 1);
  const y = (v: number) => H - PAD.bottom - (v * (H - PAD.top - PAD.bottom)) / max;
  const yTicks = Array.from({ length: 5 }, (_, i) => Math.round((max * i) / 4));
  const xTicks = Array.from({ length: 5 }, (_, i) => Math.round((i * (range - 1)) / 4));
  const label = (date: Date) => date.toLocaleString('en-US', { month: 'short', day: 'numeric' });

  return (
    <div className="mt-2">
      <svg
        role="img"
        aria-label={`New applications per day, last ${range} days: ${perDay.reduce((a, b) => a + b, 0)} in total`}
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
          </g>
        ))}
        {xTicks.map((i) => (
          <g key={i}>
            <line x1={x(i)} x2={x(i)} y1={PAD.top} y2={H - PAD.bottom} className="stroke-border" />
            <text x={x(i)} y={H - 6} textAnchor="middle" className="fill-muted">
              {label(days[i]!)}
            </text>
          </g>
        ))}
        {[...SERIES].reverse().map((series, reversed) => {
          const points = values[SERIES.length - 1 - reversed]!;
          return (
            <g key={series.label}>
              <polyline
                fill="none"
                strokeWidth={2}
                className={series.line}
                points={points.map((v, i) => `${x(i)},${y(v)}`).join(' ')}
              />
              {xTicks.map((i) => (
                <circle key={i} cx={x(i)} cy={y(points[i]!)} r={3.5} className={series.dot} />
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
    </div>
  );
}
