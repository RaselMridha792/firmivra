'use client';

import { Skeleton } from '@firmivra/ui';
import type { DashboardKpi, DashboardSummary } from '@firmivra/types';
import {
  CalendarDots,
  CheckCircle,
  CurrencyDollar,
  FileText,
  type Icon,
  UserPlus,
  UsersThree,
} from '@phosphor-icons/react';
import type { UseQueryResult } from '@tanstack/react-query';
import { ArrowDown, ArrowRight, ArrowUp } from 'lucide-react';
import Link from 'next/link';
import { FROM_DASHBOARD } from '../../../../lib/from-dashboard';
import { IconTile, type Tone } from './icon-tile';

export const money = (cents: number) =>
  new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'usd',
    maximumFractionDigits: 0,
  }).format(cents / 100);

/** "↑ 12% vs last month", only when the API gives the period before and it isn't zero. */
function Trend({ kpi, period }: { kpi: DashboardKpi; period: string }) {
  if (!kpi.previous) return null;
  const change = Math.round(((kpi.value - kpi.previous) / kpi.previous) * 100);
  const Arrow = change > 0 ? ArrowUp : change < 0 ? ArrowDown : null;
  return (
    <span className="flex flex-col text-sm text-muted">
      {/* A small pill, green or red, as the design draws each trend (R1, Oct 20). */}
      <span
        className={`flex w-fit items-center gap-1 rounded-pill px-1.5 py-0.5 font-semibold ${change > 0 ? 'bg-success-soft text-success' : change < 0 ? 'bg-danger-soft text-danger' : 'bg-canvas'}`}
      >
        {Arrow ? <Arrow aria-hidden className="size-4" /> : null}
        <span>
          <span className="sr-only">{change > 0 ? 'Up ' : change < 0 ? 'Down ' : ''}</span>
          {Math.abs(change)}%
        </span>
      </span>
      vs {period}
    </span>
  );
}

/** This month so far, in the firm's days: the period the monthly cards count. */
type Month = { from: string; to: string } | null;

/**
 * The six cards and where each opens (Octavia's K3 to K7): the list filtered to exactly the records
 * the card counts, with Back to Dashboard. `month` is null until the summary gives the firm's day.
 */
const CARDS: {
  key: keyof DashboardSummary['kpis'];
  label: string;
  icon: Icon;
  tone: Tone;
  href: (month: Month) => string;
  period?: string;
}[] = [
  {
    key: 'totalClients',
    label: 'Total Clients',
    icon: UsersThree,
    tone: 'blue',
    href: () => `/clients?${FROM_DASHBOARD}`,
    period: 'last month',
  },
  {
    key: 'newLeads',
    label: 'New Leads',
    icon: UserPlus,
    tone: 'amber',
    // Stage New Lead, created this month (the API counts the same).
    href: (m) => `/leads?stage=SUBMITTED${m ? `&from=${m.from}&to=${m.to}` : ''}&${FROM_DASHBOARD}`,
    period: 'last month',
  },
  {
    key: 'returnsInProgress',
    label: 'Returns In Progress',
    icon: FileText,
    tone: 'purple',
    // In Preparation, Waiting on Client and Ready for Review/Signature/File.
    href: () => `/tax-returns?status=IN_PROGRESS&${FROM_DASHBOARD}`,
    period: 'last week',
  },
  {
    key: 'acceptedReturns',
    label: 'Accepted Returns',
    icon: CheckCircle,
    tone: 'green',
    // Accepted only (not Transmitted, not Rejected), accepted this month.
    href: (m) =>
      `/tax-returns?status=ACCEPTED${m ? `&acceptedFrom=${m.from}&acceptedTo=${m.to}` : ''}&${FROM_DASHBOARD}`,
    period: 'last month',
  },
  {
    key: 'outstandingInvoicesCents',
    label: 'Outstanding Invoices',
    icon: CurrencyDollar,
    tone: 'red',
    // Every unpaid balance, overdue or not.
    href: () => `/invoices?status=OUTSTANDING&${FROM_DASHBOARD}`,
    period: 'last month',
  },
  {
    key: 'appointmentsToday',
    label: 'Appointments Today',
    icon: CalendarDots,
    tone: 'blue',
    href: () => `/calendar/today?${FROM_DASHBOARD}`,
  },
];

/** The six numbers of the design's top row, from the dashboard summary. */
export function KpiCards({ summary }: { summary: UseQueryResult<DashboardSummary> }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
      {CARDS.map(({ key, label, icon, tone, href: to, period }) => {
        const kpi = summary.data?.kpis[key];
        const today = summary.data?.today;
        const href = to(today ? { from: `${today.slice(0, 8)}01`, to: today } : null);
        const value = kpi
          ? key === 'outstandingInvoicesCents'
            ? money(kpi.value)
            : String(kpi.value)
          : '—';
        const body = (
          <>
            <IconTile icon={icon} tone={tone} />
            <span className="flex min-w-0 flex-col gap-1">
              {summary.isPending ? (
                <Skeleton className="h-8 w-16" />
              ) : (
                <span className="text-2xl font-bold text-heading">{value}</span>
              )}
              <span className="text-sm text-muted">{label}</span>
              {kpi && period ? <Trend kpi={kpi} period={period} /> : null}
            </span>
          </>
        );
        const card = 'flex items-start gap-3 rounded-xl bg-surface p-3 shadow-md';
        return key === 'appointmentsToday' ? (
          <div key={key} data-testid="kpi-card" className={`${card} flex-col`}>
            <div className="flex items-start gap-3">{body}</div>
            <Link
              href={href}
              className="flex w-full items-center justify-center gap-1 rounded-control border border-action px-3 py-1 text-sm font-medium text-action hover:bg-folder-surface"
            >
              View Calendar
              <ArrowRight aria-hidden className="size-4" />
            </Link>
          </div>
        ) : (
          <Link key={key} href={href} data-testid="kpi-card" className={`${card} hover:bg-canvas`}>
            {body}
          </Link>
        );
      })}
    </div>
  );
}
