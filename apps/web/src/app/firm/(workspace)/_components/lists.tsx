'use client';

import {
  type Appointment,
  appointmentWith,
  type DashboardSummary,
  type MessageThreadList,
  roleCan,
} from '@firmivra/types';
import { Button, Modal } from '@firmivra/ui';
import { MapPin, Phone, VideoCamera } from '@phosphor-icons/react';
import type { UseQueryResult } from '@tanstack/react-query';
import { DashboardLink as Link, useDashboardNavigate } from './dashboard-link';
import { useState } from 'react';
import { useFirm } from '../../../../components/firm-context';
import { api } from '../../../../lib/api';
import { errorMessage } from '../../../../lib/errors';
import { useApiMutation } from '../../../../lib/query';
import { type Ask, CloseModal } from '../calendar/[id]/_components/detail-screen';
import { LOCATION_LABELS } from '../calendar/_components/shared';
import { RowMenu, type RowMenuItem } from '../team/_components/row-menu';
import { addDays } from '../calendar/_components/time';
import { rowActions } from './appointment-actions';
import { Widget } from './widget';

const ICONS = { VIDEO: VideoCamera, PHONE: Phone, IN_PERSON: MapPin } as const;
const BARS = { VIDEO: 'bg-info', PHONE: 'bg-success', IN_PERSON: 'bg-gold' } as const;
const initials = (name: string) =>
  name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('');

