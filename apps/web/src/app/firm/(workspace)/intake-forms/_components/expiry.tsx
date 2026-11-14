'use client';

import { Input, Select } from '@firmivra/ui';
import { useId, useState } from 'react';
import { api } from '../../../../../lib/api';
import { useApiQuery } from '../../../../../lib/query';
import { addDays, localParts, toInstant } from '../../calendar/_components/time';

/**
 * Intake Forms Review Two, INTAKE-EXPIRY-01: a form's expiration is an exact time in the firm's
 * time zone. Default uses the form's own setting (else the firm's) and ends at 11:59 PM that day;
 * a chosen date and time must be later than now; Never means the form does not expire.
 */
export type ExpiryMode = 'DEFAULT' | 'AT' | 'NONE';
export interface Expiry {
  mode: ExpiryMode;
  /** YYYY-MM-DD and HH:MM in the firm's time zone, for AT. */
  date: string;
  time: string;
}

export const NO_EXPIRY_CHOICE: Expiry = { mode: 'DEFAULT', date: '', time: '23:59' };
export const LATER_THAN_NOW = 'Choose an expiration date and time later than now.';

/** The firm's time zone (every role may read it), or undefined while it loads. */
export function useFirmTimeZone(): string | undefined {
  const availability = useApiQuery(['availability'], () => api.availability.get());
  return availability.data?.timezone;
}

/** "Nov 29, 2026, 11:59 PM EST", or "No expiration". */
export function expiryText(iso: string | null, timeZone: string | undefined): string {
  if (!iso) return 'No expiration';
  return new Intl.DateTimeFormat('en-US', {
    timeZone,
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
  }).format(new Date(iso));
}

/** The default's exact time: the end of the day `days` after today, in the zone. */
export function defaultExpiry(days: number, timeZone: string, now = new Date()): string {
  const today = localParts(now.toISOString(), timeZone).date;
  return toInstant(addDays(today, days), '23:59', timeZone);
}

/** The request's part: nothing (the default), null (never) or the exact time. */
export function expiryBody(e: Expiry, timeZone: string): { expiresAt?: string | null } {
  if (e.mode === 'DEFAULT') return {};
  if (e.mode === 'NONE') return { expiresAt: null };
  return { expiresAt: toInstant(e.date, e.time || '23:59', timeZone) };
}

/** What is wrong with a chosen time, before sending: the same words as the API. */
export function expiryError(
  e: Expiry,
  timeZone: string | undefined,
  dueOn = '',
  now = new Date(),
): string | undefined {
  if (e.mode !== 'AT') return undefined;
  if (!e.date) return 'Choose an expiration date';
  if (!timeZone) return undefined;
  if (Date.parse(toInstant(e.date, e.time || '23:59', timeZone)) <= now.getTime())
    return LATER_THAN_NOW;
  if (dueOn && e.date < dueOn) return 'Choose an expiration on or after the due date';
  return undefined;
}

/** A saved expiration, as the picker's choice (for Extend Expiration). */
export function expiryFrom(iso: string | null, timeZone: string): Expiry {
  if (!iso) return { mode: 'NONE', date: '', time: '23:59' };
  const at = localParts(iso, timeZone);
  return { mode: 'AT', date: at.date, time: at.time };
}

/**
 * The expiration picker: Default (with its exact time when the days are known), a date and time
 * in the firm's time zone, or Never. `defaultDays`: the form's own (null: it never expires),
 * undefined while unknown. `allowDefault` false for Extend Expiration.
 */
export function ExpiryField({
  value,
  onChange,
  error,
  defaultDays,
  allowDefault = true,
  label = 'Expiration',
}: {
  value: Expiry;
  onChange: (value: Expiry) => void;
  error: string | undefined;
  defaultDays?: number | null;
  allowDefault?: boolean;
  label?: string;
}) {
  const timeZone = useFirmTimeZone();
  const hintId = useId();
  const [now] = useState(() => new Date());
  const zone = timeZone
    ? (new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'long' })
        .formatToParts(now)
        .find((p) => p.type === 'timeZoneName')?.value ?? timeZone)
    : 'the firm’s time zone';
  const defaultLabel =
    defaultDays === undefined
      ? 'Default (the form’s setting)'
      : defaultDays === null
        ? 'Default (this form never expires)'
        : `Default (${defaultDays} days after sending)`;
  const defaultAt =
    defaultDays && timeZone
      ? expiryText(defaultExpiry(defaultDays, timeZone, now), timeZone)
      : null;
  return (
    <div className="flex min-w-0 flex-col gap-2" data-testid="expiry-field">
      <Select
        label={label}
        value={value.mode}
        aria-describedby={hintId}
        onChange={(event) => {
          const mode = event.target.value as ExpiryMode;
          onChange({ ...value, mode, time: value.time || '23:59' });
        }}
        options={[
          ...(allowDefault ? [{ value: 'DEFAULT', label: defaultLabel }] : []),
          { value: 'AT', label: 'On a date and time' },
          { value: 'NONE', label: 'Never expires' },
        ]}
      />
      {value.mode === 'AT' ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <Input
            label="Expiration date"
            type="date"
            value={value.date}
            error={error}
            onChange={(event) => onChange({ ...value, date: event.target.value })}
          />
          <Input
            label="Expiration time"
            type="time"
            value={value.time}
            onChange={(event) => onChange({ ...value, time: event.target.value })}
          />
        </div>
      ) : error ? (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}
      <p id={hintId} className="text-xs text-muted">
        {value.mode === 'DEFAULT'
          ? defaultAt
            ? `Expires ${defaultAt}. `
            : ''
          : value.mode === 'NONE'
            ? 'The form stays open until it is submitted or archived. '
            : ''}
        Times are in {zone}.
      </p>
    </div>
  );
}
