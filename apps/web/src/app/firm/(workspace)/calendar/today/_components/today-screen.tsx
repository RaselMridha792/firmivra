'use client';

import type { AgendaEntry } from '@firmivra/types';
import { Badge, Skeleton } from '@firmivra/ui';
import Link from 'next/link';
import { api } from '../../../../../../lib/api';
import { useApiQuery } from '../../../../../../lib/query';
import {
  AppointmentsHeader,
  AppointmentsToolbar,
  NOT_LOADED,
  SCHEDULING,
  STATUS_LOOKS,
  SummaryCards,
  placeOf,
} from '../../_components/appointments-parts';
import { AppointmentsSide } from '../../_components/appointments-side';
import { localParts, todayIn, toInstant } from '../../_components/time';

/** The day's rows, 8 AM to 6 PM, as the design's calendar; earlier or later ones go first or last. */
const HOURS = Array.from({ length: 11 }, (_, i) => 8 + i);

const hourLabel = (h: number) => `${((h + 11) % 12) + 1}:00 ${h < 12 ? 'AM' : 'PM'}`;

const card =
  'flex min-w-0 flex-col gap-3 rounded-xl border border-divider bg-surface p-4 shadow-sm';

/**
 * Appointments > Today (appointments.jpg Today view; guide §2, §10): the Appointments frame (KPI
 * cards, the view switch, New Appointment and the right column), with today's schedule hour by
 * hour (`api.scheduling.agenda` for the firm's today).
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
    <div className="flex min-w-0 flex-col gap-5">
      <AppointmentsHeader />
      <SummaryCards />
      <AppointmentsToolbar current="today" />
      <div className="grid grid-cols-1 items-start gap-4 min-[1280px]:grid-cols-[1fr_18rem]">
        <section aria-labelledby="today-schedule" data-testid="today-schedule" className={card}>
          <h2 id="today-schedule" className="text-lg font-bold text-heading">
            {longDay}
          </h2>
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

        <AppointmentsSide />
      </div>
    </div>
  );
}
