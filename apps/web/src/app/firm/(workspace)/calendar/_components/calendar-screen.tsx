'use client';

import type { AgendaEntry, AppointmentDisplayStatus } from '@firmivra/types';
import { CalendarGrid, type CalendarEvent, type CalendarTone, Select, Table } from '@firmivra/ui';
import { CaretLeft, CaretRight } from '@phosphor-icons/react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { api } from '../../../../../lib/api';
import { useApiQuery } from '../../../../../lib/query';
import type { RowMenuItem } from '../../team/_components/row-menu';
import { AgendaActions, agendaColumns } from './agenda-table';
import {
  AppointmentsHeader,
  AppointmentsToolbar,
  NOT_LOADED,
  SCHEDULING,
  STATUS_LOOKS,
  SummaryCards,
} from './appointments-parts';
import { AppointmentsSide, dayDate, dayString } from './appointments-side';
import { addDays, isCalendarDate, localParts, toInstant, todayIn, weekdayOf } from './time';

type Range = 'week' | 'month';

const MONTHS = Array.from({ length: 12 }, (_, i) =>
  new Date(2026, i, 1).toLocaleDateString('en-US', { month: 'long' }),
);

const STATUS_TONES: Record<(typeof STATUS_LOOKS)[AppointmentDisplayStatus]['tone'], CalendarTone> =
  {
    success: 'green',
    info: 'blue',
    warning: 'amber',
    danger: 'red',
    neutral: 'grey',
    purple: 'purple',
  };

/** The kit's card tone nearest an appointment's `#rrggbb` colour (its hue). */
function hueTone(hex: string): CalendarTone | null {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m?.[1]) return null;
  const n = Number.parseInt(m[1], 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => c / 255) as [
    number,
    number,
    number,
  ];
  const max = Math.max(r, g, b);
  const d = max - Math.min(r, g, b);
  if (d < 0.15) return 'grey';
  let h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  h = (h * 60 + 360) % 360;
  if (h < 20 || h >= 330) return 'red';
  if (h < 65) return 'amber';
  if (h < 170) return 'green';
  if (h < 255) return 'blue';
  return 'purple';
}

/** A card's tone: grey for Busy and cancelled, else its colour, else its status colour. */
function toneOf(a: AgendaEntry): CalendarTone {
  if (a.restricted || a.status === 'CANCELED') return 'grey';
  return (a.color && hueTone(a.color)) || STATUS_TONES[STATUS_LOOKS[a.status].tone];
}

/** The Sunday of the date's week (the design's week starts on Sunday). */
const sundayOf = (date: string) => addDays(date, -weekdayOf(date));

/**
 * Appointments > Calendar (appointments.jpg, guide §2, §10): the KPI cards, the view switch, the
 * period (‹ September 2026 ›) with Week or Month and a month to jump to, New Appointment, the
 * calendar (`api.scheduling.agenda` for the period, in the firm's time zone; each card in its
 * type's colour), Upcoming Appointments (Next 7 Days), and the right column. An empty hour opens
 * Schedule Appointment on that date and time; a card opens the appointment. Staff see another
 * member's appointment as Busy.
 */
