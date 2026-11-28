'use client';

import type { LocationKind } from '@firmivra/types';
import { useState } from 'react';

/** Every query of the client's appointments starts with this key, so one invalidate covers all. */
export const myAppointmentsKey = (slug: string) => ['my-appointments', slug];

export const LOCATION_LABELS: Record<LocationKind, string> = {
  IN_PERSON: 'In person',
  PHONE: 'Phone call',
  VIDEO: 'Video call',
};

/** The portal's appointment error codes (packages/types appointments), in the client's words. */
export const APPOINTMENT_ERRORS: Record<string, string> = {
  SLOT_TAKEN: 'Someone just booked that time. Please pick another one.',
  SLOT_UNAVAILABLE: 'That time is no longer free. Please pick another one.',
  CHANGE_WINDOW_CLOSED:
    'It is too close to the appointment to change it online. Please contact us.',
  APPOINTMENT_CLOSED: 'This appointment can no longer be changed.',
  TYPE_ARCHIVED: 'This kind of appointment is no longer offered.',
  CLIENT_ARCHIVED: 'Your account is closed for new appointments. Please contact us.',
};

/** Someone took the time meanwhile: ask for the free times again. */
export const TAKEN = new Set(['SLOT_TAKEN', 'SLOT_UNAVAILABLE']);

/** The list is out of date: the cutoff passed, or the firm closed or removed the appointment. */
export const STALE = new Set(['CHANGE_WINDOW_CLOSED', 'APPOINTMENT_CLOSED', 'NOT_FOUND']);

export const TIMEZONE_OPTIONS = [
  { value: 'America/New_York', label: 'Eastern Time (ET)', short: 'Eastern' },
  { value: 'America/Chicago', label: 'Central Time (CT)', short: 'Central' },
  { value: 'America/Denver', label: 'Mountain Time (MT)', short: 'Mountain' },
  { value: 'America/Phoenix', label: 'Arizona Time (MST)', short: 'Arizona' },
  { value: 'America/Los_Angeles', label: 'Pacific Time (PT)', short: 'Pacific' },
  { value: 'America/Anchorage', label: 'Alaska Time (AKT)', short: 'Alaska' },
  { value: 'Pacific/Honolulu', label: 'Hawaii Time (HST)', short: 'Hawaii' },
  { value: 'UTC', label: 'Coordinated Universal Time (UTC)', short: 'UTC' },
  { value: 'Europe/London', label: 'London (GMT/BST)', short: 'London' },
  { value: 'Europe/Paris', label: 'Central European (CET)', short: 'Paris' },
] as const;

export function getZoneName(tz?: string): string {
  if (!tz) return '';
  const match = TIMEZONE_OPTIONS.find((t) => t.value === tz);
  if (match) return match.short;
  const map: Record<string, string> = {
    'America/Detroit': 'Eastern',
    'America/Indiana/Indianapolis': 'Eastern',
    'America/North_Dakota/Center': 'Central',
    'America/Boise': 'Mountain',
  };
  if (map[tz]) return map[tz];
  return tz.split('/').pop()?.replace(/_/g, ' ') ?? tz;
}

export function formatTime(iso: string, tz?: string): string {
  const d = new Date(iso);
  const tzOpt: Intl.DateTimeFormatOptions = tz ? { timeZone: tz } : {};
  const mins = d.toLocaleTimeString('en-US', { ...tzOpt, minute: 'numeric' });
  const hasMinutes = mins !== '0';
  return d.toLocaleTimeString('en-US', {
    ...tzOpt,
    hour: 'numeric',
    ...(hasMinutes ? { minute: '2-digit' } : {}),
  });
}

export function formatDateInZone(iso: string, tz?: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', {
    ...(tz ? { timeZone: tz } : {}),
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
}

/** A date ('YYYY-MM-DD') in the client's time zone. */
export const dayOf = (date: Date, tz?: string) =>
  new Intl.DateTimeFormat('en-CA', tz ? { timeZone: tz } : {}).format(date);

/** Today's date ('YYYY-MM-DD') in the client's time zone. */
export const today = (tz?: string) => dayOf(new Date(), tz);

/**
 * Times are shown in the client's own time zone, or dual timezone when firm and client differ.
 * (e.g. "11 AM Central firm / 12 PM Eastern client").
 */
export const when = (iso: string, clientTz?: string, firmTz?: string) => {
  if (firmTz && clientTz && firmTz !== clientTz) {
    const firmDate = dayOf(new Date(iso), firmTz);
    const clientDate = dayOf(new Date(iso), clientTz);
    if (firmDate !== clientDate) {
      return `${formatDateInZone(iso, firmTz)} ${formatTime(iso, firmTz)} ${getZoneName(firmTz)} firm / ${formatDateInZone(iso, clientTz)} ${formatTime(iso, clientTz)} ${getZoneName(clientTz)} client`;
    }
    return `${formatDateInZone(iso, clientTz)} · ${formatTime(iso, firmTz)} ${getZoneName(firmTz)} firm / ${formatTime(iso, clientTz)} ${getZoneName(clientTz)} client`;
  }
  const tz = clientTz || firmTz;
  const d = new Date(iso);
  return d.toLocaleString('en-US', {
    ...(tz ? { timeZone: tz } : {}),
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
  });
};

