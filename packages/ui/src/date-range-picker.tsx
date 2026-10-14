'use client';

import { CalendarBlank } from '@phosphor-icons/react';
import { useId } from 'react';

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

/** A From and To date, each with the calendar icon; the browser's own calendar opens on click. */
export function DateRangePicker({ label, value, onChange }: DateRangePickerProps) {
  const id = useId();
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
              value={value[edge]}
              min={edge === 'to' ? value.from || undefined : undefined}
              max={edge === 'from' ? value.to || undefined : undefined}
              onChange={(event) => onChange({ ...value, [edge]: event.target.value })}
              className="min-h-0 w-full min-w-0 bg-transparent text-text outline-none [&::-webkit-calendar-picker-indicator]:hidden"
              onClick={(event) => event.currentTarget.showPicker?.()}
            />
            <CalendarBlank aria-hidden weight="fill" className="size-4 shrink-0 text-muted" />
          </label>
        ))}
      </div>
    </fieldset>
  );
}
