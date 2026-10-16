'use client';

import type { AgendaEntry } from '@firmivra/types';
import { Button, Callout, CalendarGrid, Modal, Skeleton } from '@firmivra/ui';
import {
  ArrowsClockwise,
  CalendarCheck,
  CalendarPlus,
  ChartLine,
  EnvelopeSimple,
  type Icon,
  Lightbulb,
  UsersThree,
} from '@phosphor-icons/react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { createElement, useState } from 'react';
import { api } from '../../../../../lib/api';
import { errorMessage } from '../../../../../lib/errors';
import { moduleHref } from '../../../../../lib/firm-modules';
import { useApiMutation, useApiQuery } from '../../../../../lib/query';
import { RowMenu, type RowMenuItem } from '../../team/_components/row-menu';
import { NOT_LOADED, SCHEDULING, initials } from './appointments-parts';
import { timeLabel, toInstant, todayIn } from './time';

/** A firm-local 'YYYY-MM-DD' as a Date at local midnight, for the kit's calendar. */
export const dayDate = (date: string) => {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(y ?? 2000, (m ?? 1) - 1, d ?? 1);
};

/** The kit calendar's Date back to 'YYYY-MM-DD'. */
export const dayString = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

const card = 'flex min-w-0 flex-col rounded-xl border border-divider bg-surface p-3 shadow-sm';

/**
 * The right column of every Appointments view (appointments.jpg): the small month with Today's
 * Appointments under it, Quick Actions (Send Appointment Reminders asks first) and the Pro Tip.
 * Picking a day shows it in the calendar: `onDate` on the Calendar view, else it opens the
 * Calendar view on that day.
 */
