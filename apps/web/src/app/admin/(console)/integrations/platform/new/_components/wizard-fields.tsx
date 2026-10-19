'use client';

import { FormField, Radio } from '@firmivra/ui';
import { CaretDown, Eye, EyeSlash, LinkSimple, WarningCircle } from '@phosphor-icons/react';
import {
  useState,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react';

/**
 * The wizard's form controls, with the setup design's red asterisk on required labels: the kit's
 * FormField (label, asterisk, hint or error, counter) around a native control drawn like the
 * kit's Input and Select. Plus the error summary at the top of a step (docx §14: inline messages,
 * a summary, and focus on the first invalid field).
 */

const control =
  'w-full min-w-0 rounded-control border bg-surface px-3 py-2 text-sm text-text placeholder:text-muted focus:outline-2 focus:outline-focus disabled:cursor-not-allowed disabled:bg-disabled';
const edge = (error?: string) => (error ? 'border-danger' : 'border-border');

interface Common {
  id: string;
  label: string;
  error?: string;
  hint?: string;
  required?: boolean;
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

/** A text area with the design's "0/250" count under its right edge. */
export function AreaField({
  id,
  label,
  error,
  hint,
  required,
  value,
  maxLength,
  rows = 3,
  ...props
}: Common & TextareaHTMLAttributes<HTMLTextAreaElement> & { value: string; maxLength: number }) {
  return (
    <FormField
      label={label}
      htmlFor={id}
      required={required}
      error={error}
      hint={hint}
      counter={`${value.length}/${maxLength}`}
    >
      <textarea
        id={id}
        rows={rows}
        value={value}
        maxLength={maxLength}
        aria-invalid={error ? true : undefined}
        aria-required={required || undefined}
        className={`${control} ${edge(error)} resize-y`}
        {...props}
      />
    </FormField>
  );
}

export function SelectField({
  id,
  label,
  error,
  hint,
  required,
  options,
  placeholder,
  ...props
}: Common &
  SelectHTMLAttributes<HTMLSelectElement> & {
    options: { value: string; label: string }[];
    /** The first, empty choice ("Select category"). */
    placeholder?: string;
  }) {
  return (
    <FormField label={label} htmlFor={id} required={required} error={error} hint={hint}>
      <span className="relative block">
        <select
          id={id}
          aria-invalid={error ? true : undefined}
          aria-required={required || undefined}
          className={`${control} appearance-none pr-9 ${edge(error)}`}
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

/** An address field with the design's link mark inside it. */
export function UrlField({
  id,
  label,
  error,
  hint,
  required,
  ...props
}: Common & InputHTMLAttributes<HTMLInputElement>) {
  return (
    <FormField label={label} htmlFor={id} required={required} error={error} hint={hint}>
      <span className="relative block">
        <LinkSimple
          aria-hidden
          weight="fill"
          className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted"
        />
        <input
          id={id}
          type="url"
          inputMode="url"
          autoComplete="off"
          spellCheck={false}
          aria-invalid={error ? true : undefined}
          aria-required={required || undefined}
          className={`${control} pl-9 ${edge(error)}`}
          {...props}
        />
      </span>
    </FormField>
  );
}

/**
 * A write-only secret (docx §4: never returned after save). It starts empty; the saved value is
 * only named by its masked hint, and an empty box keeps it. The eye shows what is being typed.
 */
export function SecretField({
  id,
  label,
  error,
  hint,
  required,
  ...props
}: Common & Omit<InputHTMLAttributes<HTMLInputElement>, 'type'>) {
  const [visible, setVisible] = useState(false);
  return (
    <FormField label={label} htmlFor={id} required={required} error={error} hint={hint}>
      <span className="relative block">
        <input
          id={id}
          type={visible ? 'text' : 'password'}
          autoComplete="new-password"
          spellCheck={false}
          aria-invalid={error ? true : undefined}
          aria-required={required || undefined}
          className={`${control} pr-11 font-mono ${edge(error)}`}
          {...props}
        />
        <button
          type="button"
          aria-label={`${visible ? 'Hide' : 'Show'} ${label}`}
          aria-pressed={visible}
          aria-controls={id}
          disabled={props.disabled}
          onClick={() => setVisible((on) => !on)}
          className="absolute top-1/2 right-1 inline-flex size-9 -translate-y-1/2 items-center justify-center rounded-md text-muted hover:text-action disabled:cursor-not-allowed"
        >
          {visible ? (
            <EyeSlash aria-hidden weight="fill" className="size-4.5" />
          ) : (
            <Eye aria-hidden weight="fill" className="size-4.5" />
          )}
        </button>
      </span>
    </FormField>
  );
}

/** A labelled group of radios (environment, data access, exposure), one hint under each choice. */
export function ChoiceGroup<T extends string>({
  name,
  legend,
  value,
  options,
  onChange,
  required,
  hint,
  error,
  disabled,
  idPrefix,
}: {
  name: string;
  legend: string;
  value: T;
  options: { value: T; label: string; hint?: string }[];
  onChange: (value: T) => void;
  required?: boolean;
  hint?: ReactNode;
  error?: string;
  disabled?: boolean;
  /** Each radio's id is `${idPrefix}-${value}`, so a summary can focus the chosen one. */
  idPrefix: string;
}) {
  return (
    <fieldset className="flex min-w-0 flex-col gap-1" aria-invalid={error ? true : undefined}>
      <legend className="mb-1 text-sm font-medium text-text">
        {legend}
        {required ? <span className="text-danger"> *</span> : null}
      </legend>
      {options.map((option) => (
        <div key={option.value} className="flex flex-col">
          <Radio
            id={`${idPrefix}-${option.value}`}
            name={name}
            label={option.label}
            checked={value === option.value}
            disabled={disabled}
            onChange={() => onChange(option.value)}
            className="text-text"
          />
          {option.hint ? <p className="-mt-2 pl-7 text-xs text-muted">{option.hint}</p> : null}
        </div>
      ))}
      {error ? (
        <p className="text-xs text-danger">{error}</p>
      ) : hint ? (
        <p className="text-xs text-muted">{hint}</p>
      ) : null}
    </fieldset>
  );
}

export interface FieldError {
  /** The control's id: the summary focuses it. */
  id: string;
  message: string;
}

/** "Fix 2 fields to continue": each message focuses its field (docx §14). */
export function ErrorSummary({ errors }: { errors: FieldError[] }) {
  if (!errors.length) return null;
  return (
    <div
      role="alert"
      data-testid="wizard-errors"
      className="flex gap-3 rounded-lg bg-danger-soft p-4 text-sm text-danger"
    >
      <WarningCircle aria-hidden weight="fill" className="mt-0.5 size-5 shrink-0" />
      <div className="flex min-w-0 flex-col gap-1">
        <p className="font-semibold">
          Fix {errors.length === 1 ? 'this field' : `these ${errors.length} fields`} to continue:
        </p>
        <ul className="list-disc pl-5">
          {errors.map((error) => (
            <li key={error.id}>
              <button
                type="button"
                className="text-left underline hover:no-underline"
                onClick={() => document.getElementById(error.id)?.focus()}
              >
                {error.message}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

/** Focuses the first invalid field after a submit (docx §14). */
export function focusFirst(errors: FieldError[]) {
  const first = errors[0];
  if (first) document.getElementById(first.id)?.focus();
}

/** An https address, or the mock's own message (mocks/admin-integrations.ts `cleanUrl`). */
export function urlProblem(value: string, label: string): string | null {
  const text = value.trim();
  if (!text) return null;
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return `Enter the ${label} as a full address (https://…).`;
  }
  if (url.protocol !== 'https:') return `The ${label} must start with https://.`;
  if (url.username || url.password) return `The ${label} cannot contain a user name.`;
  return null;
}
