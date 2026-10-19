'use client';

import { useId, type SelectHTMLAttributes, type InputHTMLAttributes } from 'react';

/** `className` styles the <select> itself: set a width on a parent so the chevron follows it. */
export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label: string;
  /** Hides the label text; it stays as the accessible name (filter bars). */
  hideLabel?: boolean;
  error?: string;
  options: { value: string; label: string }[];
}
export function Select({
  label,
  hideLabel,
  options,
  error,
  id,
  className = '',
  ...props
}: SelectProps) {
  const generatedId = useId();
  const fieldId = id ?? generatedId;
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <label
        htmlFor={fieldId}
        className={`text-sm font-semibold text-heading ${hideLabel ? 'sr-only' : ''}`}
      >
        {label}
      </label>
      <div className="relative">
        <select
          id={fieldId}
          aria-invalid={!!error}
          aria-describedby={error ? `${fieldId}-error` : undefined}
          className={`min-h-11 min-w-0 w-full max-w-full appearance-none rounded-control border bg-surface py-2 pl-3 pr-10 text-base text-text shadow-sm transition-colors focus:outline-none focus:ring-2 disabled:bg-disabled ${error ? 'border-danger focus:border-danger focus:ring-danger/20' : 'border-border focus:border-action focus:ring-action/20'} ${className}`}
          {...props}
        >
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        {/* The mockups' thin chevron in place of the native arrow. */}
        <svg
          aria-hidden="true"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-muted"
        >
          <path d="m6 9 6 6 6-6" />
        </svg>
      </div>
      {error ? (
        <p id={`${fieldId}-error`} className="text-sm font-medium text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}
export interface CheckboxProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> {
  label: string;
}
export function Checkbox({ label, id, className = '', ...props }: CheckboxProps) {
  const generatedId = useId();
  const fieldId = id ?? generatedId;
  return (
    <label
      htmlFor={fieldId}
      className={`flex min-h-11 items-center gap-3 text-base text-text ${className}`}
    >
      <input
        {...props}
        id={fieldId}
        type="checkbox"
        className="size-5 shrink-0 rounded border-border accent-action focus:outline-none focus:ring-2 focus:ring-action/20"
      />
      <span>{label}</span>
    </label>
  );
}
