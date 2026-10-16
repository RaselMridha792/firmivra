'use client';

import type {
  AgendaItem,
  AppointmentDisplayStatus,
  CountWithPrevious,
  MeetingMethod,
} from '@firmivra/types';
import { Skeleton, type TileTone, tileTones } from '@firmivra/ui';
import {
  ArrowDown,
  ArrowUp,
  CalendarCheck,
  CheckCircle,
  Clock,
  type Icon,
  Plus,
  UserPlus,
  XCircle,
} from '@phosphor-icons/react';
import Link from 'next/link';
import { type ReactNode, createElement } from 'react';
import { api } from '../../../../../lib/api';
import { useApiQuery } from '../../../../../lib/query';

/** Query keys of the Appointments workspace (R42 scheduling contract). */
export const SCHEDULING = ['scheduling'];

/** The line a card shows when its call failed (design-match rule 2). */
export const NOT_LOADED = 'Could not load this right now. It fills in once the data is available.';

export const STATUS_LOOKS: Record<
  AppointmentDisplayStatus,
  { label: string; tone: 'success' | 'info' | 'warning' | 'danger' | 'neutral' | 'purple' }
> = {
  DRAFT: { label: 'Draft', tone: 'neutral' },
  PENDING: { label: 'Pending', tone: 'warning' },
  CONFIRMED: { label: 'Confirmed', tone: 'success' },
  RESCHEDULED: { label: 'Rescheduled', tone: 'purple' },
  COMPLETED: { label: 'Completed', tone: 'info' },
  NO_SHOW: { label: 'No-Show', tone: 'danger' },
  CANCELED: { label: 'Canceled', tone: 'danger' },
};

export const METHOD_LABELS: Record<MeetingMethod, string> = {
  IN_PERSON: 'In-Person',
  PHONE: 'Phone',
  VIDEO: 'Zoom / Video',
  OTHER: 'Other',
};

/** Where it happens: Zoom, Phone, or In-Person with the office. */
export function placeOf(item: Pick<AgendaItem, 'method' | 'place'>): string {
  if (item.method !== 'IN_PERSON') return METHOD_LABELS[item.method];
  return item.place.office ? `In-Person, ${item.place.office.name}` : 'In-Person';
}

/** "Sep 22, 2026" and "10:00 AM" in the firm's time zone. */
export function dateAndTime(iso: string, timeZone: string): [string, string] {
  const d = new Date(iso);
  return [
    d.toLocaleDateString('en-US', { timeZone, month: 'short', day: 'numeric', year: 'numeric' }),
    d.toLocaleTimeString('en-US', { timeZone, hour: 'numeric', minute: '2-digit' }),
  ];
}

/** Two letters of a name, for the avatar circles. */
export const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join('');

/**
 * The top of every Appointments view (appointments.jpg): the title and line, and New
 * Appointment, which opens Schedule Appointment.
 */
export function AppointmentsHeader() {
  return (
    <header className="flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        <h1 data-testid="page-title" className="text-3xl font-bold text-heading">
          Appointments
        </h1>
        <p className="text-base text-link">Schedule, manage, and track meetings in one place.</p>
      </div>
      <Link
        href="/calendar/new"
        className="inline-flex min-h-11 items-center gap-2 rounded-control bg-action px-5 text-sm font-semibold text-on-action hover:bg-action-hover"
      >
        <Plus aria-hidden weight="bold" className="size-4" />
        New Appointment
      </Link>
    </header>
  );
}

function change(c: CountWithPrevious): { text: string; up: boolean } | null {
  if (c.previous === null || c.previous === 0) return null;
  const pct = Math.round(((c.value - c.previous) / c.previous) * 100);
  return { text: `${Math.abs(pct)}%`, up: pct >= 0 };
}

