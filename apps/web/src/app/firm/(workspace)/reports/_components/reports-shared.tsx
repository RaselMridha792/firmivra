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

/** Paired bars for a chart's series (this period, and the comparison when there is one). */
export function BarChart({
  chart,
  height = 'h-40',
  labels = true,
  dataLabels = false,
}: {
  chart: ReportChart;
  height?: string;
  labels?: boolean;
  dataLabels?: boolean;
}) {
  const all = chart.series.flatMap((s) => s.values.map((v) => v ?? 0));
  const max = Math.max(1, ...all);
  const fmt = (v: number) => (chart.money ? moneyWhole(v) : v.toLocaleString('en-US'));
  return (
    <div>
      <ul
        className={`flex ${height} items-end gap-1.5 border-b border-divider`}
        role="img"
        aria-label="Chart"
      >
        {chart.labels.map((l, i) => (
          <li key={l} className="flex h-full flex-1 items-end justify-center gap-0.5">
            {chart.series.map((s) => {
              const v = s.values[i] ?? 0;
              return (
                <span
                  key={s.key}
                  className={`relative w-3 rounded-t-sm ${s.comparison ? 'bg-chart-blue/40' : 'bg-action'}`}
                  style={{ height: `${(v / max) * 100}%` }}
                  title={`${s.label}: ${fmt(v)}`}
                >
                  {dataLabels && v ? (
                    <span className="absolute -top-4 left-1/2 -translate-x-1/2 text-[9px] whitespace-nowrap text-muted">
                      {fmt(v)}
                    </span>
                  ) : null}
                </span>
              );
            })}
          </li>
        ))}
      </ul>
      {labels ? (
        <ul className="mt-1 flex gap-1.5 text-[10px] text-muted">
          {chart.labels.map((l) => (
            <li key={l} className="flex-1 text-center">
              {l}
            </li>
          ))}
        </ul>
      ) : null}
      {chart.series.length > 1 ? (
        <p className="mt-2 flex gap-4 text-xs text-muted">
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
