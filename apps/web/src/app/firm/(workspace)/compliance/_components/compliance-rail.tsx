'use client';

import type { ComplianceSummary } from '@firmivra/types';
import { DonutChart, type DonutSegment, monthWeeks } from '@firmivra/ui';
import {
  ArrowRight,
  ArrowsClockwise,
  CalendarCheck,
  CaretLeft,
  CaretRight,
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
  const counts = new Map((cal.data?.days ?? []).map((day) => [day.date, day.counts]));
  const todayKey = isoDay(new Date());
  const monthTitle = month.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  const legend: [string, string][] = [
    ['Upcoming', 'bg-info'],
    ['Overdue', 'bg-danger'],
    ['Due Soon', 'bg-warning'],
    ['Completed', 'bg-success'],
  ];
  return (
    <section className={card} data-testid="card-calendar" aria-label="Deadline Calendar">
      <CardHead icon={CalendarCheck} title="Deadline Calendar" />
      <div className="mb-2 flex items-center justify-between">
        <button
          type="button"
          aria-label="Previous month"
          onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))}
          className="flex size-8 items-center justify-center rounded-md text-heading hover:bg-canvas"
        >
          <CaretLeft aria-hidden weight="bold" className="size-4" />
        </button>
        <span className="text-base font-semibold text-heading">{monthTitle}</span>
        <button
          type="button"
          aria-label="Next month"
          onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))}
          className="flex size-8 items-center justify-center rounded-md text-heading hover:bg-canvas"
        >
          <CaretRight aria-hidden weight="bold" className="size-4" />
        </button>
      </div>
      <table className="w-full table-fixed text-center text-sm" data-testid="mini-month">
        <caption className="sr-only">{monthTitle}</caption>
        <thead>
          <tr>
            {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((w) => (
              <th key={w} scope="col" className="pb-2 text-xs font-semibold text-heading">
                {w}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {monthWeeks(month, 0).map((week) => (
            <tr key={week[0]?.date.getTime()}>
              {week.map(({ date: day, inMonth }) => {
                const key = isoDay(day);
                const c = counts.get(key);
                const dots: [number | undefined, string, string][] = [
                  [c?.upcoming, 'bg-info', 'upcoming'],
                  [c?.overdue, 'bg-danger', 'overdue'],
                  [c?.dueSoon, 'bg-warning', 'due soon'],
                  [c?.completed, 'bg-success', 'completed'],
                ];
                const on = dots.filter(([n]) => n);
                const picked = selected === key;
                return (
                  <td key={day.getTime()} className="py-0.5">
                    {inMonth ? (
                      <button
                        type="button"
                        aria-label={`${day.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}${on.length ? `, ${on.map(([n, , label]) => `${n} ${label}`).join(', ')}` : ''}`}
                        aria-current={key === todayKey ? 'date' : undefined}
                        aria-pressed={picked}
                        onClick={() => onDate(picked ? undefined : key)}
                        className={`mx-auto flex size-9 flex-col items-center justify-center rounded-full ${key === todayKey ? 'bg-action font-bold text-on-action' : picked ? 'text-heading ring-2 ring-action' : 'text-heading hover:bg-canvas'}`}
                      >
                        <span className="leading-none">{day.getDate()}</span>
                        <span aria-hidden className="mt-0.5 flex h-1.5 gap-0.5">
                          {on.map(([, tone, label]) => (
                            <span key={label} className={`size-1.5 rounded-full ${tone}`} />
                          ))}
                        </span>
                      </button>
                    ) : null}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
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
          size="sm"
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
      <div className="grid grid-cols-2 gap-3">
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
        <div className="grid grid-cols-2 gap-3">
          {rows.map((c) => (
            <a
              key={c.id}
              href={c.sourceUrl}
              target="_blank"
              rel="noopener noreferrer"
              className={outlined}
            >
              <FileText aria-hidden weight="fill" className="size-4 shrink-0" />
              <span className="truncate">{c.name}</span>
              <span className="sr-only"> (opens the official page)</span>
            </a>
          ))}
        </div>
      )}
    </section>
  );
}
