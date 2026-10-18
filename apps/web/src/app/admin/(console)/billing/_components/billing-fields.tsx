'use client';

import { CalendarBlank, CaretDown } from '@phosphor-icons/react';
import type { InputHTMLAttributes, SelectHTMLAttributes } from 'react';

/**
 * Form controls for the Billing forms, used inside the kit's FormField (which draws the label,
 * the red asterisk and the error line), styled like the kit's Input and Select.
 */

/** A text input's classes; pass `invalid` for the red border. */
export const inputClass = (invalid = false) =>
  `min-h-11 w-full min-w-0 rounded-control border bg-surface px-3 py-2 text-base text-text placeholder:text-muted focus:outline-2 focus:outline-accent-500 disabled:bg-disabled read-only:bg-canvas ${invalid ? 'border-danger' : 'border-border'}`;

/** A native select with the kit's thin chevron. */
export function SelectControl({
  options,
  invalid,
  placeholder,
  className = '',
  ...props
}: SelectHTMLAttributes<HTMLSelectElement> & {
  options: { value: string; label: string }[];
  invalid?: boolean;
  /** A first, empty choice ("Select a firm..."). */
  placeholder?: string;
}) {
  return (
    <div className="relative min-w-0">
      <select
        aria-invalid={invalid || undefined}
        className={`min-h-11 w-full min-w-0 appearance-none rounded-control border bg-surface py-2 pr-10 pl-3 text-base text-text focus:outline-2 focus:outline-accent-500 disabled:bg-disabled ${invalid ? 'border-danger' : 'border-border'} ${className}`}
        {...props}
      >
        {placeholder !== undefined ? <option value="">{placeholder}</option> : null}
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      <CaretDown
        aria-hidden
        weight="bold"
        className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-heading"
      />
    </div>
  );
}

/** A date input (YYYY-MM-DD) with the calendar icon on the right; a click opens the picker. */
export function DateControl({
  invalid,
  className = '',
  ...props
}: Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> & { invalid?: boolean }) {
  return (
    <div className="relative min-w-0">
      <input
        type="date"
        aria-invalid={invalid || undefined}
        onClick={(event) => event.currentTarget.showPicker?.()}
        className={`${inputClass(invalid)} pr-11 [&::-webkit-calendar-picker-indicator]:hidden ${className}`}
        {...props}
      />
      <CalendarBlank
        aria-hidden
        weight="fill"
        className="pointer-events-none absolute top-1/2 right-3 size-5 -translate-y-1/2 text-heading"
      />
    </div>
  );
}
