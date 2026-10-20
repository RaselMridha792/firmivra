'use client';

import { Select } from '@firmivra/ui';
import { monthLabel } from './reports-common';

// The Reports charts (local components until the kit has a bar and a line chart): bars by month
// (Firm Growth, Document Activity), a line with its area (Revenue Trend, User Growth), and
// horizontal bars with a percentage (Feature Usage). Every chart keeps its axes when empty and
// says so under them; nothing is drawn from invented values.

export interface MonthValue {
  month: string;
  value: number;
}

/** A round top for the axis and five steps to it (0, 50 … 250 for 237). */
export function niceTicks(max: number, whole = false): number[] {
  if (max <= 0) return [0, 1, 2, 3, 4, 5];
  const rough = max / 5;
  const power = Math.max(whole ? 1 : 0, 10 ** Math.floor(Math.log10(rough)));
  // Counts step in whole numbers (no "12.5 firms"); money may step by 2.5.
  const steps = whole ? [1, 2, 3, 5, 10] : [1, 2, 2.5, 5, 10];
  const step = steps.map((m) => m * power).find((s) => s >= rough) ?? 10 * power;
  return Array.from({ length: 6 }, (_, i) => Math.round(i * step * 100) / 100);
}

/** "Last 6 Months" / "Last 3 Months": the API answers six months; three is the last half. */
export function PeriodSelect({
  label,
  value,
  onChange,
}: {
  label: string;
  value: 3 | 6;
  onChange: (months: 3 | 6) => void;
}) {
  return (
    <div className="w-44">
      <Select
        label={label}
        hideLabel
        value={String(value)}
        onChange={(e) => onChange(e.target.value === '3' ? 3 : 6)}
        options={[
          { value: '6', label: 'Last 6 Months' },
          { value: '3', label: 'Last 3 Months' },
        ]}
      />
    </div>
  );
}

function Axis({ ticks, format }: { ticks: number[]; format: (v: number) => string }) {
  return (
    <div
      aria-hidden
      className="flex h-full flex-col-reverse justify-between pr-2 text-right text-xs text-muted"
    >
      {ticks.map((t) => (
        <span key={t} className="leading-none">
          {format(t)}
        </span>
      ))}
    </div>
  );
}

function Grid({ lines }: { lines: number }) {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 flex flex-col justify-between">
      {Array.from({ length: lines }, (_, i) => (
        <span key={i} className="border-t border-divider" />
      ))}
    </div>
  );
}

/** Vertical bars by month (one series). */
export function MonthBars({
  data,
  label,
  tone = 'action',
  format = (v) => v.toLocaleString('en-US'),
  emptyText,
  minTop = 5,
}: {
  data: MonthValue[];
  label: string;
  tone?: 'action' | 'purple';
  format?: (v: number) => string;
  emptyText: string;
  /** The axis's top when every value is smaller (a money chart: cents). */
  minTop?: number;
}) {
  const ticks = niceTicks(Math.max(minTop, ...data.map((d) => d.value)), minTop <= 5);
  const top = ticks.at(-1)!;
  const empty = data.every((d) => d.value === 0);
  const fill = tone === 'purple' ? 'bg-purple' : 'bg-action';
  return (
    <figure className="flex flex-col gap-2">
      <div className="grid h-44 grid-cols-[auto_1fr]">
        <Axis ticks={ticks} format={format} />
        <div className="relative h-full border-b border-divider">
          <Grid lines={ticks.length} />
          <ul role="img" aria-label={label} className="relative flex h-full items-end gap-3 px-2">
            {data.map((d) => (
              <li key={d.month} className="flex h-full flex-1 items-end justify-center">
                <span
                  className={`w-full max-w-12 rounded-t-sm ${fill}`}
                  style={{ height: `${(d.value / top) * 100}%` }}
                  title={`${monthLabel(d.month)}: ${format(d.value)}`}
                />
              </li>
            ))}
          </ul>
        </div>
      </div>
      <MonthLabels data={data} />
      {empty ? (
        <figcaption className="text-center text-sm text-muted">{emptyText}</figcaption>
      ) : null}
    </figure>
  );
}

