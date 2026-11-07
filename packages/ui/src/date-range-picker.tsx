'use client';

import { CalendarBlank } from '@phosphor-icons/react';
import { useId, useState } from 'react';

export interface DateRange {
  /** `YYYY-MM-DD`, or an empty string. */
  from: string;
  to: string;
}
export interface DateRangePickerProps {
  label: string;
  value: DateRange;
  onChange: (range: DateRange) => void;
}

const field =
  'flex h-10 min-w-0 flex-1 items-center gap-2 rounded-lg border border-divider bg-surface px-3 text-sm text-text focus-within:outline-2 focus-within:outline-focus';

/**
 * A From and To date, each with the calendar icon; the browser's own calendar opens on click.
 * Each date has a name screen readers say ("Created Date: From, start date"). An end before the
 * start is never passed on: it stays on screen with "End date is before start date" until it is
 * fixed, and the range last passed on stays in force (SA-PIP-PL01, SA-SUP-R1, SA-INT-R4).
 */
export function DateRangePicker({ label, value, onChange }: DateRangePickerProps) {
  const id = useId();
  const [held, setHeld] = useState<DateRange | null>(null);
  const shown = held ?? value;
  const reversed = Boolean(shown.from && shown.to && shown.to < shown.from);
  const change = (next: DateRange) => {
    if (next.from && next.to && next.to < next.from) {
      setHeld(next);
      return;
    }
    setHeld(null);
    onChange(next);
  };
  return (
    <fieldset className="flex min-w-0 flex-col gap-1">
      <legend className="mb-1 text-sm font-medium text-text">{label}</legend>
      <div className="flex gap-2">
        {(['from', 'to'] as const).map((edge) => (
          <label key={edge} htmlFor={`${id}-${edge}`} className={field}>
            <span className="text-muted">{edge === 'from' ? 'From' : 'To'}</span>
            <input
              id={`${id}-${edge}`}
              type="date"
              aria-label={`${label}: ${edge === 'from' ? 'From, start date' : 'To, end date'}`}
              aria-invalid={edge === 'to' && reversed ? true : undefined}
              aria-describedby={reversed ? `${id}-error` : undefined}
              value={shown[edge]}
              onChange={(event) => change({ ...shown, [edge]: event.target.value })}
              className="min-h-0 w-full min-w-0 bg-transparent text-text outline-none [&::-webkit-calendar-picker-indicator]:hidden"
              onClick={(event) => event.currentTarget.showPicker?.()}
            />
            <CalendarBlank aria-hidden weight="fill" className="size-4 shrink-0 text-muted" />
          </label>
        ))}
      </div>
      {reversed ? (
        <p id={`${id}-error`} role="alert" className="text-xs text-danger">
          End date is before start date
        </p>
      ) : null}
    </fieldset>
  );
}