export function AppointmentsSide({
  date,
  onDate,
}: {
  date?: string;
  onDate?: (date: string) => void;
}) {
  const router = useRouter();
  const options = useApiQuery([...SCHEDULING, 'options'], () => api.scheduling.options());
  const tz = options.data?.timezone ?? 'America/New_York';
  const today = todayIn(tz);
  const query = {
    from: toInstant(today, '00:00', tz),
    to: toInstant(today, '23:59', tz),
    limit: 200,
  };
  const agenda = useApiQuery([...SCHEDULING, 'agenda', 'today', today], () =>
    api.scheduling.agenda(query),
  );
  const [month, setMonth] = useState(() => dayDate(date ?? today));
  const [asking, setAsking] = useState(false);
  const [message, setMessage] = useState('');
  const items = agenda.data?.items ?? [];

  const menu = (a: AgendaEntry): RowMenuItem[] => [
    { label: 'View Details', onSelect: () => router.push(`/calendar/${a.id}`) },
    { label: 'Edit', onSelect: () => router.push(`/calendar/${a.id}/edit`) },
    ...(!a.restricted && a.videoUrl
      ? [
          {
            label: 'Join Meeting',
            onSelect: () => window.open(a.videoUrl ?? '', '_blank', 'noopener'),
          },
        ]
      : []),
  ];

  const quick: [string, Icon, string | (() => void)][] = [
    ['Schedule New Appointment', CalendarPlus, '/calendar/new'],
    ['Send Appointment Reminders', EnvelopeSimple, () => setAsking(true)],
    ['View Appointment Reports', ChartLine, moduleHref('reports')],
    ['Sync Calendar (Google, Outlook, etc.)', ArrowsClockwise, moduleHref('integrations')],
    ['Manage Appointment Types', CalendarCheck, '/calendar/types'],
  ];

  return (
    <aside className="grid min-w-0 grid-cols-1 items-start gap-4 md:grid-cols-2 min-[1280px]:grid-cols-1">
      <section aria-label="Calendar and today" data-testid="appointments-mini" className={card}>
        <CalendarGrid
          view="mini"
          date={month}
          today={dayDate(today)}
          selected={date ? dayDate(date) : undefined}
          onPrev={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))}
          onNext={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))}
          onDateClick={(d) =>
            onDate ? onDate(dayString(d)) : router.push(`/calendar?date=${dayString(d)}`)
          }
        />
        <div
          data-testid="todays-appointments"
          className="mt-3 flex flex-col border-t border-divider pt-3"
        >
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-base font-bold text-heading">Today&apos;s Appointments</h2>
            <Link href="/calendar/today" className="text-sm text-link underline">
              See All
            </Link>
          </div>
          {agenda.isPending ? (
            <Skeleton className="mt-2 h-40" />
          ) : agenda.isError ? (
            <p className="mt-2 rounded-lg bg-subtle p-4 text-sm text-muted">{NOT_LOADED}</p>
          ) : items.length ? (
            <ul className="flex flex-col divide-y divide-divider">
              {items.slice(0, 4).map((a) => (
                <li key={a.id} className="flex items-center gap-2 py-2">
                  <span className="w-16 shrink-0 text-sm text-heading">
                    {timeLabel(a.startsAt, tz)}
                  </span>
                  <span
                    aria-hidden
                    className="flex size-9 shrink-0 items-center justify-center rounded-full bg-purple-soft text-sm font-bold text-purple"
                  >
                    {a.restricted ? (
                      '—'
                    ) : a.internal ? (
                      <UsersThree weight="fill" className="size-5" />
                    ) : (
                      initials(a.contact.name)
                    )}
                  </span>
                  <Link href={`/calendar/${a.id}`} className="min-w-0 flex-1 hover:underline">
                    <span className="block truncate text-sm font-semibold text-heading">
                      {a.restricted ? 'Busy' : a.internal ? 'Team Meeting' : a.contact.name}
                    </span>
                    <span className="block truncate text-sm text-link">
                      {a.restricted
                        ? a.staff.map((s) => s.name).join(', ')
                        : (a.type?.name ?? a.service?.name ?? '')}
                    </span>
                  </Link>
                  {a.restricted ? null : (
                    <RowMenu
                      vertical
                      label={`Actions for ${a.internal ? 'Team Meeting' : a.contact.name}`}
                      items={menu(a)}
                    />
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 rounded-lg bg-subtle p-4 text-sm text-muted">
              Nothing is booked today.
            </p>
          )}
        </div>
      </section>

      <div className="flex min-w-0 flex-col gap-4">
        <section
          aria-label="Quick Actions"
          data-testid="appointment-quick-actions"
          className={`${card} gap-1`}
        >
          <h2 className="mb-1 text-lg font-bold text-heading">Quick Actions</h2>
          {quick.map(([label, icon, go]) => {
            const body = (
              <>
                {createElement(icon, {
                  'aria-hidden': true,
                  weight: 'fill',
                  className: 'size-5 shrink-0 text-action',
                })}
                {label}
              </>
            );
            const cls =
              'flex min-h-9 items-center gap-3 rounded-lg px-1 text-left text-sm text-heading hover:bg-canvas';
            return typeof go === 'string' ? (
              <Link key={label} href={go} className={cls}>
                {body}
              </Link>
            ) : (
              <button key={label} type="button" onClick={go} className={cls}>
                {body}
              </button>
            );
          })}
          {message ? (
            <p role="status" data-testid="reminders-result" className="text-sm text-success">
              {message}
            </p>
          ) : null}
        </section>

        <Callout icon={Lightbulb} tone="blue" surface="info" titleStyle="tip" title="Pro Tip:">
          Send automated reminders to reduce no-shows and keep your schedule full.
        </Callout>
      </div>

      {asking ? (
        <RemindersModal
          onClose={() => setAsking(false)}
          onDone={(text) => {
            setAsking(false);
            setMessage(text);
          }}
        />
      ) : null}
    </aside>
  );
}

/** Send Appointment Reminders: every upcoming appointment of the next day, after asking. */
function RemindersModal({
  onClose,
  onDone,
}: {
  onClose: () => void;
  onDone: (text: string) => void;
}) {
  const send = useApiMutation(() => api.scheduling.sendReminders({ withinDays: 1 }), {
    invalidate: SCHEDULING,
  });
  return (
    <Modal open title="Send Appointment Reminders" onClose={onClose}>
      <div className="flex flex-col gap-4">
        <p className="text-sm text-text">
          Clients with an appointment in the next 24 hours get a reminder now, by the channels each
          appointment uses. Nothing about the schedule changes.
        </p>
        {send.error ? (
          <p role="alert" className="text-sm text-danger">
            {errorMessage(send.error)}
          </p>
        ) : null}
        <div className="flex justify-end gap-3">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={send.isPending}
            onClick={() =>
              send.mutate(undefined, {
                onSuccess: (r) =>
                  onDone(
                    `${r.sent} reminder${r.sent === 1 ? '' : 's'} sent${r.skipped ? `, ${r.skipped} could not be sent` : ''}.`,
                  ),
              })
            }
          >
            Send Reminders
          </Button>
        </div>
      </div>
    </Modal>
  );
}
