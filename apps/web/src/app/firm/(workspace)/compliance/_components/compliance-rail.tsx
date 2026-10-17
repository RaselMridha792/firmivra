'use client';

import type { ComplianceSummary } from '@firmivra/types';
import { CalendarGrid, type CalendarEvent, DonutChart, type DonutSegment } from '@firmivra/ui';
import {
  ArrowRight,
  ArrowsClockwise,
  CalendarCheck,
  ChartPieSlice,
  DownloadSimple,
  FileText,
  Lightning,
  Plus,
  Users,
  Warning,
  type Icon,
} from '@phosphor-icons/react';
import Link from 'next/link';
import { useState, type ReactNode } from 'react';
import { api } from '../../../../../lib/api';
import { useApiQuery } from '../../../../../lib/query';
import {
  COMPLIANCE_KEY,
  TYPE_LABEL,
  TYPE_TONE,
  isoDay,
  outlined,
  quiet,
} from './compliance-shared';

const card = 'min-w-0 rounded-xl bg-surface p-4 shadow-md';
function CardHead({ icon: Glyph, title, aside }: { icon: Icon; title: string; aside?: ReactNode }) {
  return (
    <header className="mb-3 flex items-center justify-between gap-2">
      <div className="flex items-center gap-3">
        <span
          aria-hidden
          className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-info-soft text-action"
        >
          <Glyph weight="fill" className="size-5" />
        </span>
        <h2 className="font-display text-base font-bold text-heading">{title}</h2>
      </div>
      {aside}
    </header>
  );
}
const link = 'inline-flex items-center gap-1 text-sm font-medium text-link';

const DAY_TONE = {
  UPCOMING: 'blue',
  IN_PROGRESS: 'blue',
  WAITING_ON_CLIENT: 'blue',
  DUE_SOON: 'amber',
  OVERDUE: 'red',
  COMPLETED: 'green',
  NOT_APPLICABLE: 'grey',
  CANCELLED: 'grey',
} as const;

/** Deadline Calendar: the month with its due dates marked; a date filters the list. */
export function DeadlineCalendar({
  selected,
  onDate,
  filters,
}: {
  selected: string | undefined;
  onDate: (date: string | undefined) => void;
  filters?: { type?: string; clientId?: string; assignedUserId?: string; mine?: boolean };
}) {
  const [month, setMonth] = useState(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });
  const key = `${month.getFullYear()}-${String(month.getMonth() + 1).padStart(2, '0')}`;
  const cal = useApiQuery([...COMPLIANCE_KEY, 'month', key, filters ?? {}], () =>
    api.compliance.month({
      month: key,
      ...(filters?.type ? { type: filters.type as never } : {}),
      ...(filters?.clientId ? { clientId: filters.clientId } : {}),
      ...(filters?.assignedUserId ? { assignedUserId: filters.assignedUserId } : {}),
      ...(filters?.mine ? { mine: true } : {}),
    }),
  );
  const events: CalendarEvent[] = (cal.data?.days ?? []).flatMap((day) =>
    day.deadlines.map((d) => ({
      id: d.id,
      start: `${day.date}T09:00:00`,
      end: `${day.date}T10:00:00`,
      title: d.name,
      tone: DAY_TONE[d.displayStatus],
    })),
  );
  const [y, m, d] = (selected ?? '').split('-').map(Number);
  const legend: [string, string][] = [
    ['Upcoming', 'bg-info'],
    ['Overdue', 'bg-danger'],
    ['Due Soon', 'bg-warning'],
    ['Completed', 'bg-success'],
  ];
  return (
    <section className={card} data-testid="card-calendar" aria-label="Deadline Calendar">
      <CardHead icon={CalendarCheck} title="Deadline Calendar" />
      <CalendarGrid
        view="mini"
        date={month}
        events={events}
        today={new Date()}
        {...(selected ? { selected: new Date(y ?? 2000, (m ?? 1) - 1, d ?? 1) } : {})}
        onPrev={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))}
        onNext={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))}
        onDateClick={(day) => onDate(selected === isoDay(day) ? undefined : isoDay(day))}
      />
      <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-text" aria-label="Legend">
        {legend.map(([label, dot]) => (
          <li key={label} className="flex items-center gap-1.5">
            <span aria-hidden className={`size-2 rounded-full ${dot}`} />
            {label}
          </li>
        ))}
      </ul>
      {cal.isError ? (
        <p className={`${quiet} mt-2`}>Due dates are not available right now.</p>
      ) : null}
    </section>
  );
}

