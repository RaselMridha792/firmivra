'use client';

import type { ListFirmApplicationsResponse } from '@firmivra/types';
import { ChartColumn, ChevronDown } from 'lucide-react';
import { useId, useState } from 'react';
import { PageState } from '../../../../components/page-state';
import { api } from '../../../../lib/api';
import { useApiQuery } from '../../../../lib/query';
import { SectionTitle } from './section-title';

const RANGES = [7, 30, 90] as const;
type Range = (typeof RANGES)[number];

/** Chart area in SVG units; the SVG scales to the card's width. */
const W = 420;
const H = 170;
const PAD = { left: 28, right: 24, top: 10, bottom: 26 };

const SERIES = [
  { label: 'Applications', line: 'stroke-info', dot: 'fill-info', swatch: 'bg-info' },
  { label: 'Active Firms', line: 'stroke-success', dot: 'fill-success', swatch: 'bg-success' },
  { label: 'Revenue', line: 'stroke-purple', dot: 'fill-purple', swatch: 'bg-purple' },
] as const;

/** Local midnight `n` days after `from` (negative for before), by calendar day so DST is safe. */
const dayFrom = (from: Date, n: number) =>
  new Date(from.getFullYear(), from.getMonth(), from.getDate() + n);

/**
 * Platform Growth (Beta): new applications per day over the range, from the applications list.
 * Firm activations and revenue have no daily history in the API yet, so they draw as zero.
 * The list is read once for the longest range; the API's page limit of 100 caps it.
 */
export function PlatformGrowth() {
  const id = useId();
  const [range, setRange] = useState<Range>(30);
  const [today] = useState(() => dayFrom(new Date(), 0));
  const applications = useApiQuery(['firm-applications', 'growth'], () =>
    api.firmApplications.list({ from: dayFrom(today, -89).toISOString(), pageSize: 100 }),
  );
  return (
    <>
      <SectionTitle
        icon={ChartColumn}
        nowrap
        action={
          <span className="relative ml-auto shrink-0">
            <label className="sr-only" htmlFor={id}>
              Range
            </label>
            <select
              id={id}
              value={range}
              onChange={(event) => setRange(Number(event.target.value) as Range)}
              className="min-h-0 appearance-none rounded-control border border-border bg-surface py-1.5 pl-2.5 pr-7 text-sm text-text"
            >
              {RANGES.map((days) => (
                <option key={days} value={days}>
                  Last {days} Days
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
      <PageState query={applications}>
        {(data) => <Chart today={today} range={range} data={data} />}
      </PageState>
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
  data: ListFirmApplicationsResponse;
}) {
  const days = Array.from({ length: range }, (_, i) => dayFrom(today, i - range + 1));
  const perDay = days.map((day, i) => {
    const end = dayFrom(today, i - range + 2).getTime();
    return data.items.filter((item) => {
      const at = Date.parse(item.submittedAt);
      return at >= day.getTime() && at < end;
    }).length;
  });
  const total = perDay.reduce((a, b) => a + b, 0);
  const values = [perDay, days.map(() => 0), days.map(() => 0)];
  // A multiple of 4 keeps the five gridlines evenly spaced.
  const max = Math.ceil(Math.max(4, ...perDay) / 4) * 4;
  const x = (i: number) => PAD.left + (i * (W - PAD.left - PAD.right)) / Math.max(1, range - 1);
  const y = (v: number) => H - PAD.bottom - (v * (H - PAD.top - PAD.bottom)) / max;
  const yTicks = Array.from({ length: 5 }, (_, i) => (max * i) / 4);
  const xTicks =
    range === 7
      ? days.map((_, i) => i)
      : Array.from({ length: 5 }, (_, i) => Math.round((i * (range - 1)) / 4));
  const label = (date: Date) => date.toLocaleString('en-US', { month: 'short', day: 'numeric' });

  return (
    <div className="mt-2">
      <svg
        role="img"
        aria-label={`New applications per day, last ${range} days: ${total} in total. Active firms and revenue: no history yet.`}
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
