'use client';

import { type InputHTMLAttributes, useId } from 'react';

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  error?: string;
  hint?: string;
}

/** A labelled text input. The label is always visible (WCAG 2.1 AA, docs/PROJECT-DRAFT-v2.md). */
export function Input({
  label,
  error,
  hint,
  id,
  className = '',
  'aria-describedby': describedBy,
  ...props
}: InputProps) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const errorId = `${inputId}-error`;
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={inputId} className="text-sm font-medium text-text">
        {label}
      </label>
      <input
        id={inputId}
        aria-invalid={error ? true : undefined}
        aria-describedby={
          [describedBy, error ? errorId : '', hint ? `${inputId}-hint` : '']
            .filter(Boolean)
            .join(' ') || undefined
        }
        className={`min-w-0 rounded-control border bg-surface px-3 py-2 text-base text-text placeholder:text-muted disabled:bg-disabled focus:outline-2 focus:outline-focus ${error ? 'border-danger' : 'border-control-border'} ${className}`}
        {...props}
      />
      {hint ? (
        <p id={`${inputId}-hint`} className="text-sm text-muted">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={errorId} className="text-xs text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}