/** `inbox`: started by the dashboard with the page (V8); shown once the time zone is known. */
export function RecentMessages({
  timeZone,
  today,
  inbox,
}: {
  timeZone: string;
  today: string;
  inbox: UseQueryResult<MessageThreadList>;
}) {
  const day = new Intl.DateTimeFormat('en-CA', { timeZone });
  const time = new Intl.DateTimeFormat('en-US', { timeZone, hour: 'numeric', minute: '2-digit' });
  const date = new Intl.DateTimeFormat('en-US', { timeZone, month: 'short', day: 'numeric' });
  const when = (at: Date) => (day.format(at) === today ? time : date).format(at);
  return (
    <Widget
      title="Recent Messages"
      query={inbox}
      link={{ href: '/messages', label: 'View All' }}
      isEmpty={(d) => d.items.length === 0}
      empty="No messages yet"
    >
      {(d) => (
        <ul className="flex flex-col">
          {d.items.map((t) => (
            <li key={t.id}>
              <Link
                href={`/clients/${encodeURIComponent(t.client.id)}/messages`}
                className="flex items-center gap-3 rounded-control py-2 hover:bg-canvas"
              >
                <span
                  aria-hidden
                  className="flex size-10 shrink-0 items-center justify-center rounded-full bg-purple-soft font-bold text-purple"
                >
                  {initials(t.client.displayName)}
                </span>
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-sm font-semibold text-heading">
                    {t.client.displayName}
                  </span>
                  <span className="truncate text-xs text-muted">
                    {t.lastMessage?.excerpt ?? t.subject}
                  </span>
                </span>
                <span className="flex shrink-0 flex-col items-end gap-1 text-xs text-muted">
                  {when(new Date(t.lastMessage?.createdAt ?? t.createdAt))}
                  {t.unreadCount ? (
                    <span className="flex size-5 items-center justify-center rounded-full bg-danger text-on-action">
                      {t.unreadCount}
                      <span className="sr-only"> unread</span>
                    </span>
                  ) : null}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Widget>
  );
}

export function TasksDue({ summary }: { summary: UseQueryResult<DashboardSummary> }) {
  const { role } = useFirm();
  const canComplete = role ? roleCan(role, 'TASKS', 'EDIT') : false;
  const canOpenClient = role ? roleCan(role, 'CLIENTS', 'VIEW') : false;
  // A checkbox before each task marks it done, as the design draws the list (R1, Oct 20), after
  // asking (Octavia's T5): Cancel changes nothing; Complete marks it done once.
  const [asking, setAsking] = useState<{ id: string; title: string }>();
  const done = useApiMutation((id: string) => api.tasks.update(id, { status: 'DONE' }), {
    invalidate: ['dashboard'],
  });
  const label = (dueOn: string, today: string) =>
    dueOn < today
      ? 'Overdue'
      : dueOn === today
        ? 'Due Today'
        : dueOn === addDays(today, 1)
          ? 'Due Tomorrow'
          : `Due ${new Date(`${dueOn}T12:00:00Z`).toLocaleDateString('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric' })}`;
  return (
    <Widget
      title="Tasks Due"
      query={summary}
      // T2 (Review 2): the same tasks as the widget, every open one with a due date, soonest first.
      link={{ href: '/tasks?view=all&due=set', label: 'View All' }}
      isEmpty={(d) => !d.tasksDue?.length}
      denied={(d) => (d.tasksDue ? undefined : 'Tasks')}
      empty="No tasks due"
    >
      {({ tasksDue = [], today }) => (
        <>
          <ul className="flex flex-col divide-y divide-border">
            {done.isError ? (
              <li role="alert" className="py-2 text-sm text-danger">
                The task could not be marked complete: {errorMessage(done.error)} It is unchanged;
                try again.
              </li>
            ) : null}
            {tasksDue.map((t) => (
              <li key={t.id} className="flex items-center gap-3">
                {canComplete ? (
                  <input
                    type="checkbox"
                    aria-label={`Mark ${t.title} complete`}
                    checked={done.isPending && done.variables === t.id}
                    disabled={done.isPending}
                    onChange={() => setAsking({ id: t.id, title: t.title })}
                    className="size-4 shrink-0 cursor-pointer accent-action"
                  />
                ) : null}
                {/* The title opens the task itself (T4); the client is its own link. */}
                <span className="flex min-w-0 flex-1 items-center gap-1 py-3 text-sm text-text">
                  <Link
                    href={`/tasks/${encodeURIComponent(t.id)}`}
                    data-testid="task-title"
                    className="min-w-0 truncate rounded-control hover:underline"
                  >
                    {t.title}
                  </Link>
                  <span aria-hidden className="shrink-0 text-muted">
                    –
                  </span>
                  {canOpenClient ? (
                    <Link
                      href={`/clients/${encodeURIComponent(t.client.id)}`}
                      aria-label={`Open client ${t.client.displayName}`}
                      className="min-w-0 truncate text-link hover:underline"
                    >
                      {t.client.displayName}
                    </Link>
                  ) : (
                    <span className="min-w-0 truncate">{t.client.displayName}</span>
                  )}
                </span>
                <span
                  className={`shrink-0 text-xs ${t.dueOn <= today ? 'font-semibold text-danger' : 'text-muted'}`}
                >
                  {label(t.dueOn, today)}
                </span>
              </li>
            ))}
          </ul>
          {asking ? (
            <Modal open title="Mark this task complete?" onClose={() => setAsking(undefined)}>
              <div className="flex flex-col gap-4">
                <p className="text-sm text-text">
                  &ldquo;{asking.title}&rdquo; moves to Done and leaves Tasks Due. It is not
                  deleted.
                </p>
                <div className="flex justify-end gap-3">
                  <Button variant="secondary" onClick={() => setAsking(undefined)}>
                    Cancel
                  </Button>
                  <Button
                    onClick={() => {
                      done.mutate(asking.id);
                      setAsking(undefined);
                    }}
                  >
                    Mark Complete
                  </Button>
                </div>
              </div>
            </Modal>
          ) : null}
        </>
      )}
    </Widget>
  );
}

/** A video link the meeting icon may open: https only. */
const meetingLink = (a: Appointment) =>
  a.locationKind === 'VIDEO' && a.locationDetails && /^https:\/\/\S+$/.test(a.locationDetails)
    ? a.locationDetails
    : null;

/** `list`: the next two weeks, started by the dashboard with the page (V8). */
export function UpcomingAppointments({
  timeZone,
  list,
}: {
  timeZone: string;
  today: string;
  list: UseQueryResult<Awaited<ReturnType<typeof api.appointments.list>>>;
}) {
  const go = useDashboardNavigate();
  const { role } = useFirm();
  const [ask, setAsk] = useState<{ ask: Ask; a: Appointment }>();
  const [message, setMessage] = useState<string>();
  const remind = useApiMutation((id: string) => api.scheduling.sendReminder(id), {
    invalidate: ['dashboard'],
  });
  const part = (options: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat('en-US', { timeZone, ...options });
  const [month, day, time] = [
    part({ month: 'short' }),
    part({ day: 'numeric' }),
    part({ hour: 'numeric', minute: '2-digit' }),
  ];
  // Octavia's A3: the actions the member may take, through the calendar's own pages and calls.
  // Octavia's A3: the actions the member may take (appointment-actions.ts), through the calendar's
  // own pages and calls.
  const menu = (a: Appointment): RowMenuItem[] =>
    rowActions(role, a).map((action): RowMenuItem => {
      switch (action) {
        case 'view':
          return { label: 'View Details', onSelect: () => go(`/calendar/${a.id}`) };
        case 'edit':
          return { label: 'Edit', onSelect: () => go(`/calendar/${a.id}/edit`) };
        case 'reschedule':
          return { label: 'Reschedule', onSelect: () => go(`/calendar/${a.id}/edit`) };
        case 'remind':
          return {
            label: 'Send Reminder',
            onSelect: () =>
              remind.mutate(a.id, {
                onSuccess: (r) =>
                  setMessage(r.sent ? 'A reminder was sent.' : 'No reminder could be sent.'),
                onError: (e) => setMessage(`The reminder was not sent: ${errorMessage(e)}`),
              }),
          };
        case 'complete':
          return { label: 'Mark Complete', onSelect: () => setAsk({ ask: 'complete', a }) };
        case 'cancel':
          return { label: 'Cancel', danger: true, onSelect: () => setAsk({ ask: 'cancel', a }) };
        case 'client':
          return { label: 'Open Client', onSelect: () => go(`/clients/${a.client?.id ?? ''}`) };
        case 'lead':
          return { label: 'Open Lead', onSelect: () => go(`/leads/${a.lead?.id ?? ''}`) };
      }
    });
  return (
    <Widget
      title="Upcoming Appointments"
      navy
      query={list}
      link={{ href: '/calendar', label: 'View All' }}
      isEmpty={(d) => !d.some((a) => !a.restricted && a.status === 'SCHEDULED')}
      empty="No upcoming appointments"
    >
      {(items) => (
        <>
          {message ? (
            <p role="status" className="py-1 text-sm text-text">
              {message}
            </p>
          ) : null}
          {/* The next two weeks, scrolling inside the panel (A4); the keyboard reaches it too. */}
          <ul
            tabIndex={0}
            aria-label="Upcoming appointments, next two weeks"
            data-testid="upcoming-list"
            className="flex max-h-72 flex-col divide-y divide-border overflow-y-auto pr-1"
          >
            {items
              .flatMap((a) => (!a.restricted && a.status === 'SCHEDULED' ? [a] : []))
              .sort((a, b) => a.startsAt.localeCompare(b.startsAt))
              .map((a) => {
                const Icon = ICONS[a.locationKind];
                const at = new Date(a.startsAt);
                const join = meetingLink(a);
                const what = `${a.type?.name ?? 'Appointment'} with ${appointmentWith(a)}`;
                return (
                  <li key={a.id} data-testid="upcoming-row" className="flex items-center gap-2">
                    <Link
                      href={`/calendar/${a.id}`}
                      className="flex min-w-0 flex-1 items-center gap-3 py-2 hover:bg-canvas"
                    >
                      <span className="flex w-10 shrink-0 flex-col items-center font-bold leading-tight text-heading">
                        <span className="text-xs uppercase">{month.format(at)}</span>
                        <span className="text-xl">{day.format(at)}</span>
                      </span>
                      <span
                        aria-hidden
                        className={`h-10 w-1.5 shrink-0 rounded-pill ${BARS[a.locationKind]}`}
                      />
                      <span className="w-16 shrink-0 text-sm text-muted">{time.format(at)}</span>
                      <span className="flex min-w-0 flex-1 flex-col">
                        <span className="truncate text-sm text-heading">
                          {a.type?.name ?? 'Appointment'}
                        </span>
                        <span className="truncate text-xs text-muted">
                          {appointmentWith(a)} · {LOCATION_LABELS[a.locationKind]}
                        </span>
                      </span>
                    </Link>
                    {join ? (
                      <a
                        href={join}
                        target="_blank"
                        rel="noopener noreferrer"
                        aria-label={`Join the video meeting: ${what}`}
                        className="shrink-0 rounded-control p-1 text-link hover:bg-canvas"
                      >
                        <Icon aria-hidden weight="fill" className="size-6" />
                      </a>
                    ) : (
                      <Icon aria-hidden weight="fill" className="size-6 shrink-0 text-link" />
                    )}
                    <RowMenu vertical fixed label={`Actions for ${what}`} items={menu(a)} />
                  </li>
                );
              })}
          </ul>
          {ask ? (
            <CloseModal
              id={ask.a.id}
              ask={ask.ask}
              name={appointmentWith(ask.a)}
              onClose={() => setAsk(undefined)}
              onDone={(text) => {
                setAsk(undefined);
                setMessage(text);
                void list.refetch();
              }}
            />
          ) : null}
        </>
      )}
    </Widget>
  );
}
