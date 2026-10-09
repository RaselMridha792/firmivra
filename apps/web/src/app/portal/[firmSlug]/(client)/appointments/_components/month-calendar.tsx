'use client';

import type { MyAppointment } from '@firmivra/types';
import { Card } from '@firmivra/ui';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useState } from 'react';
import { today } from './shared';

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** 'YYYY-MM-DD' of a UTC-noon date (calendar arithmetic without time zones). */
const iso = (date: Date) => date.toISOString().slice(0, 10);
const atNoon = (day: string) => new Date(`${day}T12:00:00Z`);

/** The appointment's date in the client's time zone. */
const dayOf = (startsAt: string) => new Intl.DateTimeFormat('en-CA').format(new Date(startsAt));

/** Every day shown for a month: whole weeks, Sunday first. */
const weeksOf = (month: string) => {
  const first = atNoon(`${month}-01`);
  const start = new Date(first);
  start.setUTCDate(1 - first.getUTCDay());
  const last = new Date(first);
  last.setUTCMonth(last.getUTCMonth() + 1, 0);
  const days: string[] = [];
  for (
    const day = start;
    day <= last || day.getUTCDay() !== 0;
    day.setUTCDate(day.getUTCDate() + 1)
  )
    days.push(iso(day));
  return days;
};

const shift = (month: string, by: number) => {
  const date = atNoon(`${month}-01`);
  date.setUTCMonth(date.getUTCMonth() + by);
  return iso(date).slice(0, 7);
};

/**
 * The month calendar: days with a scheduled appointment carry a dot (past ones a lighter dot).
 * Today and later days open "Schedule an Appointment" on that day.
 */
export function MonthCalendar({
  appointments,
  onPickDay,
}: {
  appointments: MyAppointment[];
  onPickDay: (day: string) => void;
}) {
  const [now] = useState(today);
  const [month, setMonth] = useState(now.slice(0, 7));
  const scheduled = new Set(
    appointments.filter((a) => a.status === 'SCHEDULED').map((a) => dayOf(a.startsAt)),
  );
  const past = new Set(
    appointments.filter((a) => a.status !== 'SCHEDULED').map((a) => dayOf(a.startsAt)),
  );
  const title = atNoon(`${month}-01`).toLocaleString('en-US', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
  const arrow =
    'flex size-9 items-center justify-center rounded-control text-heading hover:bg-folder-surface';

  return (
    <Card variant="elevated" aria-label="Calendar">
      <div className="mb-4 flex items-center gap-2">
        <button
          type="button"
          aria-label="Previous month"
          className={arrow}
          onClick={() => setMonth(shift(month, -1))}
        >
          <ChevronLeft aria-hidden className="size-5" />
        </button>
        <h2
          aria-live="polite"
          className="font-display text-xl whitespace-nowrap font-bold text-heading 2xl:text-2xl"
        >
          {title}
        </h2>
        <button
          type="button"
          aria-label="Next month"
          className={arrow}
          onClick={() => setMonth(shift(month, 1))}
        >
          <ChevronRight aria-hidden className="size-5" />
        </button>
        <button
          type="button"
          onClick={() => setMonth(now.slice(0, 7))}
          className="ml-auto rounded-control border border-border bg-info-soft px-4 py-1.5 text-sm font-semibold text-link hover:bg-folder-hover"
        >
          Today
        </button>
      </div>
      <div className="grid grid-cols-7 text-center text-sm">
        {WEEKDAYS.map((day) => (
          <div key={day} className="pb-3 font-medium text-text">
            {day}
          </div>
        ))}
        {weeksOf(month).map((day) => {
          const inMonth = day.startsWith(month);
          const isToday = day === now;
          const label = atNoon(day).toLocaleString('en-US', {
            month: 'long',
            day: 'numeric',
            year: 'numeric',
            timeZone: 'UTC',
          });
          return (
            <button
              key={day}
              type="button"

              disabled={day < now}
              aria-label={`${label}${scheduled.has(day) ? ', appointment scheduled' : ''}`}
              onClick={() => onPickDay(day)}
              className={`flex h-14 flex-col items-center justify-center gap-1 border-t border-border enabled:hover:bg-folder-surface disabled:cursor-default ${inMonth ? 'text-text' : 'text-muted'}`}
            >
              <span
                className={`flex size-9 items-center justify-center rounded-pill ${isToday ? 'bg-action font-semibold text-on-action' : ''}`}
              >
                {Number(day.slice(8))}
              </span>
              <span
                aria-hidden
                className={`size-1.5 rounded-pill ${scheduled.has(day) ? 'bg-action' : past.has(day) ? 'bg-control-border' : ''}`}
              />
            </button>
          );
        })}
      </div>
      <div className="mt-4 flex flex-wrap gap-x-6 gap-y-2 text-sm text-text">
        <span className="flex items-center gap-2">
          <span aria-hidden className="size-3 rounded-pill bg-action" /> Scheduled
        </span>
        <span className="flex items-center gap-2">
          <span aria-hidden className="size-3 rounded-pill bg-control-border" /> Past
        </span>
      </div>
    </Card>
  );
}
