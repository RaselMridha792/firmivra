'use client';

import type { AgendaEntry } from '@firmivra/types';
import { Badge, Button, Callout, Modal, Skeleton } from '@firmivra/ui';
import {
  ArrowsClockwise,
  CalendarPlus,
  ChartLine,
  EnvelopeSimple,
  type Icon,
  Lightbulb,
  ListChecks,
} from '@phosphor-icons/react';
import Link from 'next/link';
import { createElement, useState } from 'react';
import { api } from '../../../../../../lib/api';
import { errorMessage } from '../../../../../../lib/errors';
import { moduleHref } from '../../../../../../lib/firm-modules';
import { useApiMutation, useApiQuery } from '../../../../../../lib/query';
import {
  AppointmentsHeader,
  NOT_LOADED,
  SCHEDULING,
  STATUS_LOOKS,
  SummaryCards,
  ViewSwitch,
  initials,
  placeOf,
} from '../../_components/appointments-parts';
import { localParts, todayIn, toInstant } from '../../_components/time';

/** The day's rows, 8 AM to 6 PM, as the design's calendar; earlier or later ones go first or last. */
const HOURS = Array.from({ length: 11 }, (_, i) => 8 + i);

const hourLabel = (h: number) => `${((h + 11) % 12) + 1}:00 ${h < 12 ? 'AM' : 'PM'}`;

const card =
  'flex min-w-0 flex-col gap-3 rounded-xl border border-divider bg-surface p-4 shadow-sm';

/**
 * Appointments > Today (appointments.jpg Today view, Today's Appointments, Quick Actions and Pro
 * Tip; guide §2, §10): the KPI cards, the view switch, today's schedule hour by hour
 * (`api.scheduling.agenda` for the firm's today), Today's Appointments, Quick Actions (Send
 * Appointment Reminders asks first) and the Pro Tip.
 */
export function TodayScreen() {
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
  const [asking, setAsking] = useState(false);
  const [message, setMessage] = useState('');
  const items = agenda.data?.items ?? [];
  const hourOf = (a: AgendaEntry) => Number(localParts(a.startsAt, tz).time.slice(0, 2));
  const timeOf = (iso: string) =>
    new Date(iso).toLocaleTimeString('en-US', { timeZone: tz, hour: 'numeric', minute: '2-digit' });
  const longDay = new Date(`${today}T12:00:00Z`).toLocaleDateString('en-US', {
    timeZone: 'UTC',
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });

  const quick: [string, Icon, string | (() => void)][] = [
    ['Schedule New Appointment', CalendarPlus, '/calendar/new'],
    ['Send Appointment Reminders', EnvelopeSimple, () => setAsking(true)],
    ['View Appointment Reports', ChartLine, moduleHref('reports')],
    ['Sync Calendar (Google, Outlook, etc.)', ArrowsClockwise, moduleHref('integrations')],
    ['Manage Appointment Types', ListChecks, '/calendar/types'],
  ];

  const entry = (a: AgendaEntry) =>
    a.restricted ? (
      <div className="rounded-lg border border-divider bg-subtle px-3 py-2 text-sm text-muted">
        {timeOf(a.startsAt)} – {timeOf(a.endsAt)} · Busy ({a.staff.map((s) => s.name).join(', ')})
      </div>
    ) : (
      <Link
        href={`/calendar/${a.id}`}
        className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border-l-4 border-action bg-info-soft px-3 py-2 text-sm hover:underline"
      >
        <span className="font-semibold text-heading">
          {a.internal ? 'Team Meeting' : a.contact.name}
        </span>
        <span className="text-link">{a.type?.name ?? a.service?.name ?? ''}</span>
        <span className="text-muted">
          {timeOf(a.startsAt)} – {timeOf(a.endsAt)} · {placeOf(a)} ·{' '}
          {a.staff.map((s) => s.name).join(', ')}
        </span>
        <span className="ml-auto">
          <Badge tone={STATUS_LOOKS[a.status].tone}>{STATUS_LOOKS[a.status].label}</Badge>
        </span>
      </Link>
    );

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <AppointmentsHeader />
      <SummaryCards />
      <div className="grid grid-cols-1 items-start gap-4 min-[1440px]:grid-cols-[1fr_22rem]">
        <section aria-labelledby="today-schedule" data-testid="today-schedule" className={card}>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <ViewSwitch current="today" />
            <h2 id="today-schedule" className="text-lg font-bold text-heading">
              {longDay}
            </h2>
          </div>
          {agenda.isPending ? (
            <Skeleton className="h-96" />
          ) : agenda.isError ? (
            <p className="rounded-lg bg-subtle p-4 text-sm text-muted">{NOT_LOADED}</p>
          ) : (
            <ol className="flex flex-col divide-y divide-divider">
              {HOURS.map((h) => {
                const here = items.filter(
                  (a) =>
                    hourOf(a) === h ||
                    (h === HOURS[0] && hourOf(a) < h) ||
                    (h === HOURS.at(-1) && hourOf(a) > h),
                );
                return (
                  <li key={h} className="grid grid-cols-[5rem_1fr] gap-3 py-2">
                    <span className="pt-2 text-xs text-muted">{hourLabel(h)}</span>
                    <div className="flex min-h-10 flex-col gap-2">
                      {here.map((a) => (
                        <div key={a.id}>{entry(a)}</div>
                      ))}
                    </div>
                  </li>
                );
              })}
            </ol>
          )}
          {agenda.data && !items.length ? (
            <p className="text-sm text-muted">Nothing is booked today.</p>
          ) : null}
        </section>

        <aside className="grid min-w-0 grid-cols-1 items-start gap-4 lg:grid-cols-2 min-[1440px]:grid-cols-1">
          <section
            aria-label="Today's Appointments"
            data-testid="todays-appointments"
            className={card}
          >
            <h2 className="text-lg font-bold text-heading">Today&apos;s Appointments</h2>
            {agenda.isPending ? (
              <Skeleton className="h-40" />
            ) : agenda.isError ? (
              <p className="rounded-lg bg-subtle p-4 text-sm text-muted">{NOT_LOADED}</p>
            ) : items.length ? (
              <ul className="flex flex-col divide-y divide-divider">
                {items.map((a) => (
                  <li key={a.id} className="flex items-center gap-3 py-2">
                    <span className="w-16 shrink-0 text-xs text-muted">{timeOf(a.startsAt)}</span>
                    <span
                      aria-hidden
                      className="flex size-9 shrink-0 items-center justify-center rounded-full bg-purple-soft text-xs font-bold text-purple"
                    >
                      {a.restricted ? '—' : a.internal ? 'TM' : initials(a.contact.name)}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold text-heading">
                        {a.restricted ? 'Busy' : a.internal ? 'Team Meeting' : a.contact.name}
                      </span>
                      <span className="block truncate text-xs text-link">
                        {a.restricted
                          ? a.staff.map((s) => s.name).join(', ')
                          : (a.type?.name ?? '')}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="rounded-lg bg-subtle p-4 text-sm text-muted">
                Nothing is booked today.
              </p>
            )}
          </section>

          <section
            aria-label="Quick Actions"
            data-testid="appointment-quick-actions"
            className={card}
          >
            <h2 className="text-lg font-bold text-heading">Quick Actions</h2>
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
                'flex min-h-10 items-center gap-3 rounded-lg px-1 text-left text-sm text-heading hover:bg-canvas';
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

          <Callout icon={Lightbulb} tone="blue" surface="info" title="Pro Tip:">
            Send automated reminders to reduce no-shows and keep your schedule full.
          </Callout>
        </aside>
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
    </div>
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
