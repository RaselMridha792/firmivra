'use client';

import { Skeleton } from '@firmivra/ui';
import type { DashboardKpi, DashboardRange, DashboardSummary } from '@firmivra/types';
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
import type { ReactNode } from 'react';
import { IconTile, type Tone } from './icon-tile';
import { comparedWith } from './period-select';

export const money = (cents: number) =>
  new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'usd',
    maximumFractionDigits: 0,
  }).format(cents / 100);

/** Which way is good for a card (K8): more clients is good, more unpaid balance is not. */
type Favour = 'up' | 'down' | 'neutral';

const PILL = {
  good: 'bg-success-soft text-success',
  bad: 'bg-danger-soft text-danger',
  neutral: 'bg-canvas text-muted',
  info: 'bg-info-soft text-info',
};

/**
 * Octavia's review of Oct 25, K8: the change against the equivalent period before, as an arrow,
 * a percentage and words, its colour by whether the change is good for this card (with the
 * words saying so too). Unchanged is "No change"; nothing before is "New" (or "No change" when
 * both are zero); a card the data keeps no history for says N/A.
 */
export function Trend({
  kpi,
  favour,
  against,
}: {
  kpi: DashboardKpi;
  favour: Favour;
  against: string;
}) {
  const pill = (tone: keyof typeof PILL, body: ReactNode) => (
    <span
      className={`flex w-fit items-center gap-1 rounded-pill px-1.5 py-0.5 font-semibold ${PILL[tone]}`}
    >
      {body}
    </span>
  );
  const line = (badge: ReactNode, words: string) => (
    <span data-testid="kpi-trend" className="flex flex-col text-sm text-muted">
      {badge}
      {words}
    </span>
  );
  if (kpi.previous === null) return line(pill('neutral', 'N/A'), 'no earlier figure is kept');
  if (kpi.previous === 0) {
    return kpi.value === 0
      ? line(pill('neutral', 'No change'), against)
      : line(pill('info', 'New'), `none ${against.replace(/^vs /, 'in ')}`);
  }
  const change = Math.round(((kpi.value - kpi.previous) / kpi.previous) * 100);
  if (change === 0) return line(pill('neutral', 'No change'), against);
  const up = change > 0;
  const tone = favour === 'neutral' ? 'neutral' : up === (favour === 'up') ? 'good' : 'bad';
  const Arrow = up ? ArrowUp : ArrowDown;
  return line(
    pill(
      tone,
      <>
        <Arrow aria-hidden className="size-4" />
        <span>
          <span className="sr-only">{up ? 'Up ' : 'Down '}</span>
          {Math.abs(change)}%
          {tone === 'neutral' ? null : (
            <span className="sr-only">{tone === 'good' ? ', favourable' : ', unfavourable'}</span>
          )}
        </span>
      </>,
    ),
    against,
  );
}

const CARDS: {
  key: keyof DashboardSummary['kpis'];
  label: string;
  icon: Icon;
  tone: Tone;
  href: string;
  /** Null: the card shows no comparison (the design draws none for Appointments Today). */
  favour: Favour | null;
  /** Follows the global period (C1); the others are always as of today. */
  periodic: boolean;
}[] = [
  {
    key: 'totalClients',
    label: 'Total Clients',
    icon: UsersThree,
    tone: 'blue',
    href: '/clients',
    favour: 'up',
    periodic: true,
  },
  {
    key: 'newLeads',
    label: 'New Leads',
    icon: UserPlus,
    tone: 'amber',
    href: '/leads',
    favour: 'up',
    periodic: true,
  },
  {
    key: 'returnsInProgress',
    label: 'Returns In Progress',
    icon: FileText,
    tone: 'purple',
    href: '/tax-returns',
    favour: 'neutral',
    periodic: true,
  },
  {
    key: 'completedReturns',
    label: 'Completed Returns',
    icon: CheckCircle,
    tone: 'green',
    href: '/tax-returns',
    favour: 'up',
    periodic: true,
  },
  {
    key: 'outstandingInvoicesCents',
    label: 'Outstanding Invoices',
    icon: CurrencyDollar,
    tone: 'red',
    href: '/invoices',
    favour: 'down',
    periodic: false,
  },
  {
    key: 'appointmentsToday',
    label: 'Appointments Today',
    icon: CalendarDots,
    tone: 'blue',
    href: '/calendar',
    favour: null,
    periodic: false,
  },
];

const daysIn = (r: DashboardRange) => (Date.parse(r.to) - Date.parse(r.from)) / 86_400_000 + 1;

/** The six numbers of the design's top row, from the dashboard summary. */
export function KpiCards({ summary }: { summary: UseQueryResult<DashboardSummary> }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
      {CARDS.map(({ key, label, icon, tone, href, favour, periodic }) => {
        const kpi = summary.data?.kpis[key];
        const range = summary.data?.range;
        const against = range ? comparedWith(range.period, daysIn(range)) : '';
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
              {kpi && favour ? (
                <Trend kpi={kpi} favour={favour} against={periodic ? against : ''} />
              ) : null}
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
