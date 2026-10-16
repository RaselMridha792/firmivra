'use client';

import {
  ArrowsClockwise,
  CalendarDots,
  CalendarPlus,
  ChartLineUp,
  Envelope,
  Eye,
  Lightbulb,
  PencilSimple,
} from '@phosphor-icons/react';
import type { Icon } from '@phosphor-icons/react';
import { Avatar, CalendarGrid, Callout } from '@firmivra/ui';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { api } from '../../../../../lib/api';
import { errorMessage } from '../../../../../lib/errors';
import { useApiMutation } from '../../../../../lib/query';
import { KebabMenu, type Notify, useAppointmentActions } from './ap-actions';
import { useAgenda } from './ap-data';
import { AP, addMonths, clock, dayRange, entryName, fromDate, toDate } from './ap-shared';

/** The small month: a pick changes the date every view shows. */
export function MiniMonth({
  day,
  today,
  onDay,
}: {
  day: string;
  today: string;
  onDay: (date: string) => void;
}) {
  return (
    <section aria-label="Mini calendar" className="rounded-xl bg-surface p-4 shadow-md">
      <CalendarGrid
        view="mini"
        date={toDate(day)}
        today={toDate(today)}
        selected={toDate(day)}
        onPrev={() => onDay(addMonths(day, -1))}
        onNext={() => onDay(addMonths(day, 1))}
        onDateClick={(date) => onDay(fromDate(date))}
      />
    </section>
  );
}

/** The selected day's schedule: a click on a row opens that appointment. */
export function TodaysAppointments({
  day,
  today,
  timeZone,
  notify,
}: {
  day: string;
  today: string;
  timeZone: string;
  notify: Notify;
}) {
  const router = useRouter();
  const { from, to } = dayRange(day, timeZone);
  const agenda = useAgenda({ from, to });
  const actions = useAppointmentActions(notify);
  const rows = agenda.entries;
  const title = day === today ? "Today's Appointments" : 'Appointments';
  return (
    <section
      aria-label={title}
      className="rounded-xl bg-surface p-4 shadow-md"
      data-testid="rail-today"
    >
      <header className="mb-2 flex items-baseline justify-between gap-2">
        <h2 className="text-base font-bold text-heading">{title}</h2>
        <Link href="/calendar/today" className="text-sm text-link underline">
          See All
        </Link>
      </header>
      {rows.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted" data-testid="rail-today-empty">
          {agenda.query.isPending
            ? 'Loading…'
            : agenda.query.isError
              ? 'Appointments are not available right now.'
              : 'No appointments on this day.'}
        </p>
      ) : (
        <ul className="flex flex-col">
          {rows.map((entry) =>
            entry.restricted ? (
              <li key={entry.id} className="flex items-center gap-3 py-2 text-sm text-muted">
                <span className="w-14 shrink-0 text-xs text-text">
                  {clock(entry.startsAt, timeZone)}
                </span>
                Busy
              </li>
            ) : (
              <li key={entry.id} className="flex items-center gap-3 py-2">
                <span className="w-14 shrink-0 text-xs text-text">
                  {clock(entry.startsAt, timeZone)}
                </span>
                <Link
                  href={`/calendar/${entry.id}`}
                  className="flex min-w-0 flex-1 items-center gap-3"
                >
                  <Avatar name={entryName(entry)} size="lg" />
                  <span className="flex min-w-0 flex-col">
                    <span className="truncate text-sm font-semibold text-heading">
                      {entryName(entry)}
                    </span>
                    <span className="truncate text-xs text-muted">
                      {entry.type?.name ?? entry.service?.name ?? ''}
                    </span>
                  </span>
                </Link>
                <KebabMenu
                  label={`Actions for ${entryName(entry)}`}
                  sections={[
                    {
                      items: [
                        {
                          label: 'View Details',
                          icon: Eye,
                          onSelect: () => router.push(`/calendar/${entry.id}`),
                        },
                        {
                          label: 'Edit',
                          icon: PencilSimple,
                          onSelect: () => router.push(`/calendar/${entry.id}/edit`),
                        },
                        {
                          label: 'Send Reminder',
                          icon: Envelope,
                          onSelect: () => actions.remind(entry.id),
                        },
                      ],
                    },
                  ]}
                />
              </li>
            ),
          )}
        </ul>
      )}
    </section>
  );
}

interface QuickAction {
  label: string;
  icon: Icon;
  href?: string;
  onClick?: () => void;
}

/** Quick Actions and the Pro Tip under it. */
export function QuickActions({ notify }: { notify: Notify }) {
  const [busy, setBusy] = useState(false);
  const remind = useApiMutation(() => api.scheduling.sendReminders({ withinDays: 7 }), {
    invalidate: AP,
  });
  const items: QuickAction[] = [
    { label: 'Schedule New Appointment', icon: CalendarPlus, href: '/calendar/new' },
    {
      label: 'Send Appointment Reminders',
      icon: Envelope,
      onClick: () => {
        setBusy(true);
        remind.mutate(undefined, {
          onSuccess: (r) =>
            notify(
              r.sent > 0
                ? `Reminders sent for ${r.sent} appointment${r.sent === 1 ? '' : 's'}.`
                : 'No reminders were sent: nothing upcoming has a reachable contact.',
              r.sent > 0 ? 'success' : 'error',
            ),
          onError: (e) => notify(errorMessage(e), 'error'),
          onSettled: () => setBusy(false),
        });
      },
    },
    { label: 'View Appointment Reports', icon: ChartLineUp, href: '/modules/reports' },
    {
      label: 'Sync Calendar (Google, Outlook, etc.)',
      icon: ArrowsClockwise,
      href: '/modules/integrations',
    },
    { label: 'Manage Appointment Types', icon: CalendarDots, href: '/calendar/types' },
  ];
  const row =
    'flex w-full items-center gap-4 rounded-md py-2 text-left text-sm text-heading hover:text-action';
  return (
    <>
      <section aria-label="Quick Actions" className="rounded-xl bg-surface p-4 shadow-md">
        <h2 className="mb-2 text-base font-bold text-heading">Quick Actions</h2>
        <ul>
          {items.map(({ label, icon: Glyph, href, onClick }) => (
            <li key={label}>
              {href ? (
                <Link href={href} className={row}>
                  <Glyph aria-hidden weight="fill" className="size-5 shrink-0 text-action" />
                  {label}
                </Link>
              ) : (
                <button type="button" onClick={onClick} disabled={busy} className={row}>
                  <Glyph aria-hidden weight="fill" className="size-5 shrink-0 text-action" />
                  {label}
                </button>
              )}
            </li>
          ))}
        </ul>
      </section>
      <Callout icon={Lightbulb} title="Pro Tip:" titleStyle="tip" surface="info">
        Send automated reminders to reduce no-shows and keep your schedule full.
      </Callout>
    </>
  );
}
