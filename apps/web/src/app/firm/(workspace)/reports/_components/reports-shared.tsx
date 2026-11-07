import type { ReportChart, ReportKpi } from '@firmivra/types';
import { tileTones, type KpiTrend, type TileTone } from '@firmivra/ui';
import {
  Buildings,
  ChartBar,
  ChartPieSlice,
  CurrencyDollar,
  FileText,
  Funnel,
  PaperPlaneTilt,
  UsersThree,
  type Icon,
} from '@phosphor-icons/react';
import { type KeyboardEvent, useId, useRef, useState } from 'react';

/** Every query of the Reports module starts here: a change in one view refreshes the others. */
export const RP_KEY = ['reports'] as const;

export const CATEGORY_META: Record<string, { label: string; icon: Icon; tone: TileTone }> = {
  FINANCIAL: { label: 'Financial Reports', icon: ChartBar, tone: 'blue' },
  CLIENT: { label: 'Client Reports', icon: UsersThree, tone: 'blue' },
  TAX: { label: 'Tax Reports', icon: FileText, tone: 'blue' },
  BOOKKEEPING: { label: 'Bookkeeping Reports', icon: ChartPieSlice, tone: 'blue' },
  PAYROLL: { label: 'Payroll Reports', icon: CurrencyDollar, tone: 'blue' },
  LEADS: { label: 'Lead Reports', icon: Funnel, tone: 'blue' },
  COMMUNICATIONS: { label: 'Communications Reports', icon: PaperPlaneTilt, tone: 'blue' },
  TEAM_PRODUCTIVITY: { label: 'Team Productivity', icon: UsersThree, tone: 'blue' },
  ADVISORY: { label: 'Advisory Reports', icon: Buildings, tone: 'blue' },
};
export function CategoryTile({ category, size = 'md' }: { category: string; size?: 'sm' | 'md' }) {
  const m = CATEGORY_META[category] ?? CATEGORY_META['FINANCIAL']!;
  const Glyph = m.icon;
  return (
    <span
      aria-hidden
      className={`flex shrink-0 items-center justify-center rounded-xl ${size === 'sm' ? 'size-9' : 'size-12'} ${tileTones[m.tone]}`}
    >
      <Glyph weight="fill" className={size === 'sm' ? 'size-5' : 'size-6'} />
    </span>
  );
}

export const PRESETS = [
  { value: 'today', label: 'Today' },
  { value: 'last_7_days', label: 'Last 7 Days' },
  { value: 'last_30_days', label: 'Last 30 Days' },
  { value: 'this_month', label: 'This Month' },
  { value: 'last_month', label: 'Last Month' },
  { value: 'this_quarter', label: 'This Quarter' },
  { value: 'last_quarter', label: 'Last Quarter' },
  { value: 'this_year', label: 'This Year' },
  { value: 'last_year', label: 'Last Year' },
] as const;
export const COMPARE = [
  { value: 'NONE', label: 'No Comparison' },
  { value: 'PREVIOUS_PERIOD', label: 'Previous Period' },
  { value: 'SAME_PERIOD_LAST_YEAR', label: 'Same Period Last Year' },
] as const;

export const dayText = (d: string) =>
  new Date(`${d}T12:00:00Z`).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
export const rangeText = (r: { from: string; to: string }) =>
  `${dayText(r.from)} – ${dayText(r.to)}`;
export const dateTimeText = (iso: string) =>
  new Date(iso).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });

