'use client';

import type { CalendarAppointment } from '@firmivra/types';
import { AppointmentChip } from './appointment-chip';
import { addDays, dayLabel, localParts } from './time';

interface GridProps {
  items: CalendarAppointment[];
  timeZone: string;
  showStaff: boolean;
  onOpen: (id: string) => void;
}

const chips = ({ items, ...chip }: GridProps) =>
  items.map((item) => <AppointmentChip key={item.id} item={item} {...chip} />);

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
            className="flex flex-col gap-2 rounded-card border border-border bg-surface p-2 md:min-h-32"
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

const hourLabel = (hour: number) =>
  `${hour % 12 === 0 ? 12 : hour % 12} ${hour < 12 ? 'AM' : 'PM'}`;

/** One day by the hour: 8 AM to 6 PM, wider when appointments fall outside. */
export function DayGrid(grid: GridProps) {
  const hourOf = (item: CalendarAppointment) =>
    Number(localParts(item.startsAt, grid.timeZone).time.slice(0, 2));
  const hours = grid.items.map(hourOf);
  const first = Math.min(8, ...hours);
  const last = Math.max(18, ...hours);
  return (
    <div className="rounded-card border border-border bg-surface">
      {Array.from({ length: last - first + 1 }, (_, i) => first + i).map((hour) => {
        const items = grid.items.filter((item) => hourOf(item) === hour);
        return (
          <div key={hour} className="flex gap-3 border-t border-border p-2 first:border-t-0">
            <span className="w-14 shrink-0 text-xs text-muted">{hourLabel(hour)}</span>
            <ul className="flex min-w-0 flex-1 flex-col gap-1">{chips({ ...grid, items })}</ul>
          </div>
        );
      })}
    </div>
  );
}
