'use client';

import { CalendarGrid, type CalendarEvent } from '@firmivra/ui';
import {
  ArrowRight,
  CalendarBlank,
  ChartBar,
  Lightning,
  ListChecks,
  Plus,
  Repeat,
  FileText,
} from '@phosphor-icons/react';
import Link from 'next/link';
import { useState, type ReactNode } from 'react';
import { api } from '../../../../../lib/api';
import { useApiQuery } from '../../../../../lib/query';
import { TASKS_KEY } from './task-shared';

const card = 'min-w-0 rounded-xl bg-surface p-4 shadow-md';
function CardHead({
  icon: Glyph,
  title,
  aside,
}: {
  icon: typeof ChartBar;
  title: string;
  aside?: ReactNode;
}) {
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
const quiet = 'rounded-lg bg-canvas p-4 text-center text-sm text-muted';
const iso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** My Task Summary: the counts of the tasks assigned to the signed-in person. */
export function MySummary({ onAll }: { onAll: () => void }) {
  const mine = useApiQuery([...TASKS_KEY, 'rail', 'mine'], () =>
    api.taskWork.overview({ view: 'mine', pageSize: 100 }),
  );
  const summary = useApiQuery([...TASKS_KEY, 'summary'], () => api.taskWork.summary());
  const open = (mine.data?.items ?? []).filter((t) => t.status === 'OPEN');
  const n = (f: (t: (typeof open)[number]) => boolean) => (mine.data ? open.filter(f).length : '—');
  const rows: [string, string | number, string][] = [
    ['Total Tasks', mine.data ? open.length : '—', 'text-heading'],
    ['Pending', n((t) => t.progress === 'PENDING' || t.progress === 'NOT_STARTED'), 'text-heading'],
    ['In Progress', n((t) => t.progress === 'IN_PROGRESS'), 'text-success'],
    ['Overdue', n((t) => t.overdue), 'text-danger'],
    ['Completed (This Month)', summary.data?.completedThisMonth ?? '—', 'text-success'],
  ];
  return (
    <section className={card} data-testid="rail-summary" aria-label="My Task Summary">
      <CardHead
        icon={ChartBar}
        title="My Task Summary"
        aside={
          <button type="button" onClick={onAll} className={link}>
            View All <ArrowRight aria-hidden weight="bold" className="size-3" />
          </button>
        }
      />
      <dl className="flex flex-col text-sm">
        {rows.map(([label, value, tone]) => (
          <div
            key={label}
            className="flex items-center justify-between border-t border-divider py-2 first:border-t-0"
          >
            <dt className={label === 'Total Tasks' ? 'text-heading' : tone}>{label}</dt>
            <dd className="font-semibold text-heading">{value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

/** Upcoming Deadlines: the next five due tasks. */
export function UpcomingDeadlines({ onAll }: { onAll: () => void }) {
  const from = iso(new Date());
  const upcoming = useApiQuery([...TASKS_KEY, 'rail', 'upcoming', from], () =>
    api.taskWork.overview({ view: 'all', dueFrom: from, sort: 'due', pageSize: 5 }),
  );
  const rows = (upcoming.data?.items ?? []).filter((t) => t.status === 'OPEN');
  return (
    <section className={card} data-testid="rail-upcoming" aria-label="Upcoming Deadlines">
      <CardHead
        icon={CalendarBlank}
        title="Upcoming Deadlines"
        aside={
          <button type="button" onClick={onAll} className={link}>
            View All <ArrowRight aria-hidden weight="bold" className="size-3" />
          </button>
        }
      />
      {rows.length === 0 ? (
        <p className={quiet}>
          {upcoming.isPending
            ? 'Loading…'
            : upcoming.isError
              ? 'Deadlines are not available right now.'
              : 'No upcoming deadlines.'}
        </p>
      ) : (
        <ul className="flex flex-col">
          {rows.map((t) => {
            const d = new Date(`${t.dueOn}T12:00:00Z`);
            return (
              <li
                key={t.id}
                className="flex items-center gap-3 border-t border-divider py-2 first:border-t-0"
              >
                <span className="flex w-11 shrink-0 flex-col items-center rounded-lg border border-divider py-0.5">
                  <span className="text-[0.625rem] font-semibold text-muted uppercase">
                    {d.toLocaleDateString('en-US', { timeZone: 'UTC', month: 'short' })}
                  </span>
                  <span className="text-base leading-tight font-bold text-heading">
                    {d.getUTCDate()}
                  </span>
                </span>
                <Link href={`/tasks/${t.id}`} className="flex min-w-0 flex-col">
                  <span className="truncate text-sm font-semibold text-heading">{t.title}</span>
                  <span className="truncate text-xs text-muted">{t.client.displayName}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

/** Task Templates: the first five, each one starts a new task. */
export function TemplatesCard({ onAll }: { onAll: () => void }) {
  const templates = useApiQuery([...TASKS_KEY, 'templates', 'active'], () =>
    api.taskWork.templates({ status: 'active' }),
  );
  const rows = (templates.data ?? []).slice(0, 5);
  return (
    <section className={card} data-testid="card-templates" aria-label="Task Templates">
      <CardHead
        icon={FileText}
        title="Task Templates"
        aside={
          <button type="button" onClick={onAll} className={link}>
            View All <ArrowRight aria-hidden weight="bold" className="size-3" />
          </button>
        }
      />
      {rows.length === 0 ? (
        <p className={quiet}>
          {templates.isPending
            ? 'Loading…'
            : templates.isError
              ? 'Templates are not available right now.'
              : 'No templates yet. Save a task as a template to reuse it.'}
        </p>
      ) : (
        <ul className="flex flex-col">
          {rows.map((t) => (
            <li key={t.id}>
              <Link
                href={`/tasks/new?template=${t.id}`}
                className="flex items-center justify-between gap-2 border-t border-divider py-2 text-sm text-heading first:border-t-0 hover:text-action"
              >
                <span className="truncate">{t.name}</span>
                <ArrowRight aria-hidden weight="bold" className="size-3 shrink-0 text-muted" />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** Quick Actions: Add Task, Add Recurring Task, Use a Template, Bulk Actions. */
export function QuickActions({
  onTemplates,
  onBulk,
}: {
  onTemplates: () => void;
  onBulk: () => void;
}) {
  const tile =
    'flex min-h-14 items-center justify-center gap-2 rounded-lg border border-action bg-surface px-3 text-sm font-medium text-action hover:bg-accent-soft';
  return (
    <section className={card} data-testid="card-quick" aria-label="Quick Actions">
      <CardHead icon={Lightning} title="Quick Actions" />
      <div className="grid grid-cols-2 gap-3">
        <Link href="/tasks/new" className={tile}>
          <Plus aria-hidden weight="bold" className="size-4" /> Add Task
        </Link>
        <Link href="/tasks/recurring/new" className={tile}>
          <Repeat aria-hidden weight="bold" className="size-4" /> Add Recurring Task
        </Link>
        <button type="button" onClick={onTemplates} className={tile}>
          <FileText aria-hidden weight="fill" className="size-4" /> Use a Template
        </button>
        <button type="button" onClick={onBulk} className={tile}>
          <ListChecks aria-hidden weight="bold" className="size-4" /> Bulk Actions
        </button>
      </div>
    </section>
  );
}

/** Task Calendar: the month with its due dates marked; a date filters the table. */
export function TaskCalendar({
  selected,
  onDate,
  onAll,
}: {
  selected: string | undefined;
  onDate: (date: string | undefined) => void;
  onAll: () => void;
}) {
  const [month, setMonth] = useState(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });
  const from = iso(new Date(month.getFullYear(), month.getMonth(), 1));
  const to = iso(new Date(month.getFullYear(), month.getMonth() + 1, 0));
  const cal = useApiQuery([...TASKS_KEY, 'calendar', from, to], () =>
    api.taskWork.calendar({ from, to }),
  );
  const events: CalendarEvent[] = (cal.data?.items ?? []).map((t) => ({
    id: t.id,
    start: `${t.dueOn}T09:00:00`,
    end: `${t.dueOn}T10:00:00`,
    title: t.title,
    tone: t.overdue ? 'red' : t.priority === 'HIGH' ? 'amber' : 'blue',
  }));
  const [y, m, d] = (selected ?? '').split('-').map(Number);
  return (
    <section className={card} data-testid="card-calendar" aria-label="Task Calendar">
      <CardHead
        icon={CalendarBlank}
        title="Task Calendar"
        aside={
          <button type="button" onClick={onAll} className={link}>
            View Calendar <ArrowRight aria-hidden weight="bold" className="size-3" />
          </button>
        }
      />
      <CalendarGrid
        view="mini"
        date={month}
        events={events}
        today={new Date()}
        {...(selected ? { selected: new Date(y ?? 2000, (m ?? 1) - 1, d ?? 1) } : {})}
        onPrev={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))}
        onNext={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))}
        onDateClick={(day) => onDate(selected === iso(day) ? undefined : iso(day))}
      />
      {cal.isError ? (
        <p className={`${quiet} mt-2`}>Due dates are not available right now.</p>
      ) : null}
    </section>
  );
}
