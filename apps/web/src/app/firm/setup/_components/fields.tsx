'use client';

import { Input } from '@firmivra/ui';
import { useSyncExternalStore } from 'react';
import type { StepForm } from './step-form';

const HEX = /^#[0-9a-f]{6}$/i;

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