export function CalendarScreen({ date }: { date?: string }) {
  const router = useRouter();
  const options = useApiQuery([...SCHEDULING, 'options'], () => api.scheduling.options());
  const tz = options.data?.timezone ?? 'America/New_York';
  const today = todayIn(tz);
  const [picked, setPicked] = useState(() => (date && isCalendarDate(date) ? date : null));
  const anchor = picked ?? today;
  const [range, setRange] = useState<Range>('week');
  const [now] = useState(() => new Date().toISOString());
  const first = range === 'week' ? sundayOf(anchor) : `${anchor.slice(0, 8)}01`;
  const start = dayDate(first);
  const after =
    range === 'week'
      ? addDays(first, 7)
      : dayString(new Date(start.getFullYear(), start.getMonth() + 1, 1));
  const query = {
    from: toInstant(first, '00:00', tz),
    to: toInstant(after, '00:00', tz),
    limit: 500,
  };
  const agenda = useApiQuery([...SCHEDULING, 'agenda', 'calendar', tz, first, after], () =>
    api.scheduling.agenda(query),
  );
  const soon = {
    from: now,
    to: toInstant(addDays(today, 8), '00:00', tz),
    limit: 50,
  };
  const upcoming = useApiQuery([...SCHEDULING, 'agenda', 'upcoming', today], () =>
    api.scheduling.agenda(soon),
  );
  const zone = agenda.data?.timezone ?? tz;

  // The kit's calendar works in the browser's clock: give it the firm's wall-clock times.
  const local = (iso: string) => {
    const p = localParts(iso, zone);
    return new Date(`${p.date}T${p.time}:00`);
  };
  const events: CalendarEvent[] = (agenda.data?.items ?? []).map((a) => ({
    id: a.id,
    start: local(a.startsAt),
    end: local(a.endsAt),
    title: a.restricted ? 'Busy' : a.internal ? 'Team Meeting' : a.contact.name,
    subtitle: a.restricted
      ? a.staff.map((s) => s.name).join(', ')
      : [a.type?.name ?? a.service?.name, a.status === 'CANCELED' ? 'Canceled' : null]
          .filter(Boolean)
          .join(' · '),
    tone: toneOf(a),
  }));
  const restricted = new Set(
    (agenda.data?.items ?? []).filter((a) => a.restricted).map((a) => a.id),
  );
  const move = (step: number) =>
    setPicked(
      range === 'week'
        ? addDays(anchor, step * 7)
        : dayString(new Date(start.getFullYear(), start.getMonth() + step, 1)),
    );
  const title = dayDate(anchor).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  const rows = (upcoming.data?.items ?? []).filter((a) => a.status !== 'CANCELED').slice(0, 5);
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

  return (
    <div className="flex min-w-0 flex-col gap-5">
      <AppointmentsHeader />
      <SummaryCards />
      <AppointmentsToolbar current="calendar">
        <div className="flex items-stretch overflow-hidden rounded-lg border border-divider bg-surface">
          <button
            type="button"
            aria-label={range === 'week' ? 'Previous week' : 'Previous month'}
            onClick={() => move(-1)}
            className="flex w-11 items-center justify-center text-heading hover:bg-canvas"
          >
            <CaretLeft aria-hidden weight="bold" className="size-4" />
          </button>
          <span
            aria-live="polite"
            data-testid="calendar-period"
            className="flex min-h-11 min-w-44 items-center justify-center border-x border-divider px-4 font-bold text-heading"
          >
            {title}
          </span>
          <button
            type="button"
            aria-label={range === 'week' ? 'Next week' : 'Next month'}
            onClick={() => move(1)}
            className="flex w-11 items-center justify-center text-heading hover:bg-canvas"
          >
            <CaretRight aria-hidden weight="bold" className="size-4" />
          </button>
        </div>
        <div className="w-32">
          <Select
            label="Show"
            hideLabel
            options={[
              { value: 'week', label: 'Week' },
              { value: 'month', label: 'Month' },
            ]}
            value={range}
            onChange={(e) => setRange(e.target.value as Range)}
          />
        </div>
        <div className="w-32">
          <Select
            label="Go to month"
            hideLabel
            options={[
              { value: '', label: 'Month' },
              ...MONTHS.map((m, i) => ({ value: String(i), label: `${m} ${anchor.slice(0, 4)}` })),
            ]}
            value=""
            onChange={(e) =>
              e.target.value &&
              setPicked(
                `${anchor.slice(0, 4)}-${String(Number(e.target.value) + 1).padStart(2, '0')}-01`,
              )
            }
          />
        </div>
      </AppointmentsToolbar>

      <div className="grid grid-cols-1 items-start gap-4 min-[1280px]:grid-cols-[1fr_18rem]">
        <div className="flex min-w-0 flex-col gap-4">
          <section
            aria-label="Calendar"
            data-testid="appointments-calendar"
            className="flex min-w-0 flex-col gap-2 rounded-xl border border-divider bg-surface p-2 shadow-sm"
          >
            {agenda.isError ? (
              <p className="rounded-lg bg-subtle p-3 text-sm text-muted">{NOT_LOADED}</p>
            ) : null}
            <CalendarGrid
              view={range}
              date={dayDate(anchor)}
              today={dayDate(today)}
              selected={range === 'month' && picked ? dayDate(picked) : undefined}
              events={events}
              onEventClick={(e) => !restricted.has(e.id) && router.push(`/calendar/${e.id}`)}
              onSlotClick={(start) =>
                router.push(
                  `/calendar/new?date=${dayString(start)}&time=${String(start.getHours()).padStart(2, '0')}:00`,
                )
              }
              onDateClick={(d) => {
                setPicked(dayString(d));
                setRange('week');
              }}
            />
          </section>

          <section
            aria-labelledby="upcoming-title"
            data-testid="upcoming-appointments"
            className="flex min-w-0 flex-col gap-3 rounded-xl border border-divider bg-surface p-4 shadow-sm"
          >
            <div className="flex items-center justify-between gap-3">
              <h2 id="upcoming-title" className="text-lg font-bold text-heading">
                Upcoming Appointments (Next 7 Days)
              </h2>
              <Link href="/calendar/list" className="text-sm text-link underline">
                View All
              </Link>
            </div>
            <Table
              rows={rows}
              loading={upcoming.isPending}
              rowKey={(a) => a.id}
              caption="Upcoming appointments"
              noun="appointments"
              dense
              tableClassName="[&_td]:px-2 [&_th]:px-2"
              showPagination={false}
              columns={agendaColumns(upcoming.data?.timezone ?? tz)}
              rowActions={(a) => <AgendaActions entry={a} menu={menu(a)} />}
              emptyTitle={upcoming.isError ? 'Appointments are not available' : 'Nothing coming up'}
              emptyText={
                upcoming.isError
                  ? NOT_LOADED
                  : 'Nothing is booked in the next 7 days. Schedule one with New Appointment.'
              }
            />
          </section>
        </div>

        <AppointmentsSide date={anchor} onDate={setPicked} />
      </div>
    </div>
  );
}
