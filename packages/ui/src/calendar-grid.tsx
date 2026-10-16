'use client';

import { CaretLeft, CaretRight } from '@phosphor-icons/react';
import { useState } from 'react';

const eventTones = {
  blue: 'bg-info-soft border-info',
  red: 'bg-danger-soft border-chart-red',
  amber: 'bg-warning-soft border-gold-light',
  green: 'bg-success-soft border-chart-green',
  purple: 'bg-purple-soft border-purple',
  grey: 'bg-disabled border-control-border',
} as const;
export type CalendarTone = keyof typeof eventTones;

export interface CalendarEvent {
  id: string;
  start: Date | string;
  end: Date | string;
  /** "Danielle Lawshea", "Team Meeting". */
  title: string;
  /** "Consultation". */
  subtitle?: string;
  tone?: CalendarTone;
}

const toDate = (d: Date | string) => (d instanceof Date ? d : new Date(d));
const atMidnight = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
export const sameDay = (a: Date, b: Date) =>
  a.getFullYear() === b.getFullYear() &&
  a.getMonth() === b.getMonth() &&
  a.getDate() === b.getDate();

/** The seven days of `date`'s week (Sunday first by default), at local midnight. */
export function weekDays(date: Date, weekStartsOn = 0): Date[] {
  const d = atMidnight(date);
  const start = addDays(d, -((d.getDay() - weekStartsOn + 7) % 7));
  return Array.from({ length: 7 }, (_, i) => addDays(start, i));
}

export interface MonthCell {
  date: Date;
  /** False for the days of the previous and next month that fill the first and last week. */
  inMonth: boolean;
}

/** The month as whole weeks of seven days, padded with the neighbouring months' days. */
export function monthWeeks(date: Date, weekStartsOn = 0): MonthCell[][] {
  const first = new Date(date.getFullYear(), date.getMonth(), 1);
  const last = new Date(date.getFullYear(), date.getMonth() + 1, 0);
  const start = weekDays(first, weekStartsOn)[0] as Date;
  const weeks: MonthCell[][] = [];
  for (let d = start; d <= last || weeks.length === 0;) {
    const week: MonthCell[] = [];
    for (let i = 0; i < 7; i += 1) {
      week.push({ date: d, inMonth: d.getMonth() === date.getMonth() });
      d = addDays(d, 1);
    }
    weeks.push(week);
  }
  return weeks;
}

export interface PlacedEvent {
  event: CalendarEvent;
  /** Fractions of the visible day (0 at startHour, 1 at endHour). */
  top: number;
  height: number;
  /** Side-by-side lanes when events overlap. */
  lane: number;
  lanes: number;
}

/** Events of one day placed in the visible hours, overlapping ones side by side. */
export function placeDayEvents(
  events: CalendarEvent[],
  day: Date,
  startHour: number,
  endHour: number,
): PlacedEvent[] {
  const from = atMidnight(day).getTime() + startHour * 3_600_000;
  const span = (endHour - startHour) * 3_600_000;
  const todays = events
    .map((event) => ({ event, s: toDate(event.start).getTime(), e: toDate(event.end).getTime() }))
    .filter(({ s, e }) => e > from && s < from + span && e > s)
    .sort((a, b) => a.s - b.s || b.e - a.e);
  const placed: PlacedEvent[] = [];
  let group: { item: (typeof todays)[number]; lane: number }[] = [];
  let groupEnd = -Infinity;
  const flush = () => {
    const lanes = Math.max(1, ...group.map((g) => g.lane + 1));
    for (const { item, lane } of group) {
      const s = Math.max(item.s, from);
      const e = Math.min(item.e, from + span);
      placed.push({
        event: item.event,
        top: (s - from) / span,
        height: (e - s) / span,
        lane,
        lanes,
      });
    }
    group = [];
  };
  for (const item of todays) {
    if (item.s >= groupEnd) {
      flush();
      groupEnd = -Infinity;
    }
    const used = new Set(group.filter((g) => g.item.e > item.s).map((g) => g.lane));
    let lane = 0;
    while (used.has(lane)) lane += 1;
    group.push({ item, lane });
    groupEnd = Math.max(groupEnd, item.e);
  }
  flush();
  return placed;
}

