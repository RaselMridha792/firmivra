'use client';

import type { DashboardRevenue, DashboardSummary } from '@firmivra/types';
import type { UseQueryResult } from '@tanstack/react-query';
import { type ReactNode, useState } from 'react';
import { DashboardLink, useDashboardNavigate } from './dashboard-link';
import { money, Trend } from './kpi-cards';
import { comparedWith } from './period-select';
import { Widget } from './widget';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const days = (from: string, to: string) => (Date.parse(to) - Date.parse(from)) / 86_400_000 + 1;

/** What the revenue comparison is against (C2): the API's span before, in words. */
function revenueAgainst(r: DashboardRevenue, today: string): string {
  if (r.period === 'MONTH') return comparedWith('THIS_MONTH');
  if (r.period === 'QUARTER') return comparedWith('THIS_QUARTER');
  if (r.period === 'YEAR') return r.to === today ? comparedWith('THIS_YEAR') : 'vs the year before';
  return comparedWith('CUSTOM', days(r.from, r.to));
}

/**
 * Dashboard Review 2 (C2, C4, V3): a bar or a service opens the payments it adds up (All Payments,
 * the same days, the service or NONE for Other), with Back to Dashboard.
 */
const paymentsHref = (from: string, to: string, serviceId?: string | null) =>
  `/invoices/payments?start=${from}&end=${to}${
    serviceId === undefined ? '' : `&service=${serviceId ?? 'NONE'}`
  }&back=dashboard`;

/** A bar's days in words, for its hover text: "Nov 14, 2026", "Oct 2026", "Oct 1 to Oct 15". */
function spanText(b: { from: string; to: string }): string {
  const at = (d: string, o: Intl.DateTimeFormatOptions) =>
    new Date(`${d}T12:00:00Z`).toLocaleDateString('en-US', { timeZone: 'UTC', ...o });
  if (b.from === b.to) return at(b.from, { month: 'short', day: 'numeric', year: 'numeric' });
  if (b.from.endsWith('-01') && b.to.slice(0, 7) === b.from.slice(0, 7))
    return at(b.from, { month: 'short', year: 'numeric' });
  return `${at(b.from, { month: 'short', day: 'numeric' })} to ${at(b.to, { month: 'short', day: 'numeric' })}`;
}

/** The value shown while a bar is hovered or focused. */
const TIP =
  'pointer-events-none absolute bottom-full left-1/2 z-10 mb-1 hidden -translate-x-1/2 whitespace-nowrap rounded-control bg-navigation px-2 py-1 text-xs text-on-action shadow-md group-focus-within:block group-hover:block';

/** A bar's label: its day of the month, or its month when it covers more than a day. */
const barLabel = (b: { from: string; to: string }) =>
  b.from === b.to
    ? String(Number(b.from.slice(8)))
    : (MONTHS[Number(b.from.slice(5, 7)) - 1] ?? '');
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

type Props = {
  summary: UseQueryResult<DashboardSummary>;
  /** The period selector in the title bar (C2). */
  action?: ReactNode;
};

/**
 * The period's money received: plain SVG bars (days for a month, months otherwise), the bar
 * holding today in gold, and the change against the span before (C2).
 */
