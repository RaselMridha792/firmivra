'use client';

import { type InputHTMLAttributes, useId } from 'react';
import { LabelText } from './label-text';

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  /** Hides the label text; it stays as the accessible name (filter bars). */
  hideLabel?: boolean;
  error?: string;
}

/** A labelled text input. The label is always visible (WCAG 2.1 AA, docs/PROJECT-DRAFT-v2.md). */
export function Input({ label, hideLabel, error, id, className = '', ...props }: InputProps) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const errorId = `${inputId}-error`;
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <label
        htmlFor={inputId}
        className={`text-sm font-semibold text-heading ${hideLabel ? 'sr-only' : ''}`}
      >
        <LabelText label={label} />
      </label>
      <input
        id={inputId}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
        className={`min-w-0 w-full max-w-full px-3 py-2 rounded-control border bg-surface text-base text-text shadow-sm transition-colors placeholder:text-muted focus:outline-none focus:ring-2 disabled:cursor-not-allowed disabled:bg-disabled disabled:text-muted ${error ? 'border-danger focus:border-danger focus:ring-danger/20' : 'border-border hover:border-control-border focus:border-action focus:ring-action/25'} ${className}`}
        {...props}
      />
      {error ? (
        <p id={errorId} className="text-sm font-medium text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}