const fmt = (options: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat('en-US', options);
const monthTitle = fmt({ month: 'long', year: 'numeric' });
const weekday = fmt({ weekday: 'short' });
const shortDate = fmt({ month: 'short', day: 'numeric' });
const fullDate = fmt({ weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
const timeOf = fmt({ hour: 'numeric', minute: '2-digit' });
const hourLabel = (h: number) => timeOf.format(new Date(2000, 0, 1, h));

export interface CalendarGridProps {
  /** `week`: the hours grid; `month`: a month of days with event chips; `mini`: the small month. */
  view: 'week' | 'month' | 'mini';
  /** Any day in the week or month to show. */
  date: Date;
  events?: CalendarEvent[];
  today?: Date;
  /** The picked day (mini and month). */
  selected?: Date;
  startHour?: number;
  endHour?: number;
  weekStartsOn?: number;
  /** Show the "‹ September 2026 ›" header with these. */
  onPrev?: () => void;
  onNext?: () => void;
  onEventClick?: (event: CalendarEvent) => void;
  /** Week: an empty hour was clicked (prefill a new appointment). */
  onSlotClick?: (start: Date) => void;
  /** Month and mini: a day was clicked. */
  onDateClick?: (day: Date) => void;
}

function Header({
  date,
  onPrev,
  onNext,
  compact,
}: {
  date: Date;
  onPrev?: () => void;
  onNext?: () => void;
  compact?: boolean;
}) {
  if (!onPrev && !onNext) return null;
  const nav =
    'flex size-8 items-center justify-center rounded-md text-heading hover:bg-folder-surface';
  return (
    <div className={`flex items-center justify-between ${compact ? 'mb-2' : 'mb-3'}`}>
      <button type="button" aria-label="Previous" onClick={onPrev} className={nav}>
        <CaretLeft aria-hidden weight="bold" className="size-4" />
      </button>
      <span
        className={`font-bold text-heading ${compact ? 'text-lg' : 'text-xl'}`}
        aria-live="polite"
      >
        {monthTitle.format(date)}
      </span>
      <button type="button" aria-label="Next" onClick={onNext} className={nav}>
        <CaretRight aria-hidden weight="bold" className="size-4" />
      </button>
    </div>
  );
}

function EventCard({
  event,
  onClick,
  compact,
}: {
  event: CalendarEvent;
  onClick?: (e: CalendarEvent) => void;
  compact?: boolean;
}) {
  const start = toDate(event.start);
  const end = toDate(event.end);
  const range = `${timeOf.format(start)} - ${timeOf.format(end)}`;
  return (
    <button
      type="button"
      onClick={() => onClick?.(event)}
      aria-label={`${event.title}${event.subtitle ? `, ${event.subtitle}` : ''}, ${range}`}
      className={`flex size-full min-w-0 flex-col overflow-hidden rounded-md border-l-4 px-2 py-1 text-left shadow-sm ${eventTones[event.tone ?? 'blue']}`}
    >
      <span className="truncate text-sm leading-tight font-bold text-heading">{event.title}</span>
      {compact ? null : (
        <>
          {event.subtitle ? (
            <span className="truncate text-xs leading-tight text-muted">{event.subtitle}</span>
          ) : null}
          <span className="truncate text-xs leading-tight text-text">{range}</span>
        </>
      )}
    </button>
  );
}

/** One hour: room for a one-hour card's three lines (name, type, time). */
const HOUR_ROW = 'h-14';

/** The Appointments calendar: a week of hours, a month, or the small month beside it. */
export function CalendarGrid({
  view,
  date,
  events = [],
  today: todayProp,
  selected,
  startHour = 8,
  endHour = 18,
  weekStartsOn = 0,
  onPrev,
  onNext,
  onEventClick,
  onSlotClick,
  onDateClick,
}: CalendarGridProps) {
  const [now] = useState(() => new Date());
  const today = todayProp ?? now;
  if (view === 'week') {
    const days = weekDays(date, weekStartsOn);
    const hours = Array.from({ length: endHour - startHour }, (_, i) => startHour + i);
    return (
      <div>
        <Header date={date} onPrev={onPrev} onNext={onNext} />
        <div className="overflow-x-auto rounded-lg border border-border bg-surface">
          <div
            className="min-w-3xl"
            role="group"
            aria-label={`Week of ${fullDate.format(days[0] as Date)}`}
          >
            <div className="flex bg-table-head">
              <span aria-hidden className="w-20 shrink-0 border-b border-border" />
              {days.map((d) => {
                const isToday = sameDay(d, today);
                return (
                  <span
                    key={d.getTime()}
                    aria-current={isToday ? 'date' : undefined}
                    className="flex flex-1 flex-col items-center gap-0.5 border-b border-l border-border py-2 text-sm text-heading"
                  >
                    <span>{weekday.format(d)}</span>
                    {isToday ? (
                      <span className="flex size-7 items-center justify-center rounded-full bg-action font-bold text-on-action">
                        {d.getDate()}
                      </span>
                    ) : (
                      <span>{shortDate.format(d)}</span>
                    )}
                  </span>
                );
              })}
            </div>
            <div className="flex">
              <div aria-hidden className="flex w-20 shrink-0 flex-col">
                {hours.map((h) => (
                  <span key={h} className={`${HOUR_ROW} pt-1 pr-2 text-right text-xs text-muted`}>
                    {hourLabel(h)}
                  </span>
                ))}
              </div>
              {days.map((d) => (
                <div
                  key={d.getTime()}
                  aria-label={fullDate.format(d)}
                  role="group"
                  className="relative min-w-0 flex-1 border-l border-border"
                >
                  {hours.map((h) => (
                    <button
                      key={h}
                      type="button"
                      tabIndex={onSlotClick ? 0 : -1}
                      disabled={!onSlotClick}
                      aria-label={`${fullDate.format(d)}, ${hourLabel(h)}`}
                      onClick={() =>
                        onSlotClick?.(new Date(d.getFullYear(), d.getMonth(), d.getDate(), h))
                      }
                      className={`${HOUR_ROW} block w-full border-b border-divider enabled:hover:bg-subtle`}
                    />
                  ))}
                  {placeDayEvents(events, d, startHour, endHour).map((p) => (
                    <div
                      key={p.event.id}
                      className="absolute p-0.5"
                      style={{
                        top: `${p.top * 100}%`,
                        height: `${p.height * 100}%`,
                        left: `${(p.lane / p.lanes) * 100}%`,
                        width: `${100 / p.lanes}%`,
                      }}
                    >
                      <EventCard
                        event={p.event}
                        onClick={onEventClick}
                        compact={p.height * (endHour - startHour) < 0.75}
                      />
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    );
  }

  const weeks = monthWeeks(date, weekStartsOn);
  const letters = weekDays(date, weekStartsOn).map((d) => ({
    key: d.getDay(),
    text: view === 'mini' ? weekday.format(d).charAt(0) : weekday.format(d),
  }));
  const eventsOn = (d: Date) =>
    events
      .filter((e) => sameDay(toDate(e.start), d))
      .sort((a, b) => toDate(a.start).getTime() - toDate(b.start).getTime());

  if (view === 'mini') {
    return (
      <div className="w-full">
        <Header date={date} onPrev={onPrev} onNext={onNext} compact />
        <table className="w-full table-fixed text-center text-sm">
          <caption className="sr-only">{monthTitle.format(date)}</caption>
          <thead>
            <tr>
              {letters.map((l) => (
                <th key={l.key} scope="col" className="pb-2 font-semibold text-heading">
                  {l.text}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {weeks.map((week) => (
              <tr key={week[0]?.date.getTime()}>
                {week.map(({ date: d, inMonth }) => (
                  <td key={d.getTime()} className="py-1">
                    {inMonth ? (
                      <button
                        type="button"
                        aria-label={fullDate.format(d)}
                        aria-current={sameDay(d, today) ? 'date' : undefined}
                        aria-pressed={selected ? sameDay(d, selected) : undefined}
                        onClick={() => onDateClick?.(d)}
                        className={`mx-auto flex size-8 items-center justify-center rounded-full ${sameDay(d, today) ? 'bg-action font-bold text-on-action' : selected && sameDay(d, selected) ? 'ring-2 ring-action text-heading' : 'text-heading hover:bg-folder-surface'}`}
                      >
                        {d.getDate()}
                      </button>
                    ) : null}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  return (
    <div>
      <Header date={date} onPrev={onPrev} onNext={onNext} />
      <div
        role="grid"
        aria-label={monthTitle.format(date)}
        className="overflow-hidden rounded-lg border border-border bg-surface"
      >
        <div role="row" className="grid grid-cols-7 bg-table-head">
          {letters.map((l) => (
            <span
              key={l.key}
              role="columnheader"
              className="border-l border-border py-2 text-center text-sm text-heading first:border-l-0"
            >
              {l.text}
            </span>
          ))}
        </div>
        {weeks.map((week) => (
          <div
            key={week[0]?.date.getTime()}
            role="row"
            className="grid grid-cols-7 border-t border-border"
          >
            {week.map(({ date: d, inMonth }) => {
              const dayEvents = eventsOn(d);
              const isToday = sameDay(d, today);
              const picked = selected && sameDay(d, selected);
              return (
                <div
                  key={d.getTime()}
                  role="gridcell"
                  aria-label={fullDate.format(d)}
                  className={`flex min-h-28 flex-col gap-1 border-l border-border p-1 first:border-l-0 ${picked ? 'bg-info-soft' : inMonth ? '' : 'bg-subtle'}`}
                >
                  <button
                    type="button"
                    aria-label={fullDate.format(d)}
                    aria-current={isToday ? 'date' : undefined}
                    onClick={() => onDateClick?.(d)}
                    className={`flex size-7 items-center justify-center self-start rounded-full text-sm ${isToday ? 'bg-action font-bold text-on-action' : inMonth ? 'text-heading hover:bg-folder-surface' : 'text-muted hover:bg-folder-surface'}`}
                  >
                    {d.getDate()}
                  </button>
                  {dayEvents.slice(0, 3).map((e) => (
                    <div key={e.id} className="h-6">
                      <EventCard event={e} onClick={onEventClick} compact />
                    </div>
                  ))}
                  {dayEvents.length > 3 ? (
                    <button
                      type="button"
                      onClick={() => onDateClick?.(d)}
                      className="text-left text-xs font-semibold text-link"
                    >
                      +{dayEvents.length - 3} more
                    </button>
                  ) : null}
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