/** Deadline Types: the ring of the firm's open deadlines by type. */
export function TypesCard({
  summary,
  loading,
  failed,
}: {
  summary?: ComplianceSummary;
  loading: boolean;
  failed: boolean;
}) {
  const segments: DonutSegment[] = (summary?.types ?? []).map((t) => ({
    label: TYPE_LABEL[t.type],
    value: t.count,
    tone: TYPE_TONE[t.type],
  }));
  return (
    <section className={card} data-testid="card-types" aria-label="Deadline Types">
      <CardHead icon={ChartPieSlice} title="Deadline Types" />
      {failed ? (
        <p className={quiet}>Deadline types are not available right now.</p>
      ) : loading ? (
        <p className={quiet}>Loading…</p>
      ) : (
        <DonutChart
          segments={segments}
          centerLabel="Total"
          size="md"
          emptyText="No deadlines yet."
          label="Deadlines by type"
        />
      )}
    </section>
  );
}

/** At Risk Clients: who needs action, and why. */
export function AtRiskCard({
  summary,
  loading,
  failed,
  onAll,
}: {
  summary?: ComplianceSummary;
  loading: boolean;
  failed: boolean;
  onAll: () => void;
}) {
  const rows = summary?.atRiskClients ?? [];
  const why = (r: (typeof rows)[number]) =>
    [
      r.overdueCount ? `${r.overdueCount} overdue` : '',
      r.highPriorityUpcomingCount ? `${r.highPriorityUpcomingCount} upcoming (high priority)` : '',
      r.waitingOnClientCount ? `${r.waitingOnClientCount} waiting on client` : '',
    ]
      .filter(Boolean)
      .join(', ');
  return (
    <section className={card} data-testid="card-risk" aria-label="At Risk Clients">
      <CardHead
        icon={Warning}
        title="At Risk Clients"
        aside={
          <button type="button" onClick={onAll} className={link}>
            View All <ArrowRight aria-hidden weight="bold" className="size-3" />
          </button>
        }
      />
      {rows.length === 0 ? (
        <p className={quiet}>
          {failed
            ? 'At-risk clients are not available right now.'
            : loading
              ? 'Loading…'
              : 'No clients are at risk.'}
        </p>
      ) : (
        <ul className="flex flex-col">
          {rows.map((r) => (
            <li
              key={r.client.id}
              className="flex items-center justify-between gap-3 border-t border-divider py-2 first:border-t-0"
            >
              <div className="flex min-w-0 flex-col">
                <span className="truncate text-sm font-semibold text-heading">
                  {r.client.displayName}
                </span>
                <span
                  className={`truncate text-xs ${r.overdueCount ? 'text-danger' : 'text-warning'}`}
                >
                  {why(r)}
                </span>
              </div>
              <Link
                href={`/clients/${r.client.id}`}
                aria-label={`View ${r.client.displayName}`}
                className="inline-flex min-h-9 shrink-0 items-center rounded-control border border-action px-4 text-sm font-medium text-action hover:bg-accent-soft"
              >
                View
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** Quick Actions: Add Deadline, Create Recurring, Import Government Calendar, Bulk Actions. */
export function QuickActions({ onBulk }: { onBulk: () => void }) {
  return (
    <section className={card} data-testid="card-quick" aria-label="Quick Actions">
      <CardHead icon={Lightning} title="Quick Actions" />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Link href="/compliance/new" className={outlined}>
          <Plus aria-hidden weight="bold" className="size-4" /> Add Deadline
        </Link>
        <Link href="/compliance/recurring/new" className={outlined}>
          <ArrowsClockwise aria-hidden weight="bold" className="size-4" /> Create Recurring
        </Link>
        <Link href="/compliance/recurring/new?tab=import" className={outlined}>
          <DownloadSimple aria-hidden weight="bold" className="size-4" /> Import Government Calendar
        </Link>
        <button type="button" onClick={onBulk} className={outlined}>
          <Users aria-hidden weight="bold" className="size-4" /> Bulk Actions
        </button>
      </div>
    </section>
  );
}

/** Resources: the official source of every published calendar (never invented links). */
export function ResourcesCard() {
  const calendars = useApiQuery([...COMPLIANCE_KEY, 'calendars', 'published'], () =>
    api.compliance.calendars({ status: 'PUBLISHED', pageSize: 4 }),
  );
  const rows = calendars.data?.items ?? [];
  return (
    <section className={card} data-testid="card-resources" aria-label="Resources">
      <CardHead icon={FileText} title="Resources" />
      {rows.length === 0 ? (
        <p className={quiet}>
          {calendars.isPending
            ? 'Loading…'
            : calendars.isError
              ? 'Resources are not available right now.'
              : 'Publish a government calendar to link its official source here.'}
        </p>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {rows.map((c) => (
            <a
              key={c.id}
              href={c.sourceUrl}
              target="_blank"
              rel="noopener noreferrer"
              className={outlined}
            >
              <FileText aria-hidden weight="fill" className="size-4 shrink-0" />
              <span className="truncate">{c.authority}</span>
              <span className="sr-only"> (opens the official page)</span>
            </a>
          ))}
        </div>
      )}
    </section>
  );
}
