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
      <span
        className={`flex items-center gap-1 font-semibold ${change > 0 ? 'text-success' : change < 0 ? 'text-danger' : ''}`}
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

const CARDS: {
  key: keyof DashboardSummary['kpis'];
  label: string;
  icon: Icon;
  tone: Tone;
  href: string;
  period?: string;
}[] = [
  {
    key: 'totalClients',
    label: 'Total Clients',
    icon: UsersThree,
    tone: 'blue',
    href: '/clients',
    period: 'last month',
  },
  {
    key: 'newLeads',
    label: 'New Leads',
    icon: UserPlus,
    tone: 'amber',
    href: '/leads',
    period: 'last month',
  },
  {
    key: 'returnsInProgress',
    label: 'Returns In Progress',
    icon: FileText,
    tone: 'purple',
    href: '/tax-returns',
    period: 'last week',
  },
  {
    key: 'completedReturns',
    label: 'Completed Returns',
    icon: CheckCircle,
    tone: 'green',
    href: '/tax-returns',
    period: 'last month',
  },
  {
    key: 'outstandingInvoicesCents',
    label: 'Outstanding Invoices',
    icon: CurrencyDollar,
    tone: 'red',
    href: '/invoices',
    period: 'last month',
  },
  {
    key: 'appointmentsToday',
    label: 'Appointments Today',
    icon: CalendarDots,
    tone: 'blue',
    href: '/calendar',
  },
];

/** The six numbers of the design's top row, from the dashboard summary. */
export function KpiCards({ summary }: { summary: UseQueryResult<DashboardSummary> }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
      {CARDS.map(({ key, label, icon, tone, href, period }) => {
        const kpi = summary.data?.kpis[key];
        const value = kpi
          ? key === 'outstandingInvoicesCents'
            ? money(kpi.value)
            : String(kpi.value)
          : '—';
        const body = (
          <>
            <IconTile icon={icon} tone={tone} small />
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
