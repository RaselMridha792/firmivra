'use client';
import { type TextareaHTMLAttributes, useId } from 'react';
export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label: string;
  error?: string;
}
export function Textarea({ label, error, id, className = '', rows = 4, ...props }: TextareaProps) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const errorId = `${inputId}-error`;
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={inputId} className="text-sm font-medium text-text">
        {label}
      </label>
      <textarea
        id={inputId}
        rows={rows}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
        className={`rounded-control border bg-surface px-3 py-2 text-base text-text placeholder:text-muted focus:outline-2 focus:outline-accent-500 ${error ? 'border-danger' : 'border-border'} ${className}`}
        {...props}
      />
      {error ? (
        <p id={errorId} className="text-xs text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}
