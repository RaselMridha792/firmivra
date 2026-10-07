'use client';

import { useId, type SelectHTMLAttributes, type InputHTMLAttributes } from 'react';

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label: string;
  error?: string;
  options: { value: string; label: string }[];
}
export function Select({ label, options, error, id, className = '', ...props }: SelectProps) {
  const generatedId = useId();
  const fieldId = id ?? generatedId;
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <label htmlFor={fieldId} className="text-sm font-medium">
        {label}
      </label>
      <select
        id={fieldId}
        aria-invalid={!!error}
        aria-describedby={error ? `${fieldId}-error` : undefined}
        className={`w-full rounded-control border border-control-border bg-surface px-3 py-2 text-base disabled:bg-disabled ${className}`}
        {...props}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      {error ? (
        <p id={`${fieldId}-error`} className="text-sm text-danger">
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
    <label htmlFor={fieldId} className={`flex min-h-11 items-center gap-3 text-sm ${className}`}>
      <input {...props} id={fieldId} type="checkbox" className="h-4 w-4 shrink-0" />
      <span>{label}</span>
    </label>
  );
}
