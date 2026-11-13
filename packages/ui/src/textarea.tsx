'use client';
import { type TextareaHTMLAttributes, useId } from 'react';
import { LabelText } from './label-text';
import { describedBy, FieldHint } from './field-hint';
export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label: string;
  /** Persistent helper text between the label and the box; it also describes the box. */
  hint?: string;
  error?: string;
}
export function Textarea({
  label,
  hint,
  error,
  id,
  className = '',
  rows = 4,
  ...props
}: TextareaProps) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const errorId = `${inputId}-error`;
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <label htmlFor={inputId} className="text-sm font-semibold text-heading">
        <LabelText label={label} />
      </label>
      <FieldHint id={inputId} hint={hint} />
      <textarea
        id={inputId}
        rows={rows}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(inputId, hint, error)}
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