function Kpi({
  label,
  icon,
  tone,
  value,
  note,
  delta,
  good,
}: {
  label: string;
  icon: Icon;
  tone: TileTone;
  value: ReactNode;
  note: string;
  delta?: { text: string; up: boolean } | null;
  /** Up is good for Total and Completed, bad for No-Shows and Canceled. */
  good?: 'up' | 'down';
}) {
  const positive = delta ? (good === 'down' ? !delta.up : delta.up) : true;
  return (
    <section
      aria-label={label}
      className="flex items-center gap-3 rounded-xl border border-divider bg-surface p-4 shadow-sm"
    >
      <span
        aria-hidden
        className={`flex size-14 shrink-0 items-center justify-center rounded-full ${tileTones[tone]}`}
      >
        {createElement(icon, { weight: 'fill', className: 'size-7' })}
      </span>
      <div className="min-w-0">
        <div className="text-2xl font-bold text-heading">{value}</div>
        <h2 className="text-sm text-link">{label}</h2>
        {delta ? (
          <p className="flex flex-wrap items-center gap-1 text-xs text-muted">
            <span
              className={`inline-flex items-center gap-0.5 rounded px-1 font-semibold ${positive ? 'bg-success-soft text-success' : 'bg-danger-soft text-danger'}`}
            >
              {delta.up ? (
                <ArrowUp aria-hidden weight="bold" className="size-3" />
              ) : (
                <ArrowDown aria-hidden weight="bold" className="size-3" />
              )}
              {delta.text}
            </span>
            {note}
          </p>
        ) : (
          <p className="text-xs text-muted">{note}</p>
        )}
      </div>
    </section>
  );
}

/** The five KPI cards (`api.scheduling.summary`): this month, each "vs last month". */
export function SummaryCards() {
  const summary = useApiQuery([...SCHEDULING, 'summary'], () => api.scheduling.summary());
  const s = summary.data;
  const n = (v: number | undefined) =>
    summary.isPending ? <Skeleton className="h-7 w-10" /> : (v ?? '—');
  const note = s ? 'vs last month' : summary.isError ? 'Not loaded' : '';
  return (
    <div
      data-testid="appointment-kpis"
      className="grid grid-cols-2 gap-3 md:grid-cols-3 min-[1440px]:grid-cols-5"
    >
      <Kpi
        label="Total Appointments"
        icon={CalendarCheck}
        tone="blue"
        value={n(s?.total.value)}
        note={note}
        delta={s && change(s.total)}
        good="up"
      />
      <Kpi
        label="Upcoming (Next 7 Days)"
        icon={UserPlus}
        tone="amber"
        value={n(s?.upcoming)}
        note={s ? '' : note}
      />
      <Kpi
        label="Completed"
        icon={CheckCircle}
        tone="green"
        value={n(s?.completed.value)}
        note={note}
        delta={s && change(s.completed)}
        good="up"
      />
      <Kpi
        label="No-Shows"
        icon={Clock}
        tone="red"
        value={n(s?.noShows.value)}
        note={note}
        delta={s && change(s.noShows)}
        good="down"
      />
      <Kpi
        label="Canceled"
        icon={XCircle}
        tone="red"
        value={n(s?.canceled.value)}
        note={note}
        delta={s && change(s.canceled)}
        good="down"
      />
    </div>
  );
}

const VIEWS = [
  { id: 'calendar', label: 'Calendar', href: '/calendar' },
  { id: 'list', label: 'List', href: '/calendar/list' },
  { id: 'today', label: 'Today', href: '/calendar/today' },
] as const;

/** Calendar, List and Today: each view is its own page (PAGE-MAP), so these are links. */
export function ViewSwitch({ current }: { current: (typeof VIEWS)[number]['id'] }) {
  return (
    <nav aria-label="Appointment views" className="flex gap-2">
      {VIEWS.map((v) => {
        const on = v.id === current;
        return (
          <Link
            key={v.id}
            href={v.href}
            aria-current={on ? 'page' : undefined}
            className={`inline-flex min-h-11 items-center rounded-lg border px-6 text-sm font-semibold ${on ? 'border-action bg-action text-on-action' : 'border-divider bg-surface text-heading hover:bg-canvas'}`}
          >
            {v.label}
          </Link>
        );
      })}
    </nav>
  );
}