export const money = (cents: number) =>
  `${cents < 0 ? '-' : ''}$${(Math.abs(cents) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
export const moneyWhole = (cents: number) =>
  `${cents < 0 ? '-' : ''}$${Math.round(Math.abs(cents) / 100).toLocaleString('en-US')}`;

/** A value as its field type shows it: money in cents, a percent, a day, a number or text. */
export function formatCell(v: string | number | boolean | null | undefined, type: string): string {
  if (v === null || v === undefined || v === '') return '—';
  if (typeof v === 'boolean') return v ? 'Yes' : 'No';
  if (type === 'MONEY' && typeof v === 'number') return money(v);
  if (type === 'PERCENT' && typeof v === 'number') return `${v}%`;
  if (type === 'DATE' && typeof v === 'string') return dayText(v.slice(0, 10));
  if (typeof v === 'number') return v.toLocaleString('en-US');
  return v;
}
export const kpiValue = (k: ReportKpi) =>
  k.value === null
    ? 'N/A'
    : formatCell(
        k.value,
        k.type === 'MONEY' ? 'MONEY' : k.type === 'PERCENT' ? 'PERCENT' : 'NUMBER',
      ).replace(/\.00$/, '');
export const kpiMoney = (k: ReportKpi) =>
  k.value === null ? 'N/A' : k.type === 'MONEY' ? moneyWhole(Number(k.value)) : kpiValue(k);
export const kpiTrend = (k: ReportKpi, badWhenUp = false): KpiTrend | undefined => {
  if (k.deltaPercent === null) return undefined;
  const up = k.deltaPercent > 0;
  return {
    text: `${Math.abs(k.deltaPercent)}%`,
    direction: k.deltaPercent === 0 ? 'flat' : up ? 'up' : 'down',
    good: badWhenUp ? !up : up,
  };
};

/**
 * Paired bars for a chart's series (this period, and the comparison when there is one), or (RP-F18)
 * a line or an area over them; the legend can be hidden.
 */
export function BarChart({
  chart,
  height = 'h-40',
  labels = true,
  dataLabels = false,
  kind = 'BAR',
  legend = true,
}: {
  chart: ReportChart;
  height?: string;
  labels?: boolean;
  dataLabels?: boolean;
  kind?: 'BAR' | 'LINE' | 'AREA';
  legend?: boolean;
}) {
  // RP-Y16 (Octavia, Oct 28): each period's values show on hover, on a tap and on keyboard focus
  // (Tab into the chart, arrow keys between periods, Escape hides), not only as a hover title.
  const [tip, setTip] = useState<number | null>(null);
  const pointsRef = useRef<(HTMLLIElement | null)[]>([]);
  const tipId = useId();
  const all = chart.series.flatMap((s) => s.values.map((v) => v ?? 0));
  const max = Math.max(1, ...all);
  const fmt = (v: number) => (chart.money ? moneyWhole(v) : v.toLocaleString('en-US'));
  const n = chart.labels.length;
  const said = (i: number) =>
    chart.series.map((s) => `${s.label}: ${fmt(s.values[i] ?? 0)}`).join(', ');
  const go = (i: number) => {
    const next = Math.min(n - 1, Math.max(0, i));
    setTip(next);
    pointsRef.current[next]?.focus();
  };
  const keys = (e: KeyboardEvent<HTMLLIElement>, i: number) => {
    const to = { ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: n - 1 }[e.key];
    if (to !== undefined) {
      e.preventDefault();
      go(to);
    } else if (e.key === 'Escape') setTip(null);
  };
  // A line or area: x at each period's centre, y from the top (100 is the axis).
  const points = (values: (number | null)[]) =>
    values.map((v, i) => `${((i + 0.5) / Math.max(1, n)) * 100},${100 - ((v ?? 0) / max) * 100}`);
  return (
    <div>
      <div className="relative">
        {kind !== 'BAR' ? (
          <svg
            viewBox="0 0 100 100"
            preserveAspectRatio="none"
            className={`w-full ${height} border-b border-divider`}
            aria-hidden
            data-testid={`chart-${kind.toLowerCase()}`}
          >
            {chart.series.map((s) => {
              const line = points(s.values);
              const tone = s.comparison ? 'text-chart-blue/40' : 'text-action';
              return (
                <g key={s.key} className={tone}>
                  {kind === 'AREA' && line.length ? (
                    <polygon
                      points={[
                        `${(0.5 / Math.max(1, n)) * 100},100`,
                        ...line,
                        `${((n - 0.5) / Math.max(1, n)) * 100},100`,
                      ].join(' ')}
                      fill="currentColor"
                      fillOpacity={0.2}
                    />
                  ) : null}
                  <polyline
                    points={line.join(' ')}
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={2}
                    vectorEffect="non-scaling-stroke"
                  />
                </g>
              );
            })}
          </svg>
        ) : null}
        <ul
          className={`flex gap-1.5 ${kind === 'BAR' ? `${height} items-end border-b border-divider` : 'absolute inset-0'}`}
          aria-label={`Chart: ${chart.series.map((s) => s.label).join(' and ')}. Arrow keys move between periods.`}
          data-testid="chart-points"
        >
          {chart.labels.map((l, i) => (
            <li
              key={l}
              ref={(el) => {
                pointsRef.current[i] = el;
              }}
              tabIndex={(tip ?? 0) === i ? 0 : -1}
              aria-label={`${l}: ${said(i)}`}
              aria-describedby={tip === i ? tipId : undefined}
              onFocus={() => setTip(i)}
              onBlur={() => setTip((t) => (t === i ? null : t))}
              onMouseEnter={() => setTip(i)}
              onMouseLeave={() => setTip((t) => (t === i ? null : t))}
              onClick={() => setTip(i)}
              onKeyDown={(e) => keys(e, i)}
              className={`relative flex h-full flex-1 cursor-default items-end justify-center gap-0.5 rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-focus ${tip === i ? 'bg-canvas/60' : ''}`}
              data-testid="chart-point"
            >
              {kind === 'BAR'
                ? chart.series.map((s) => {
                    const v = s.values[i] ?? 0;
                    return (
                      <span
                        key={s.key}
                        aria-hidden
                        className={`relative w-3 rounded-t-sm ${s.comparison ? 'bg-chart-blue/40' : 'bg-action'}`}
                        style={{ height: `${(v / max) * 100}%` }}
                      >
                        {dataLabels && v ? (
                          <span className="absolute -top-4 left-1/2 -translate-x-1/2 text-[9px] whitespace-nowrap text-muted">
                            {fmt(v)}
                          </span>
                        ) : null}
                      </span>
                    );
                  })
                : null}
              {tip === i ? (
                <span
                  role="tooltip"
                  id={tipId}
                  className={`pointer-events-none absolute bottom-full z-10 mb-2 flex flex-col rounded-control bg-navigation px-2.5 py-1.5 text-xs whitespace-nowrap text-white shadow-md ${i < n / 2 ? 'left-0' : 'right-0'}`}
                  data-testid="chart-tip"
                >
                  <span className="font-semibold">{l}</span>
                  {chart.series.map((s) => (
                    <span key={s.key}>
                      {s.label}: {fmt(s.values[i] ?? 0)}
                    </span>
                  ))}
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      </div>
      {labels ? (
        <ul aria-hidden className="mt-1 flex gap-1.5 text-[10px] text-muted">
          {chart.labels.map((l) => (
            <li key={l} className="flex-1 text-center">
              {l}
            </li>
          ))}
        </ul>
      ) : null}
      {legend && chart.series.length > 1 ? (
        <p className="mt-2 flex gap-4 text-xs text-muted" data-testid="chart-legend">
          {chart.series.map((s) => (
            <span key={s.key} className="flex items-center gap-1">
              <span
                aria-hidden
                className={`size-2.5 ${s.comparison ? 'bg-chart-blue/40' : 'bg-action'}`}
              />{' '}
              {s.label}
            </span>
          ))}
        </p>
      ) : null}
    </div>
  );
}

export const TONES = ['blue', 'green', 'yellow', 'purple', 'grey', 'red'] as const;
/** The API's report codes, in the firm's words. */
export const RP_ERRORS: Record<string, string> = {
  DUPLICATE_NAME: 'A report with this name already exists. Choose another.',
  SAVE_CONFLICT: 'Someone saved this report after you opened it. Reload and try again.',
  INVALID_DEFINITION: 'One of the fields or filters does not fit this data source.',
  INVALID_RANGE: 'That date range cannot be used for this report.',
  FIELD_NOT_ALLOWED: 'You may not see one of those fields.',
  EXPORT_NOT_ALLOWED: 'Your role cannot export reports.',
  NOT_THE_OWNER: 'Only the owner can change this report.',
  REPORT_ARCHIVED: 'Restore the report before changing it.',
  RECIPIENT_NOT_ALLOWED: 'A recipient may not receive this report.',
  NOT_A_MEMBER: 'That person is not on your team.',
  RUN_NOT_READY: 'The file is not ready yet.',
  FORBIDDEN: 'Your role cannot do this.',
};
/** An export's own refusals (IP-F23): never "check the highlighted fields", as it has none. */
export const EXPORT_ERRORS: Record<string, string> = {
  VALIDATION_FAILED: 'The export could not be made with these settings. Change them and try again.',
};

export const gold =
  'inline-flex min-h-11 items-center justify-center gap-2 rounded-control bg-gold px-5 text-sm font-semibold text-on-action hover:opacity-90 disabled:opacity-50';
export const primary =
  'inline-flex min-h-11 items-center justify-center gap-2 rounded-control bg-action px-5 text-sm font-semibold text-on-action hover:opacity-90 disabled:opacity-50';
export const outlined =
  'inline-flex min-h-11 items-center justify-center gap-2 rounded-control border border-action bg-surface px-4 text-sm font-medium text-action hover:bg-accent-soft disabled:opacity-50';
export const subtle =
  'inline-flex min-h-10 items-center justify-center gap-2 rounded-control border border-border bg-surface px-4 text-sm font-medium text-text hover:bg-canvas disabled:opacity-50';
export const quiet = 'rounded-lg bg-canvas p-4 text-center text-sm text-muted';
export const card = 'min-w-0 rounded-xl bg-surface p-4 shadow-md';
export const linkBtn =
  'inline-flex items-center gap-1 whitespace-nowrap text-sm font-medium text-link';

/** A chart's values as ring segments: money is shown in whole dollars, with the total in the middle. */
export function ringOf(chart: ReportChart): {
  segments: { label: string; value: number; tone: (typeof TONES)[number] }[];
  center: string;
} {
  const div = chart.money ? 100 : 1;
  const segments = chart.labels.map((l, i) => ({
    label: l,
    value: Math.round((chart.series[0]?.values[i] ?? 0) / div),
    tone: TONES[i % TONES.length]!,
  }));
  const total = segments.reduce((n, x) => n + x.value, 0);
  return { segments, center: `${chart.money ? '$' : ''}${total.toLocaleString('en-US')}` };
}
