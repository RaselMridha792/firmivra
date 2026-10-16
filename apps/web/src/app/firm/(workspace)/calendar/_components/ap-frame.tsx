'use client';

import { CalendarCheck, CheckCircle, Clock, Plus, UserPlus, XCircle } from '@phosphor-icons/react';
import type { ReactNode } from 'react';
import { KpiCard, PageHeader } from '@firmivra/ui';
import Link from 'next/link';
import { useSummary } from './ap-data';
import { trendOf } from './ap-shared';

export type KpiFilter = 'all' | 'upcoming' | 'completed' | 'no_show' | 'canceled';

const VIEWS = [
  { id: 'calendar', label: 'Calendar', href: '/calendar' },
  { id: 'list', label: 'List', href: '/calendar/list' },
  { id: 'today', label: 'Today', href: '/calendar/today' },
] as const;
export type AppointmentsView = (typeof VIEWS)[number]['id'];

/** The five cards of the overview. A click filters the page's own dataset by that status. */
export function KpiRow({
  filter,
  onFilter,
}: {
  filter: KpiFilter;
  onFilter: (next: KpiFilter) => void;
}) {
  const summary = useSummary();
  const data = summary.data;
  const loading = summary.isPending;
  const cards: {
    id: KpiFilter;
    icon: typeof CalendarCheck;
    tone: 'blue' | 'amber' | 'green' | 'red';
    label: string;
    value: number | undefined;
    trend?: ReturnType<typeof trendOf>;
    note?: string;
  }[] = [
    {
      id: 'all',
      icon: CalendarCheck,
      tone: 'blue',
      label: 'Total Appointments',
      value: data?.total.value,
      trend: trendOf(data?.total, true),
    },
    {
      id: 'upcoming',
      icon: UserPlus,
      tone: 'amber',
      label: 'Upcoming',
      value: data?.upcoming,
      note: '(Next 7 Days)',
    },
    {
      id: 'completed',
      icon: CheckCircle,
      tone: 'green',
      label: 'Completed',
      value: data?.completed.value,
      trend: trendOf(data?.completed, true),
    },
    {
      id: 'no_show',
      icon: Clock,
      tone: 'red',
      label: 'No-Shows',
      value: data?.noShows.value,
      trend: trendOf(data?.noShows, false),
    },
    {
      id: 'canceled',
      icon: XCircle,
      tone: 'red',
      label: 'Canceled',
      value: data?.canceled.value,
      trend: trendOf(data?.canceled, false),
    },
  ];
  return (
    <ul
      data-testid="appointments-kpis"
      className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-5"
    >
      {cards.map((card) => (
        <li key={card.id}>
          <button
            type="button"
            onClick={() => onFilter(filter === card.id ? 'all' : card.id)}
            aria-pressed={filter === card.id}
            aria-label={`Show ${card.label}`}
            data-testid={`kpi-${card.id}`}
            className={`block w-full rounded-xl text-left ${filter === card.id && card.id !== 'all' ? 'ring-2 ring-action' : ''}`}
          >
            <KpiCard
              icon={card.icon}
              tone={card.tone}
              value={card.value ?? '–'}
              label={card.label}
              loading={loading}
              {...(card.trend ? { trend: card.trend, note: 'vs last month' } : {})}
              {...(!card.trend && card.note ? { note: card.note } : {})}
            />
          </button>
        </li>
      ))}
    </ul>
  );
}

/** Calendar / List / Today: the same records, three routes (a view switch keeps the module). */
export function ViewSwitch({ active }: { active: AppointmentsView }) {
  const base = 'inline-flex min-h-10 items-center justify-center px-5 text-sm font-medium';
  return (
    <nav aria-label="Appointment views" className="flex gap-2">
      <div className="inline-flex overflow-hidden rounded-lg border border-divider bg-surface">
        {VIEWS.slice(0, 2).map((view) => (
          <Link
            key={view.id}
            href={view.href}
            aria-current={active === view.id ? 'page' : undefined}
            className={`${base} ${active === view.id ? 'bg-action text-on-action' : 'text-heading hover:bg-canvas'}`}
          >
            {view.label}
          </Link>
        ))}
      </div>
      <Link
        href="/calendar/today"
        aria-current={active === 'today' ? 'page' : undefined}
        className={`${base} rounded-lg border ${active === 'today' ? 'border-action bg-action text-on-action' : 'border-divider bg-surface text-heading hover:bg-canvas'}`}
      >
        Today
      </Link>
    </nav>
  );
}

/** The title block with the New Appointment button, shared by every overview page. */
export function OverviewHeader({ actions }: { actions?: ReactNode }) {
  return (
    <PageHeader
      title="Appointments"
      subtitle="Schedule, manage, and track meetings in one place."
      actions={
        actions ?? (
          <Link
            href="/calendar/new"
            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-control bg-action px-4 py-2 text-sm font-medium text-on-action hover:bg-action-hover"
          >
            <Plus aria-hidden weight="bold" className="size-4" /> New Appointment
          </Link>
        )
      }
    />
  );
}
