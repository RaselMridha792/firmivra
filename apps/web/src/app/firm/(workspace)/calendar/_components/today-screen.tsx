'use client';

import { CaretLeft, CaretRight } from '@phosphor-icons/react';
import { useAgenda } from './ap-data';
import { Overview, type OverviewState, applyKpiFilter } from './ap-overview';
import { dayRange } from './ap-shared';
import { AppointmentsTable } from './ap-table';
import { addDays, dayLabel } from './time';

/** /calendar/today: the selected day's appointments (today by default), the same records. */
export function TodayScreen() {
  return (
    <Overview
      view="today"
      toolbar={({ day, today, setDay }) => (
        <div className="flex items-center gap-2">
          <div className="inline-flex overflow-hidden rounded-lg border border-divider bg-surface">
            <button
              type="button"
              aria-label="Previous day"
              onClick={() => setDay(addDays(day, -1))}
              className="flex size-10 items-center justify-center text-heading hover:bg-canvas"
            >
              <CaretLeft aria-hidden weight="bold" className="size-4" />
            </button>
            <span
              aria-live="polite"
              data-testid="day-label"
              className="flex min-w-44 items-center justify-center border-x border-divider px-4 text-sm font-bold text-heading"
            >
              {day === today ? 'Today, ' : ''}
              {dayLabel(day)}
            </span>
            <button
              type="button"
              aria-label="Next day"
              onClick={() => setDay(addDays(day, 1))}
              className="flex size-10 items-center justify-center text-heading hover:bg-canvas"
            >
              <CaretRight aria-hidden weight="bold" className="size-4" />
            </button>
          </div>
          <button
            type="button"
            onClick={() => setDay(today)}
            disabled={day === today}
            className="min-h-10 rounded-lg border border-divider bg-surface px-4 text-sm font-medium text-heading hover:bg-canvas disabled:text-muted"
          >
            Today
          </button>
        </div>
      )}
    >
      {(state) => <DaySchedule state={state} />}
    </Overview>
  );
}

function DaySchedule({ state }: { state: OverviewState }) {
  const { day, today, timeZone } = state;
  const agenda = useAgenda(dayRange(day, timeZone));
  const kept = new Set(applyKpiFilter(agenda.items, state.filter).map((item) => item.id));
  const entries = agenda.entries.filter(
    (entry) => state.filter === 'all' || (!entry.restricted && kept.has(entry.id)),
  );
  return (
    <section
      aria-label="Appointments of the day"
      className="rounded-xl bg-surface p-4 shadow-md"
      data-testid="today-card"
    >
      <h2 className="mb-3 text-lg font-bold text-heading">
        {day === today ? "Today's Appointments" : `Appointments, ${dayLabel(day)}`}
      </h2>
      <AppointmentsTable
        entries={entries}
        timeZone={timeZone}
        notify={state.notify}
        loading={agenda.query.isPending}
        caption="Appointments of the day"
        emptyTitle={agenda.query.isError ? 'Appointments are not available' : 'Nothing scheduled'}
        emptyText={
          agenda.query.isError
            ? 'We could not load the appointments. Try again in a moment.'
            : 'There are no appointments on this day.'
        }
      />
    </section>
  );
}
