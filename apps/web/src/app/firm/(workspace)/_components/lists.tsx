'use client';

import { Badge } from '@firmivra/ui';
import { MapPin, Phone, Video } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { api } from '../../../../lib/api';
import { useApiQuery } from '../../../../lib/query';
import { LOCATION_LABELS } from '../calendar/_components/shared';
import { addDays, toInstant } from '../calendar/_components/time';
import { Widget } from './widget';

const ICONS = { VIDEO: Video, PHONE: Phone, IN_PERSON: MapPin } as const;

export function RecentMessages({ timeZone }: { timeZone: string }) {
  const inbox = useApiQuery(['dashboard', 'messages'], () => api.messages.inbox({ limit: 5 }));
  const when = new Intl.DateTimeFormat('en-US', {
    timeZone,
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
  return (
    <Widget
      title="Recent Messages"
      query={inbox}
      link={{ href: '/messages', label: 'View all' }}
      isEmpty={(d) => d.items.length === 0}
      empty="No messages yet. Messages with your clients appear here."
    >
      {(d) => (
        <ul className="flex flex-col divide-y divide-border">
          {d.items.map((t) => (
            <li key={t.id}>
              <Link
                href={`/clients/${encodeURIComponent(t.client.id)}/messages`}
                className="flex items-start gap-3 rounded-control py-2 hover:bg-canvas"
              >
                <span className="flex min-w-0 flex-1 flex-col">
                  <span
                    className={`truncate text-sm text-heading ${t.unreadCount ? 'font-semibold' : ''}`}
                  >
                    {t.client.displayName}
                  </span>
                  <span className="truncate text-xs text-muted">
                    {t.lastMessage?.excerpt ?? t.subject}
                  </span>
                </span>
                <span className="flex shrink-0 flex-col items-end gap-1 text-xs text-muted">
                  {when.format(new Date(t.lastMessage?.createdAt ?? t.createdAt))}
                  {t.unreadCount ? (
                    <Badge tone="info">
                      {t.unreadCount}
                      <span className="sr-only"> unread</span>
                    </Badge>
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

export function UpcomingAppointments({ timeZone, today }: { timeZone: string; today: string }) {
  const [now] = useState(() => new Date().toISOString());
  const list = useApiQuery(['dashboard', 'upcoming', today], () =>
    api.appointments.list({ from: now, to: toInstant(addDays(today, 14), '00:00', timeZone) }),
  );
  const day = new Intl.DateTimeFormat('en-US', { timeZone, month: 'short', day: 'numeric' });
  const time = new Intl.DateTimeFormat('en-US', { timeZone, hour: 'numeric', minute: '2-digit' });
  return (
    <Widget
      title="Upcoming Appointments"
      query={list}
      link={{ href: '/calendar', label: 'View calendar' }}
      isEmpty={(d) => !d.some((a) => !a.restricted && a.status === 'SCHEDULED')}
      empty="No appointments in the next two weeks. Open the calendar to book one."
      className="xl:col-span-2"
    >
      {(items) => (
        <ul className="flex flex-col divide-y divide-border">
          {items
            .flatMap((a) => (!a.restricted && a.status === 'SCHEDULED' ? [a] : []))
            .sort((a, b) => a.startsAt.localeCompare(b.startsAt))
            .slice(0, 5)
            .map((a) => {
              const Icon = ICONS[a.locationKind];
              return (
                <li key={a.id}>
                  <Link
                    href="/calendar"
                    className="flex items-center gap-3 rounded-control py-2 hover:bg-canvas"
                  >
                    <span className="w-16 shrink-0 text-sm font-semibold text-heading">
                      {day.format(new Date(a.startsAt))}
                    </span>
                    <span className="w-20 shrink-0 text-sm text-muted">
                      {time.format(new Date(a.startsAt))}
                    </span>
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate text-sm text-heading">{a.client.displayName}</span>
                      <span className="truncate text-xs text-muted">
                        {a.type?.name ?? 'Appointment'} · {LOCATION_LABELS[a.locationKind]}
                      </span>
                    </span>
                    <Icon aria-hidden className="size-5 shrink-0 text-link" />
                  </Link>
                </li>
              );
            })}
        </ul>
      )}
    </Widget>
  );
}
