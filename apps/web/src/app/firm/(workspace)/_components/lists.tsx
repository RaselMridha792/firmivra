'use client';

import type { DashboardSummary } from '@firmivra/types';
import { MapPin, Phone, VideoCamera } from '@phosphor-icons/react';
import type { UseQueryResult } from '@tanstack/react-query';
import Link from 'next/link';
import { useState } from 'react';
import { api } from '../../../../lib/api';
import { moduleHref } from '../../../../lib/firm-modules';
import { errorMessage } from '../../../../lib/errors';
import { useApiMutation, useApiQuery } from '../../../../lib/query';
import { LOCATION_LABELS } from '../calendar/_components/shared';
import { addDays, toInstant } from '../calendar/_components/time';
import { Widget } from './widget';

const ICONS = { VIDEO: VideoCamera, PHONE: Phone, IN_PERSON: MapPin } as const;
const BARS = { VIDEO: 'bg-info', PHONE: 'bg-success', IN_PERSON: 'bg-gold' } as const;
const initials = (name: string) =>
  name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('');

export function RecentMessages({ timeZone, today }: { timeZone: string; today: string }) {
  const inbox = useApiQuery(['dashboard', 'messages'], () => api.messages.inbox({ limit: 5 }));
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
  // A checkbox before each task marks it done, as the design draws the list (R1, Oct 20).
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
      link={{ href: moduleHref('tasks'), label: 'View All' }}
      isEmpty={(d) => d.tasksDue.length === 0}
      empty="No tasks due"
    >
      {({ tasksDue, today }) => (
        <ul className="flex flex-col divide-y divide-border">
          {done.isError ? (
            <li role="alert" className="py-2 text-sm text-danger">
              {errorMessage(done.error)}
            </li>
          ) : null}
          {tasksDue.map((t) => (
            <li key={t.id} className="flex items-center gap-3">
              <input
                type="checkbox"
                aria-label={`Mark ${t.title} done`}
                checked={done.isPending && done.variables === t.id}
                disabled={done.isPending}
                onChange={() => done.mutate(t.id)}
                className="size-4 shrink-0 cursor-pointer accent-action"
              />
              <Link
                href={`/clients/${encodeURIComponent(t.client.id)}`}
                className="flex min-w-0 flex-1 items-center gap-3 rounded-control py-3 hover:bg-canvas"
              >
                <span className="min-w-0 flex-1 truncate text-sm text-text">
                  {t.title} – {t.client.displayName}
                </span>
                <span
                  className={`shrink-0 text-xs ${t.dueOn <= today ? 'font-semibold text-danger' : 'text-muted'}`}
                >
                  {label(t.dueOn, today)}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Widget>
  );
}

export function UpcomingAppointments({ timeZone, today }: { timeZone: string; today: string }) {
  const [now] = useState(() => new Date().toISOString());
  const list = useApiQuery(['dashboard', 'upcoming', today], () =>
    api.appointments.list({ from: now, to: toInstant(addDays(today, 14), '00:00', timeZone) }),
  );
  const part = (options: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat('en-US', { timeZone, ...options });
  const [month, day, time] = [
    part({ month: 'short' }),
    part({ day: 'numeric' }),
    part({ hour: 'numeric', minute: '2-digit' }),
  ];
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
        <ul className="flex flex-col divide-y divide-border">
          {items
            .flatMap((a) => (!a.restricted && a.status === 'SCHEDULED' ? [a] : []))
            .sort((a, b) => a.startsAt.localeCompare(b.startsAt))
            .slice(0, 4)
            .map((a) => {
              const Icon = ICONS[a.locationKind];
              const at = new Date(a.startsAt);
              return (
                <li key={a.id}>
                  <Link href="/calendar" className="flex items-center gap-3 py-2 hover:bg-canvas">
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
                        {a.client.displayName} · {LOCATION_LABELS[a.locationKind]}
                      </span>
                    </span>
                    <Icon aria-hidden weight="fill" className="size-6 shrink-0 text-link" />
                  </Link>
                </li>
              );
            })}
        </ul>
      )}
    </Widget>
  );
}
