'use client';

import type { DashboardSummary } from '@firmivra/types';
import type { UseQueryResult } from '@tanstack/react-query';
import { money } from './kpi-cards';
import { Widget } from './widget';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const short = (cents: number) =>
  new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(
    cents / 100,
  );
/** A round top for the axis: 1, 2 or 5 times a power of ten, in cents, at least $3. */
function niceMax(cents: number): number {
  const target = Math.max(cents, 300) / 3;
  const power = 10 ** Math.floor(Math.log10(target));
  const step = [1, 2, 5, 10].map((m) => m * power).find((s) => s >= target) ?? power * 10;
  return step * 3;
}

type Props = { summary: UseQueryResult<DashboardSummary> };

/** This year's money received by month: plain SVG bars, the current month in gold. */
export function RevenueOverview({ summary }: Props) {
  return (
    <Widget title="Revenue Overview" query={summary} isEmpty={() => false} empty="">
      {({ revenue, today }) => {
        const peak = Math.max(0, ...revenue.byMonthCents);
        const top = niceMax(peak);
        const now = Number(today.slice(5, 7)) - 1;
        const y = (cents: number) => 130 - (Math.max(0, cents) / top) * 120;
        return (
          <>
            {revenue.totalCents > 0 ? (
              <p className="text-3xl font-bold text-heading">{money(revenue.totalCents)}</p>
            ) : (
              <p className="text-sm text-muted">No revenue yet</p>
            )}
            <svg
              viewBox="0 0 340 150"
              role="img"
              aria-label={`Revenue by month, ${revenue.year}`}
              className="w-full"
            >
              {[0, 1, 2, 3].map((i) => (
                <g key={i} className="fill-muted text-[9px]">
                  <line
                    x1="34"
                    x2="340"
                    y1={y((top * i) / 3)}
                    y2={y((top * i) / 3)}
                    className="stroke-border"
                  />
                  <text x="28" y={y((top * i) / 3) + 3} textAnchor="end">
                    {i === 0 ? '0' : peak > 0 ? short((top * i) / 3) : ''}
                  </text>
                </g>
              ))}
              {revenue.byMonthCents.map((cents, i) => (
                <g key={MONTHS[i]}>
                  <rect
                    x={40 + i * 25}
                    width="14"
                    y={y(cents)}
                    height={130 - y(cents)}
                    rx="2"
                    className={i === now ? 'fill-gold' : 'fill-info'}
                  >
                    <title>{`${MONTHS[i]}: ${money(cents)}`}</title>
                  </rect>
                  <text
                    x={47 + i * 25}
                    y="146"
                    textAnchor="middle"
                    className="fill-muted text-[9px]"
                  >
                    {MONTHS[i]}
                  </text>
                </g>
              ))}
            </svg>
          </>
        );
      }}
    </Widget>
  );
}

const RING = [
  'stroke-info',
  'stroke-gold',
  'stroke-sky',
  'stroke-purple',
  'stroke-success',
  'stroke-orange',
  'stroke-accent',
];
const DOT = ['bg-info', 'bg-gold', 'bg-sky', 'bg-purple', 'bg-success', 'bg-orange', 'bg-accent'];

/** This year's money by service: a plain SVG donut and its legend. */
export function ServiceBreakdown({ summary }: Props) {
  return (
    <Widget title="Service Breakdown" query={summary} isEmpty={() => false} empty="">
      {({ revenue }) => {
        const total = revenue.byService.reduce((sum, s) => sum + s.cents, 0);
        const C = 2 * Math.PI * 40;
        let start = 0;
        return (
          <div className="flex flex-wrap items-center gap-4">
            <div className="relative size-36 shrink-0">
              <svg viewBox="0 0 100 100" className="size-full -rotate-90" aria-hidden>
                <circle
                  cx="50"
                  cy="50"
                  r="40"
                  fill="none"
                  strokeWidth="14"
                  className="stroke-canvas"
                />
                {revenue.byService.map((s, i) => {
                  const length = (s.cents / total) * C;
                  const arc = (
                    <circle
                      key={s.serviceId ?? 'other'}
                      cx="50"
                      cy="50"
                      r="40"
                      fill="none"
                      strokeWidth="14"
                      strokeDasharray={`${length} ${C - length}`}
                      strokeDashoffset={-start}
                      className={RING[i % RING.length]}
                    />
                  );
                  start += length;
                  return arc;
                })}
              </svg>
              {total > 0 ? (
                <p className="absolute inset-0 flex flex-col items-center justify-center">
                  <span className="text-lg font-bold text-heading">{money(total)}</span>
                  <span className="text-xs text-muted">Total Revenue</span>
                </p>
              ) : null}
            </div>
            {total > 0 ? (
              <ul className="flex min-w-0 flex-1 flex-col gap-2 text-sm">
                {revenue.byService.map((s, i) => (
                  <li key={s.serviceId ?? 'other'} className="flex items-center gap-2">
                    <span
                      aria-hidden
                      className={`size-3 shrink-0 rounded-full ${DOT[i % DOT.length]}`}
                    />
                    <span className="min-w-0 flex-1 text-text">{s.name ?? 'Other'}</span>
                    <span className="font-semibold text-heading">
                      {Math.round((s.cents / total) * 100)}%
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted">No revenue yet</p>
            )}
          </div>
        );
      }}
    </Widget>
  );
}
