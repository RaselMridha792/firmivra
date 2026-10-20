'use client';

import type { AdminReportKpi } from '@firmivra/types';
import { Button, Card, DateRangePicker, type KpiTrend, Skeleton } from '@firmivra/ui';
import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  CalendarBlank,
  CaretDown,
  type Icon,
} from '@phosphor-icons/react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useState, type ReactNode } from 'react';
import { ApiRequestError } from '@firmivra/types';

/**
 * Shared parts of the Super Admin Reports & Analytics pages (R55; designs in
 * docs/mockups/super-admin/reports/source/, API `api.adminReports`). The reporting period lives
 * in the URL (`from`, `to`), so every tab, the firm detail and the builder keep it; left out, the
 * API's default applies (the last 30 days) and the picker shows it.
 */

export const RP = ['admin-reports'] as const;
const DAY = 86_400_000;
const isoDay = (d: Date) => d.toISOString().slice(0, 10);

/** The period in the URL, or the API's default: the last 30 days ending today (UTC). */
export function useRange() {
  const params = useSearchParams();
  const router = useRouter();
  const path = usePathname();
  const to = params.get('to') ?? isoDay(new Date());
  const from = params.get('from') ?? isoDay(new Date(Date.parse(`${to}T00:00:00Z`) - 29 * DAY));
  const valid = /^\d{4}-\d{2}-\d{2}$/;
  const range = valid.test(from) && valid.test(to) && from <= to ? { from, to } : null;
  const set = (next: { from: string; to: string }) => {
    if (!next.from || !next.to || next.from > next.to) return;
    const q = new URLSearchParams(params.toString());
    q.set('from', next.from);
    q.set('to', next.to);
    q.delete('page');
    router.replace(`${path}?${q.toString()}`);
  };
  /** A link that keeps the period. */
  const keep = (href: string) => {
    const q = new URLSearchParams();
    if (params.get('from')) q.set('from', params.get('from')!);
    if (params.get('to')) q.set('to', params.get('to')!);
    const s = q.toString();
    return s ? `${href}${href.includes('?') ? '&' : '?'}${s}` : href;
  };
  return { range: range ?? undefined, from, to, set, keep };
}

// ---------- Formats ----------

export const money = (cents: number) =>
  (cents / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' });
export const moneyWhole = (cents: number) =>
  (cents / 100).toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  });
