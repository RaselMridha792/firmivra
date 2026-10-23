'use client';

import type { WorkingHoursRange } from '@firmivra/types';
import { Button, Input } from '@firmivra/ui';
import { Plus, Trash } from '@phosphor-icons/react';

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
/** Monday first; weekday 0 is Sunday. */
const WEEK = [1, 2, 3, 4, 5, 6, 0];

/**
 * What is wrong with each range, by its index: an end not after its start, or an overlap with
 * an earlier range on the same day (the rules of SetWorkingHoursRequest, placed on the field).
 */
export function hourErrors(hours: WorkingHoursRange[]): Map<number, string> {
  const errors = new Map<number, string>();
  hours.forEach((r, i) => {
    if (!r.startsAt || !r.endsAt) errors.set(i, 'Enter a start and an end.');
    else if (r.endsAt <= r.startsAt) errors.set(i, 'The end must be after the start.');
    else if (
      hours.some(
        (o, j) =>
          j < i &&
          o.weekday === r.weekday &&
          o.startsAt < o.endsAt &&
          o.startsAt < r.endsAt &&
          r.startsAt < o.endsAt,
      )
    )
      errors.set(i, 'These hours overlap other hours on this day.');
  });
  return errors;
}

/**
 * One person's regular week in Edit My Availability, in the firm's time zone and 15-minute
 * steps (the same week as Settings > Availability). Saving is the parent form's.
 */
export function WeekHours({
  hours,
  errors,
  timeZone,
  editable,
  onChange,
}: {
  hours: WorkingHoursRange[];
  errors: Map<number, string>;
  timeZone: string;
  editable: boolean;
  onChange: (hours: WorkingHoursRange[]) => void;
}) {
  const change = (index: number, patch: Partial<WorkingHoursRange>) =>
    onChange(hours.map((r, i) => (i === index ? { ...r, ...patch } : r)));
  return (
    <fieldset className="flex flex-col gap-2" data-testid="week-hours">
      <legend className="mb-1 text-sm font-medium text-text">Weekly Working Hours</legend>
      <p className="text-xs text-muted">
        Times are in {timeZone}. Clients and staff can book only inside these hours.
      </p>
      <ul className="flex flex-col">
        {WEEK.map((weekday) => {
          const day = DAYS[weekday] ?? '';
          const ranges = hours.flatMap((range, index) =>
            range.weekday === weekday ? [{ range, index }] : [],
          );
          const add = editable ? (
            <Button
              variant="ghost"
              className="shrink-0 self-start"
              aria-label={`Add hours on ${day}`}
              onClick={() => onChange([...hours, { weekday, startsAt: '09:00', endsAt: '17:00' }])}
            >
              <Plus aria-hidden weight="bold" className="size-4" />
              Add hours
            </Button>
          ) : null;
          return (
            <li
              key={weekday}
              className="flex flex-col gap-2 border-t border-divider py-2 sm:grid sm:grid-cols-[6rem_1fr] sm:items-start"
            >
              <span className="text-sm font-medium text-text sm:pt-2.5">{day}</span>
              <div className="flex min-w-0 flex-col gap-2">
                {ranges.length === 0 ? (
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm text-muted">Not working</span>
                    {add}
                  </div>
                ) : null}
                {ranges.map(({ range, index }) => (
                  <div key={index} className="grid grid-cols-[1fr_1fr_auto] items-start gap-2">
                    <Input
                      label="From"
                      hideLabel
                      aria-label={`${day} from`}
                      type="time"
                      step={900}
                      className="px-2! max-sm:text-sm!"
                      disabled={!editable}
                      value={range.startsAt}
                      onChange={(e) => change(index, { startsAt: e.target.value })}
                    />
                    <Input
                      label="To"
                      hideLabel
                      aria-label={`${day} to`}
                      type="time"
                      step={900}
                      className="px-2! max-sm:text-sm!"
                      disabled={!editable}
                      value={range.endsAt}
                      error={errors.get(index)}
                      onChange={(e) => change(index, { endsAt: e.target.value })}
                    />
                    {editable ? (
                      <button
                        type="button"
                        aria-label={`Remove these hours on ${day}`}
                        onClick={() => onChange(hours.filter((_, i) => i !== index))}
                        className="inline-flex size-11 items-center justify-center rounded-control border border-divider text-danger hover:bg-canvas"
                      >
                        <Trash aria-hidden weight="bold" className="size-4" />
                      </button>
                    ) : null}
                  </div>
                ))}
                {ranges.length ? add : null}
              </div>
            </li>
          );
        })}
      </ul>
    </fieldset>
  );
}
