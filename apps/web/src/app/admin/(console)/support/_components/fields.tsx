'use client';

import { FormField } from '@firmivra/ui';
import { CaretDown } from '@phosphor-icons/react';
import type { InputHTMLAttributes, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react';

/**
 * Form controls with the design's red asterisk on required labels: the kit's FormField (label,
 * asterisk, error line) around a native control drawn like the kit's Input and Select.
 */
const control =
  'w-full min-w-0 rounded-control border bg-surface px-3 py-2 text-sm text-text placeholder:text-muted focus:outline-2 focus:outline-focus disabled:cursor-not-allowed disabled:bg-disabled';
const edge = (error?: string) => (error ? 'border-danger' : 'border-border');

interface Common {
  id: string;
  label: string;
  error?: string;
  hint?: string;
}

export function SelectField({
  id,
  label,
  error,
  hint,
  options,
  placeholder,
  dot,
  required,
  className = '',
  ...props
}: Common &
  SelectHTMLAttributes<HTMLSelectElement> & {
    options: { value: string; label: string }[];
    /** The first, empty choice ("Select a firm"). */
    placeholder?: string;
    /** A colour class for the dot before the chosen value (priority, status). */
    dot?: string;
  }) {
  return (
    <FormField label={label} htmlFor={id} required={required} error={error} hint={hint}>
      <span className="relative block">
        {dot ? (
          <span
            aria-hidden
            className={`pointer-events-none absolute top-1/2 left-3 size-2.5 -translate-y-1/2 rounded-full ${dot}`}
          />
        ) : null}
        <select
          id={id}
          aria-invalid={error ? true : undefined}
          aria-required={required || undefined}
          className={`${control} appearance-none pr-9 ${dot ? 'pl-8' : ''} ${edge(error)} ${className}`}
          {...props}
        >
          {placeholder === undefined ? null : <option value="">{placeholder}</option>}
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <CaretDown
          aria-hidden
          weight="bold"
          className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-muted"
        />
      </span>
    </FormField>
  );
}

export function TextField({
  id,
  label,
  error,
  hint,
  required,
  className = '',
  ...props
}: Common & InputHTMLAttributes<HTMLInputElement>) {
  return (
    <FormField label={label} htmlFor={id} required={required} error={error} hint={hint}>
      <input
        id={id}
        aria-invalid={error ? true : undefined}
        aria-required={required || undefined}
        className={`${control} ${edge(error)} ${className}`}
        {...props}
      />
    </FormField>
  );
}

export function AreaField({
  id,
  label,
  error,
  hint,
  required,
  className = '',
  rows = 4,
  ...props
}: Common & TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <FormField label={label} htmlFor={id} required={required} error={error} hint={hint}>
      <textarea
        id={id}
        rows={rows}
        aria-invalid={error ? true : undefined}
        aria-required={required || undefined}
        className={`${control} ${edge(error)} ${className}`}
        {...props}
      />
    </FormField>
  );
}