export const count = (n: number) => n.toLocaleString('en-US');
export const monthLabel = (m: string) =>
  new Date(`${m}-01T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', timeZone: 'UTC' });
export const dateText = (iso: string) =>
  new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
export const dateTimeText = (iso: string) =>
  new Date(iso).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
export const dayText = (day: string) =>
  new Date(`${day}T00:00:00Z`).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  });

/** "Not available" for a figure with no source (the API's null), never a zero. */
export const NOT_AVAILABLE = 'Not available';
/** A card's note when its call failed (the API unreachable). */
export const COULD_NOT_LOAD = 'Could not load right now';

/** "+12%" against the previous period of equal length; nothing to compare is no trend. */
export function trendOf(k: AdminReportKpi, upIsGood = true): KpiTrend | undefined {
  if (k.value === null || k.previous === null) return undefined;
  if (k.value === k.previous) return { text: 'No change', direction: 'flat' };
  if (k.previous === 0) return undefined;
  const pct = Math.round(((k.value - k.previous) / Math.abs(k.previous)) * 1000) / 10;
  const up = pct > 0;
  return { text: `${up ? '+' : ''}${pct}%`, direction: up ? 'up' : 'down', good: up === upIsGood };
}

/** The note under a KPI: what the trend compares with, or why there is none. */
export function kpiNote(k: AdminReportKpi): string {
  if (k.value === null) return 'No data source yet';
  if (k.previous === null || (k.previous === 0 && k.value !== 0)) return 'No earlier figure';
  return 'vs. previous period';
}

export function loadError(error: unknown): string {
  if (error instanceof ApiRequestError && error.status === 404) return 'Not found.';
  return 'Could not load this right now. Try again in a moment.';
}

// ---------- Layout ----------

/** A white card with a heading row (title, an optional control on the right). */
export function Panel({
  title,
  action,
  children,
  testId,
  className = '',
}: {
  title: string;
  action?: ReactNode;
  children: ReactNode;
  testId?: string;
  className?: string;
}) {
  return (
    <Card data-testid={testId} className={`flex min-w-0 flex-col gap-4 p-5! ${className}`}>
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-base font-bold text-heading">{title}</h2>
        {action}
      </div>
      {children}
    </Card>
  );
}

/** A widget's quiet line: empty, or the API unreachable. The frame stays. */
export function QuietLine({ children }: { children: ReactNode }) {
  return <p className="rounded-lg bg-canvas p-4 text-center text-sm text-muted">{children}</p>;
}

/**
 * A widget's body in its three states: loading (skeleton), failed (the quiet error line), or
 * the data (`render`), which shows its own empty state.
 */
export function Loaded<T>({
  query,
  rows = 4,
  children,
}: {
  query: { data?: T; isPending: boolean; isError: boolean; error: unknown };
  rows?: number;
  children: (data: T) => ReactNode;
}) {
  if (query.data !== undefined) return <>{children(query.data)}</>;
  if (query.isError) return <QuietLine>{loadError(query.error)}</QuietLine>;
  return (
    <div className="flex flex-col gap-2" role="status" aria-label="Loading">
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} className="h-5 w-full" />
      ))}
    </div>
  );
}

const TABS = [
  { label: 'Overview', href: '/reports' },
  { label: 'Firms', href: '/reports/firms' },
  { label: 'Revenue', href: '/reports/revenue' },
  { label: 'Users', href: '/reports/users' },
  { label: 'Feature Usage', href: '/reports/feature-usage' },
  { label: 'Support', href: '/reports/support' },
  { label: 'Custom Reports', href: '/reports/builder' },
] as const;

/** The module's tabs: each is a page; Custom Reports covers the builder and Saved Reports. */
export function ReportsTabs() {
  const path = usePathname();
  const { keep } = useRange();
  const active = (href: string) =>
    href === '/reports'
      ? path === '/reports'
      : href === '/reports/builder'
        ? path.startsWith('/reports/builder') || path.startsWith('/reports/saved')
        : href === '/reports/firms'
          ? path === '/reports/firms'
          : path.startsWith(href);
  return (
    <nav aria-label="Reports" className="flex gap-8 overflow-x-auto border-b border-divider">
      {TABS.map((tab) => (
        <Link
          key={tab.href}
          href={keep(tab.href)}
          aria-current={active(tab.href) ? 'page' : undefined}
          className={`-mb-px inline-flex min-h-11 shrink-0 items-center border-b-2 px-2 text-base font-medium ${active(tab.href) ? 'border-action text-action' : 'border-transparent text-text hover:text-heading'}`}
        >
          {tab.label}
        </Link>
      ))}
    </nav>
  );
}

/** The global period (upper right): every figure on the page follows it. */
export function PeriodPicker() {
  const { from, to, set } = useRange();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState({ from, to });
  const apply = (r: { from: string; to: string }) => {
    if (!r.from || !r.to || r.from > r.to) return;
    set(r);
    setOpen(false);
  };
  /** A preset's days, from the moment it is chosen (an event, so the clock is read then). */
  const preset = (kind: '7' | '30' | 'month' | 'last-month') => {
    const now = new Date();
    const day = (d: Date) => d.toISOString().slice(0, 10);
    const today = day(now);
    if (kind === '7' || kind === '30')
      return { from: day(new Date(now.getTime() - (Number(kind) - 1) * DAY)), to: today };
    const y = now.getUTCFullYear();
    const m = now.getUTCMonth();
    return kind === 'month'
      ? { from: day(new Date(Date.UTC(y, m, 1))), to: today }
      : { from: day(new Date(Date.UTC(y, m - 1, 1))), to: day(new Date(Date.UTC(y, m, 0))) };
  };
  return (
    <div className="relative" onKeyDown={(e) => e.key === 'Escape' && setOpen(false)}>
      <button
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={`Reporting period: ${dayText(from)} to ${dayText(to)}`}
        onClick={() => {
          setDraft({ from, to });
          setOpen(!open);
        }}
        className="inline-flex h-11 items-center gap-3 rounded-lg border border-divider bg-surface px-4 text-sm font-medium text-heading shadow-sm hover:bg-canvas"
      >
        <CalendarBlank aria-hidden weight="regular" className="size-5 text-muted" />
        {dayText(from)} - {dayText(to)}
        <CaretDown aria-hidden weight="bold" className="size-4 text-muted" />
      </button>
      {open ? (
        <div
          role="dialog"
          aria-label="Choose the reporting period"
          className="absolute right-0 z-20 mt-2 flex w-80 flex-col gap-3 rounded-xl border border-divider bg-surface p-4 shadow-lg"
        >
          <div className="flex flex-wrap gap-2">
            {(
              [
                ['7', 'Last 7 days'],
                ['30', 'Last 30 days'],
                ['month', 'This month'],
                ['last-month', 'Last month'],
              ] as const
            ).map(([k, label]) => (
              <button
                key={k}
                type="button"
                onClick={() => apply(preset(k))}
                className="rounded-full border border-divider px-3 py-1 text-xs font-medium text-text hover:border-action hover:text-action"
              >
                {label}
              </button>
            ))}
          </div>
          <DateRangePicker label="Custom range" value={draft} onChange={setDraft} />
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              disabled={!draft.from || !draft.to || draft.from > draft.to}
              onClick={() => apply(draft)}
            >
              Apply
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

/** The page head: title, subtitle, the period on the right, an optional back link and actions. */
export function ReportsHeader({
  title,
  subtitle,
  back,
  actions,
}: {
  title: string;
  subtitle: string;
  back?: boolean;
  actions?: ReactNode;
}) {
  const { keep } = useRange();
  return (
    <ConsoleHeader
      title={title}
      subtitle={subtitle}
      above={
        back ? (
          <Link
            href={keep('/reports')}
            className="inline-flex items-center gap-2 text-base font-medium text-action"
          >
            <ArrowLeft aria-hidden weight="bold" className="size-4" />
            Back to Reports &amp; Analytics
          </Link>
        ) : undefined
      }
      actions={
        <div className="flex flex-col items-stretch gap-3 sm:items-end">
          <PeriodPicker />
          {actions ? <div className="flex flex-wrap justify-end gap-3">{actions}</div> : null}
        </div>
      }
    />
  );
}

/** A file built in the answer (CSV): saved by the browser. */
export function saveFile(file: { fileName: string; mimeType: string; content: string }) {
  const url = URL.createObjectURL(new Blob([file.content], { type: file.mimeType }));
  const a = document.createElement('a');
  a.href = url;
  a.download = file.fileName;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/**
 * The page head as the Super Admin designs draw it: a bold sans title (the kit's PageHeader uses
 * the firm workspace's display face), the subtitle, an optional line above, actions on the right.
 */
export function ConsoleHeader({
  title,
  subtitle,
  above,
  actions,
}: {
  title: string;
  subtitle?: string;
  above?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="flex flex-col gap-2">
      {above}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-3xl font-bold text-heading">{title}</h1>
          {subtitle ? <p className="text-base text-text">{subtitle}</p> : null}
        </div>
        {actions ? <div className="flex flex-wrap items-center gap-3">{actions}</div> : null}
      </div>
    </header>
  );
}

const TILE = {
  blue: 'bg-info-soft text-action',
  green: 'bg-success-soft text-success',
  amber: 'bg-warning-soft text-gold',
  red: 'bg-danger-soft text-danger',
  purple: 'bg-purple-soft text-purple',
  grey: 'bg-disabled text-muted',
} as const;
export type ReportTone = keyof typeof TILE;

/**
 * A metric card as the Reports designs draw it: the icon on a soft tile, then the label, the
 * value, the change (an arrow, green or red) and what it compares with.
 */
export function ReportKpiCard({
  icon: I,
  tone = 'blue',
  label,
  value,
  trend,
  note,
  loading,
}: {
  icon: Icon;
  tone?: ReportTone;
  label: string;
  value: ReactNode;
  trend?: KpiTrend;
  note?: string;
  loading?: boolean;
}) {
  const Arrow = trend?.direction === 'down' ? ArrowDown : ArrowUp;
  const colour = trend?.good === false ? 'text-danger' : 'text-success';
  return (
    <Card className="flex items-start gap-4 p-5!">
      <span
        className={`flex size-12 shrink-0 items-center justify-center rounded-xl ${TILE[tone]}`}
      >
        <I aria-hidden weight="fill" className="size-7" />
      </span>
      <div className="flex min-w-0 flex-col gap-1">
        <span className="text-sm font-medium text-heading">{label}</span>
        {loading ? (
          <Skeleton className="h-8 w-16" />
        ) : (
          <span className="text-3xl leading-tight font-bold text-heading">{value}</span>
        )}
        {trend ? (
          trend.direction === 'flat' ? (
            <span className="text-sm text-muted">{trend.text}</span>
          ) : (
            <span className={`inline-flex items-center gap-1 text-sm font-medium ${colour}`}>
              <Arrow aria-hidden weight="bold" className="size-3.5" />
              <span className="sr-only">{trend.direction === 'up' ? 'Up' : 'Down'} </span>
              {trend.text}
            </span>
          )
        ) : null}
        {note ? <span className="text-xs text-muted">{note}</span> : null}
      </div>
    </Card>
  );
}
