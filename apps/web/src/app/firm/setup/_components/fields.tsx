'use client';

import { Input } from '@firmivra/ui';
import { type ComponentProps, useId, useSyncExternalStore } from 'react';
import type { StepForm } from './step-form';

const HEX = /^#[0-9a-f]{6}$/i;

/** A labelled multi-line field, styled like Input (the UI kit has no textarea yet). */
export function TextArea({
  label,
  error,
  id,
  ...props
}: ComponentProps<'textarea'> & { label: string; error?: string }) {
  const generatedId = useId();
  const fieldId = id ?? generatedId;
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={fieldId} className="text-sm font-medium text-text">
        {label}
      </label>
      <textarea
        id={fieldId}
        rows={4}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${fieldId}-error` : undefined}
        className={`rounded-control border bg-surface px-3 py-2 text-base text-text focus:outline-2 focus:outline-accent-500 ${error ? 'border-danger' : 'border-border'}`}
        {...props}
      />
      {error ? (
        <p id={`${fieldId}-error`} className="text-xs text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}

const noSubscription = () => () => {};

/** A portal colour: type a HEX value or pick one. Blank keeps Firmivra's default. */
export function ColorField({
  form,
  name,
  label,
}: {
  form: StepForm;
  name: 'primaryColor' | 'accentColor';
  label: string;
}) {
  const value = form.watch(name) ?? '';
  // The picker needs a colour: blank shows the default from the theme tokens.
  const token = name === 'primaryColor' ? '--color-firm-primary' : '--color-firm-accent';
  const fallback = useSyncExternalStore(
    noSubscription,
    () => getComputedStyle(document.documentElement).getPropertyValue(token).trim(),
    () => '',
  );
  return (
    <div className="flex items-end gap-2">
      <div className="min-w-0 flex-1">
        <Input
          label={label}
          placeholder="Firmivra default"
          error={form.formState.errors[name]?.message}
          {...form.register(name)}
        />
      </div>
      <input
        type="color"
        aria-label={`Pick the ${label.toLowerCase()}`}
        value={(HEX.test(value) ? value : fallback).toLowerCase()}
        onChange={(event) =>
          form.setValue(name, event.target.value, { shouldDirty: true, shouldValidate: true })
        }
        className="size-11 shrink-0 cursor-pointer rounded-control border border-border bg-surface p-1"
      />
    </div>
  );
}