function MonthLabels({ data }: { data: MonthValue[] }) {
  return (
    <div className="grid grid-cols-[auto_1fr]">
      <span aria-hidden className="invisible pr-2 text-xs">
        0000
      </span>
      <ul className="flex gap-3 px-2 text-xs text-muted">
        {data.map((d) => (
          <li key={d.month} className="flex-1 text-center">
            {monthLabel(d.month)}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** A line with its shaded area and a dot per month. */
export function MonthLine({
  data,
  label,
  format = (v) => v.toLocaleString('en-US'),
  emptyText,
  minTop = 5,
}: {
  data: MonthValue[];
  label: string;
  format?: (v: number) => string;
  emptyText: string;
  /** The axis's top when every value is smaller (a money chart: cents). */
  minTop?: number;
}) {
  const ticks = niceTicks(Math.max(minTop, ...data.map((d) => d.value)), minTop <= 5);
  const top = ticks.at(-1)!;
  const empty = data.every((d) => d.value === 0);
  const n = Math.max(1, data.length - 1);
  // In a 100 × 100 box; the dots are placed in % so they stay round.
  const points = data.map((d, i) => ({ x: (i / n) * 100, y: 100 - (d.value / top) * 100, d }));
  const line = points.map((p) => `${p.x},${p.y}`).join(' ');
  return (
    <figure className="flex flex-col gap-2">
      <div className="grid h-44 grid-cols-[auto_1fr]">
        <Axis ticks={ticks} format={format} />
        <div className="relative h-full border-b border-divider" role="img" aria-label={label}>
          <Grid lines={ticks.length} />
          {data.length ? (
            <svg
              viewBox="0 0 100 100"
              preserveAspectRatio="none"
              className="absolute inset-0 size-full overflow-visible text-action"
              aria-hidden
            >
              <polygon points={`0,100 ${line} 100,100`} className="fill-current opacity-15" />
              <polyline
                points={line}
                fill="none"
                className="stroke-current"
                strokeWidth={2}
                vectorEffect="non-scaling-stroke"
              />
            </svg>
          ) : null}
          {points.map((p) => (
            <span
              key={p.d.month}
              title={`${monthLabel(p.d.month)}: ${format(p.d.value)}`}
              className="absolute size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-action ring-2 ring-surface"
              style={{ left: `${p.x}%`, top: `${p.y}%` }}
            />
          ))}
        </div>
      </div>
      <div className="grid grid-cols-[auto_1fr]">
        <span aria-hidden className="invisible pr-2 text-xs">
          0000
        </span>
        <ul className="flex justify-between text-xs text-muted">
          {data.map((d) => (
            <li key={d.month}>{monthLabel(d.month)}</li>
          ))}
        </ul>
      </div>
      {empty ? (
        <figcaption className="text-center text-sm text-muted">{emptyText}</figcaption>
      ) : null}
    </figure>
  );
}

/** Horizontal bars with a percentage (Feature Usage); null percentages show as not available. */
export function BarList({
  rows,
  label,
  emptyText,
}: {
  rows: { key: string; label: string; percent: number | null }[];
  label: string;
  emptyText: string;
}) {
  const none = rows.every((r) => r.percent === null);
  return (
    <figure className="flex flex-col gap-3">
      <ul aria-label={label} className="flex flex-col gap-3">
        {rows.map((r) => (
          <li
            key={r.key}
            className="grid grid-cols-[minmax(8rem,10rem)_1fr_3rem] items-center gap-3 text-sm"
          >
            <span className="truncate text-text">{r.label}</span>
            <span className="h-3 rounded-full bg-canvas">
              <span
                className="block h-3 rounded-full bg-action"
                style={{ width: `${Math.min(100, r.percent ?? 0)}%` }}
              />
            </span>
            <span className="text-right font-semibold text-heading">
              {r.percent === null ? '—' : `${Math.round(r.percent)}%`}
            </span>
          </li>
        ))}
      </ul>
      {none ? (
        <figcaption className="text-center text-sm text-muted">{emptyText}</figcaption>
      ) : null}
    </figure>
  );
}