/**
 * The first day free times are offered for: the client's yesterday, because the firm's today can
 * still be that day (the API leaves out times that have passed).
 */
export const firstDay = (clientToday: string) =>
  new Date(Date.parse(`${clientToday}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);

/**
 * A free time on the firm's `day`, in the client's time zone. A time that falls on another of the
 * client's days says which ("Tue 1:00 AM").
 */
export const slotLabel = (iso: string, day: string, tz?: string) =>
  new Date(iso).toLocaleString('en-US', {
    ...(tz ? { timeZone: tz } : {}),
    ...(dayOf(new Date(iso), tz) === day ? {} : { weekday: 'short' }),
    hour: 'numeric',
    minute: '2-digit',
  });

/** The date tile of a row: 'OCT', '15', 'Thu', in the client's time zone. */
export const dateTile = (iso: string, tz?: string) => {
  const date = new Date(iso);
  const options: Intl.DateTimeFormatOptions = tz ? { timeZone: tz } : {};
  return {
    month: date.toLocaleString('en-US', { ...options, month: 'short' }).toUpperCase(),
    day: date.toLocaleString('en-US', { ...options, day: 'numeric' }),
    weekday: date.toLocaleString('en-US', { ...options, weekday: 'short' }),
  };
};

/**
 * '10:00 AM – 10:30 AM EDT', in the client's time zone, or dual timezone when firm and client differ.
 * (e.g. "11 AM – 11:30 AM Central firm / 12 PM – 12:30 PM Eastern client").
 */
export const timeRange = (startsAt: string, endsAt: string, clientTz?: string, firmTz?: string) => {
  if (firmTz && clientTz && firmTz !== clientTz) {
    const firmDate = dayOf(new Date(startsAt), firmTz);
    const clientDate = dayOf(new Date(startsAt), clientTz);
    const firmPart = `${formatTime(startsAt, firmTz)} – ${formatTime(endsAt, firmTz)} ${getZoneName(firmTz)} firm`;
    const clientPart = `${formatTime(startsAt, clientTz)} – ${formatTime(endsAt, clientTz)} ${getZoneName(clientTz)} client`;
    if (firmDate !== clientDate) {
      return `${formatDateInZone(startsAt, firmTz)} ${firmPart} / ${formatDateInZone(startsAt, clientTz)} ${clientPart}`;
    }
    return `${firmPart} / ${clientPart}`;
  }
  const tz = clientTz || firmTz;
  const time = (iso: string, zone: boolean) =>
    new Date(iso).toLocaleString('en-US', {
      ...(tz ? { timeZone: tz } : {}),
      hour: 'numeric',
      minute: '2-digit',
      ...(zone ? { timeZoneName: 'short' } : {}),
    });
  return `${time(startsAt, false)} – ${time(endsAt, true)}`;
};

const STORAGE_KEY = (slug: string) => `firmivra_portal_tz_${slug}`;

export function getStoredTimezone(slug: string, defaultTz: string): string {
  if (typeof window === 'undefined') return defaultTz;
  try {
    const stored = localStorage.getItem(STORAGE_KEY(slug));
    if (stored) return stored;
    return Intl.DateTimeFormat().resolvedOptions().timeZone || defaultTz;
  } catch {
    return defaultTz;
  }
}

export function setStoredTimezone(slug: string, tz: string): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY(slug), tz);
  } catch {
    // ignore
  }
}

export function usePortalTimezone(slug: string, firmTimezone?: string) {
  const defaultTz = firmTimezone || 'America/New_York';
  const [clientTimezone, setClientTimezone] = useState(() => getStoredTimezone(slug, defaultTz));

  const updateClientTimezone = (tz: string) => {
    setClientTimezone(tz);
    setStoredTimezone(slug, tz);
  };

  return { clientTimezone, setClientTimezone: updateClientTimezone, firmTimezone: defaultTz };
}

export function TimezoneSelector({
  value,
  onChange,
  firmTimezone,
  className = '',
}: {
  value: string;
  onChange: (tz: string) => void;
  firmTimezone?: string;
  className?: string;
}) {
  const options: { value: string; label: string; short: string }[] = [...TIMEZONE_OPTIONS];
  if (firmTimezone && !options.some((o) => o.value === firmTimezone)) {
    options.unshift({
      value: firmTimezone,
      label: `${getZoneName(firmTimezone)} (${firmTimezone})`,
      short: getZoneName(firmTimezone),
    });
  }

  return (
    <div className={`flex items-center gap-2 text-sm ${className}`} data-testid="timezone-selector">
      <label
        htmlFor="portal-timezone-select"
        className="font-medium text-heading whitespace-nowrap"
      >
        Timezone:
      </label>
      <select
        id="portal-timezone-select"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="rounded-control border border-border bg-surface px-2.5 py-1 text-sm text-text focus:border-firm-primary focus:outline-none"
      >
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
            {opt.value === firmTimezone ? ' (Firm)' : ''}
          </option>
        ))}
      </select>
    </div>
  );
}