export function RevenueOverview({ summary, action }: Props) {
  return (
    <Widget title="Revenue Overview" query={summary} isEmpty={() => false} empty="" action={action}>
      {({ revenue, today }) => {
        const bars = revenue.buckets;
        const peak = Math.max(0, ...bars.map((b) => b.cents));
        const top = niceMax(peak);
        const y = (cents: number) => 130 - (Math.max(0, cents) / top) * 120;
        const slot = 300 / Math.max(1, bars.length);
        const width = Math.max(2, Math.min(14, slot * 0.6));
        // Every bar's label while they fit, every few otherwise.
        const every = Math.ceil(bars.length / 12);
        return (
          <>
            {revenue.totalCents > 0 ? (
              <div className="flex flex-wrap items-end gap-3">
                <p className="text-3xl font-bold text-heading">{money(revenue.totalCents)}</p>
                <Trend
                  kpi={{ value: revenue.totalCents, previous: revenue.previousCents }}
                  favour="up"
                  against={revenueAgainst(revenue, today)}
                />
              </div>
            ) : (
              <p className="text-sm text-muted">No revenue in this period</p>
            )}
            <div className="relative">
              <svg
                viewBox="0 0 340 150"
                role="img"
                aria-label={`Revenue from ${revenue.from} to ${revenue.to}: ${money(revenue.totalCents)}`}
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
                {bars.map((b, i) => (
                  <g key={b.from}>
                    <rect
                      x={40 + i * slot + (slot - width) / 2}
                      width={width}
                      y={y(b.cents)}
                      height={130 - y(b.cents)}
                      rx="2"
                      className={b.from <= today && today <= b.to ? 'fill-gold' : 'fill-info'}
                    >
                      <title>{`${b.from === b.to ? b.from : `${b.from} to ${b.to}`}: ${money(b.cents)}`}</title>
                    </rect>
                    {i % every === 0 ? (
                      <text
                        x={40 + i * slot + slot / 2}
                        y="146"
                        textAnchor="middle"
                        className="fill-muted text-[9px]"
                      >
                        {barLabel(b)}
                      </text>
                    ) : null}
                  </g>
                ))}
              </svg>
              {/* C2 (Review 2): over each bar's slot of the plot, its link and its value. */}
              <ul
                aria-label="Revenue by period"
                className="absolute top-0 right-0 flex"
                style={{ left: `${(40 / 340) * 100}%`, height: `${(130 / 150) * 100}%` }}
              >
                {bars.map((b) => (
                  <li key={b.from} className="group relative flex-1" data-testid="revenue-bar">
                    <DashboardLink
                      href={paymentsHref(b.from, b.to)}
                      aria-label={`${spanText(b)}: ${money(b.cents)}. Open the payments`}
                      className="block size-full rounded-control hover:bg-canvas/40 focus-visible:outline-2 focus-visible:outline-focus"
                    />
                    <span role="tooltip" className={TIP}>
                      {spanText(b)}: {money(b.cents)}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
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

/**
 * The revenue period's money by service: a plain SVG donut and its legend. Review 2 (C4): a
 * segment or its legend line opens that service's payments; hovering or focusing one shows its
 * amount in the middle.
 */
export function ServiceBreakdown({ summary, action }: Props) {
  const [hovered, setHovered] = useState<number | null>(null);
  const go = useDashboardNavigate();
  return (
    <Widget
      title="Service Breakdown"
      query={summary}
      isEmpty={() => false}
      empty=""
      action={action}
    >
      {({ revenue }) => {
        const total = revenue.byService.reduce((sum, s) => sum + s.cents, 0);
        const C = 2 * Math.PI * 40;
        const shown = hovered === null ? undefined : revenue.byService[hovered];
        const hrefOf = (s: { serviceId: string | null }) =>
          paymentsHref(revenue.from, revenue.to, s.serviceId);
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
                      className={`${RING[i % RING.length]} cursor-pointer`}
                      onClick={() => go(hrefOf(s))}
                      onMouseEnter={() => setHovered(i)}
                      onMouseLeave={() => setHovered(null)}
                    />
                  );
                  start += length;
                  return arc;
                })}
              </svg>
              {total > 0 ? (
                <p
                  data-testid="service-center"
                  className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center px-6 text-center"
                >
                  <span className="text-lg font-bold text-heading">
                    {money(shown ? shown.cents : total)}
                  </span>
                  <span className="line-clamp-2 text-xs text-muted">
                    {shown ? (shown.name ?? 'Other') : 'Total Revenue'}
                  </span>
                </p>
              ) : null}
            </div>
            {total > 0 ? (
              <ul className="flex min-w-0 flex-1 flex-col gap-2 text-sm">
                {revenue.byService.map((s, i) => (
                  <li key={s.serviceId ?? 'other'}>
                    <DashboardLink
                      href={hrefOf(s)}
                      aria-label={`${s.name ?? 'Other'}: ${money(s.cents)}, ${Math.round((s.cents / total) * 100)}%. Open the payments`}
                      onMouseEnter={() => setHovered(i)}
                      onMouseLeave={() => setHovered(null)}
                      onFocus={() => setHovered(i)}
                      onBlur={() => setHovered(null)}
                      className="flex items-center gap-2 rounded-control hover:bg-canvas focus-visible:outline-2 focus-visible:outline-focus"
                    >
                      <span
                        aria-hidden
                        className={`size-3 shrink-0 rounded-full ${DOT[i % DOT.length]}`}
                      />
                      <span className="min-w-0 flex-1 text-text">{s.name ?? 'Other'}</span>
                      <span className="font-semibold text-heading">
                        {Math.round((s.cents / total) * 100)}%
                      </span>
                    </DashboardLink>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted">No revenue in this period</p>
            )}
          </div>
        );
      }}
    </Widget>
  );
}
