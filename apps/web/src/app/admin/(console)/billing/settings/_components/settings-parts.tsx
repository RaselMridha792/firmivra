'use client';

import { Checkbox, Radio, Skeleton, Toggle } from '@firmivra/ui';
import { createContext, use, useId, type ReactNode } from 'react';
import type { AdminRole, BillingSettings } from '../../../../../../mocks/admin-billing';
import { inputClass } from '../../_components/billing-fields';
import { QuietLine, quietErrorText } from '../../_components/billing-parts';
import type { SectionKey } from './settings-model';

/** The cards, rows and fields every Billing Settings tab is built from. */

/** What a tab gets to show and change the unsaved settings. */
export interface SettingsForm {
  value: BillingSettings;
  /** Field messages by path ("general.estimateValidityDays"), after a save was tried. */
  errors: Partial<Record<string, string>>;
  /** The signed-in admin's role, when known (Payments shows who may refund). */
  myRole: AdminRole | null;
  /** Replaces part of one section in the draft. */
  patch: <K extends SectionKey>(key: K, value: Partial<BillingSettings[K]>) => void;
}

/** Whether the settings are loading, failed to load, or ready; every card reads it. */
export interface SettingsStatus {
  state: 'loading' | 'failed' | 'ready';
  error?: unknown;
}
export const SettingsStatusContext = createContext<SettingsStatus>({ state: 'loading' });

/**
 * One settings card: navy title, a muted line under it, and the fields. While loading it shows
 * skeletons, and when the settings could not load a quiet line; the frame always stays.
 */
export function SettingsCard({
  title,
  description,
  action,
  children,
  testId,
}: {
  title: string;
  description?: string;
  /** A button on the right of the title ("Add Tax Rate"). */
  action?: ReactNode;
  children?: ReactNode;
  testId?: string;
}) {
  const status = use(SettingsStatusContext);
  const headingId = useId();
  return (
    <section
      aria-labelledby={headingId}
      data-testid={testId}
      className="min-w-0 rounded-lg bg-surface px-4 py-4 shadow-sm md:px-5"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 id={headingId} className="text-lg font-bold text-heading">
            {title}
          </h2>
          {description ? <p className="text-sm text-muted">{description}</p> : null}
        </div>
        {status.state === 'ready' ? action : null}
      </div>
      <div className="mt-4">
        {status.state === 'ready' ? (
          children
        ) : status.state === 'loading' ? (
          <div role="status" aria-label={`Loading ${title}`} className="grid gap-3 sm:grid-cols-2">
            <Skeleton className="h-11" />
            <Skeleton className="h-11" />
          </div>
        ) : (
          <QuietLine testId="settings-error">{quietErrorText(status.error)}</QuietLine>
        )}
      </div>
    </section>
  );
}

/** A switch with its title and the line under it (Global Billing Options). */
export function ToggleRow({
  label,
  description,
  checked,
  onChange,
  disabled,
}: {
  label: string;
  description?: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
}) {
  const id = useId();
  return (
    <div className="flex items-start gap-4">
      <Toggle
        id={id}
        label={label}
        checked={checked}
        onChange={onChange}
        disabled={disabled}
        aria-describedby={description ? `${id}-note` : undefined}
      />
      <div className="flex min-w-0 flex-col">
        <label htmlFor={id} className="text-sm font-medium text-heading">
          {label}
        </label>
        {description ? (
          <p id={`${id}-note`} className="text-sm text-muted">
            {description}
          </p>
        ) : null}
      </div>
    </div>
  );
}

/** A number input; an empty field gives NaN, which the checks turn into a message. */
export function NumberControl({
  value,
  onValue,
  invalid,
  suffix,
  className = '',
  ...props
}: {
  id?: string;
  value: number;
  onValue: (value: number) => void;
  invalid?: boolean;
  /** "days", "%", "MB" after the number. */
  suffix?: string;
  min?: number;
  max?: number;
  step?: number | 'any';
  disabled?: boolean;
  className?: string;
  'aria-label'?: string;
  'aria-describedby'?: string;
}) {
  return (
    <div className={`flex min-w-0 items-center gap-2 ${className}`}>
      <input
        type="number"
        inputMode="decimal"
        value={Number.isNaN(value) ? '' : value}
        aria-invalid={invalid || undefined}
        onChange={(event) =>
          onValue(event.target.value === '' ? Number.NaN : Number(event.target.value))
        }
        className={inputClass(invalid)}
        {...props}
      />
      {suffix ? <span className="shrink-0 text-sm text-muted">{suffix}</span> : null}
    </div>
  );
}

/** A dollar amount stored in cents ("$25.00" ↔ 2500). */
export function MoneyControl({
  cents,
  onCents,
  invalid,
  ...props
}: {
  id?: string;
  cents: number;
  onCents: (cents: number) => void;
  invalid?: boolean;
  disabled?: boolean;
  'aria-label'?: string;
}) {
  return (
    <div className="relative min-w-0">
      <span
        aria-hidden
        className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-base text-muted"
      >
        $
      </span>
      <input
        type="number"
        inputMode="decimal"
        min={0}
        step={0.01}
        value={Number.isNaN(cents) ? '' : cents / 100}
        aria-invalid={invalid || undefined}
        onChange={(event) =>
          onCents(
            event.target.value === '' ? Number.NaN : Math.round(Number(event.target.value) * 100),
          )
        }
        className={`${inputClass(invalid)} pl-7`}
        {...props}
      />
    </div>
  );
}

/** A group of checkboxes with one legend and one message (payment methods, file types). */
export function CheckboxGroup<T extends string>({
  legend,
  options,
  value,
  onChange,
  error,
  hint,
  disabled,
  columns = 'sm:grid-cols-2 xl:grid-cols-3',
}: {
  legend: string;
  options: readonly { value: T; label: string }[];
  value: readonly T[];
  onChange: (next: T[]) => void;
  error?: string;
  hint?: string;
  disabled?: boolean;
  columns?: string;
}) {
  const id = useId();
  return (
    <fieldset
      disabled={disabled}
      aria-describedby={error || hint ? `${id}-note` : undefined}
      className="flex min-w-0 flex-col gap-1"
    >
      <legend className="mb-1 text-sm font-medium text-text">{legend}</legend>
      <div className={`grid gap-x-6 ${columns}`}>
        {options.map((option) => (
          <Checkbox
            key={option.value}
            label={option.label}
            checked={value.includes(option.value)}
            onChange={(event) =>
              onChange(
                event.target.checked
                  ? options
                      .map((row) => row.value)
                      .filter((v) => v === option.value || value.includes(v))
                  : value.filter((v) => v !== option.value),
              )
            }
          />
        ))}
      </div>
      {error || hint ? (
        <p id={`${id}-note`} className={`text-xs ${error ? 'text-danger' : 'text-muted'}`}>
          {error ?? hint}
        </p>
      ) : null}
    </fieldset>
  );
}

/** A radio group with a legend (the kit's Radio, one name per group). */
export function RadioGroup<T extends string>({
  legend,
  options,
  value,
  onChange,
}: {
  legend: string;
  options: readonly { value: T; label: string }[];
  value: T;
  onChange: (next: T) => void;
}) {
  const groupId = useId();
  return (
    <fieldset className="flex min-w-0 flex-col">
      <legend className="mb-1 text-sm font-medium text-text">{legend}</legend>
      {options.map((option) => (
        <Radio
          key={option.value}
          name={groupId}
          label={option.label}
          value={option.value}
          checked={value === option.value}
          onChange={() => onChange(option.value)}
        />
      ))}
    </fieldset>
  );
}
