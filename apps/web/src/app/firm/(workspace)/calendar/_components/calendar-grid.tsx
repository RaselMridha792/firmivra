'use client';

import type { CalendarAppointment } from '@firmivra/types';
import { AppointmentChip } from './appointment-chip';
import { addDays, dayLabel, localParts } from './time';

interface GridProps {
  items: CalendarAppointment[];
  timeZone: string;
  showStaff: boolean;
}

const chips = ({ items, timeZone, showStaff }: GridProps) =>
  items.map((item) => (
    <AppointmentChip key={item.id} item={item} timeZone={timeZone} showStaff={showStaff} />
  ));

/** Seven columns from Monday; a day's header opens it in the Day view. Stacked on a phone. */
export function WeekGrid({
  from,
  today,
  onOpenDay,
  ...grid
}: GridProps & { from: string; today: string; onOpenDay: (date: string) => void }) {
  const dates = Array.from({ length: 7 }, (_, i) => addDays(from, i));
  return (
    <div className="grid gap-3 md:grid-cols-7">
      {dates.map((date) => {
        const items = grid.items.filter(
          (item) => localParts(item.startsAt, grid.timeZone).date === date,
        );
        return (
          <section
            key={date}
            data-testid="calendar-day"
            aria-label={dayLabel(date)}
            className="flex min-h-32 flex-col gap-2 rounded-card border border-border bg-surface p-2"
          >
            <button
              type="button"
              onClick={() => onOpenDay(date)}
              aria-current={date === today ? 'date' : undefined}
              className={`rounded-control px-1 text-left text-sm font-semibold hover:bg-canvas ${date === today ? 'text-link' : 'text-text'}`}
            >
              {dayLabel(date)}
            </button>
            {items.length ? (
              <ul className="flex flex-col gap-1">{chips({ ...grid, items })}</ul>
            ) : (
              <p className="px-1 text-xs text-muted">No appointments</p>
            )}
          </section>
        );
      })}
    </div>
  );
}
