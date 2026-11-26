'use client';

import { api } from './api';
import { useApiQuery } from './query';

/**
 * Dashboard and Audit Log Review 2, R01 ("consistently across the system"): times shown in the
 * firm's time zone with the zone named, whatever the viewer's computer is set to. The zone is the
 * one the header clock reads (the shared `availability` query, so one request for the whole
 * workspace). Until it arrives, and if it can't be read, the device's zone is used and still
 * named. Stored times stay UTC.
 */
export function useFirmZone(): string | undefined {
  return useApiQuery(['availability'], () => api.availability.get()).data?.timezone;
}

const parts = (zone: string | undefined, o: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat('en-US', { ...(zone ? { timeZone: zone } : {}), ...o });

/** A moment as "Nov 15, 2026, 2:50 PM CST" in `zone`. */
export const zonedWhen = (iso: string, zone: string | undefined): string =>
  parts(zone, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
  }).format(new Date(iso));

/** The day of a moment in `zone`, as "Nov 15, 2026". */
export const zonedDay = (iso: string, zone: string | undefined): string =>
  parts(zone, { month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(iso));

/** Numeric calendar parts for a moment in `zone`, without parsing a locale-formatted date string. */
export const zonedDateParts = (iso: string, zone: string | undefined) => {
  const values = Object.fromEntries(
    parts(zone, { year: 'numeric', month: 'numeric', day: 'numeric' })
      .formatToParts(new Date(iso))
      .map(({ type, value }) => [type, value]),
  );
  return { year: Number(values.year), month: Number(values.month), day: Number(values.day) };
};

/** The time of a moment in `zone` with the zone named: "2:50 PM CST". */
export const zonedTime = (iso: string, zone: string | undefined): string =>
  parts(zone, { hour: 'numeric', minute: '2-digit', timeZoneName: 'short' }).format(new Date(iso));

/** Compare calendar days in the firm's zone rather than the viewer's browser zone. */
export const zonedDayKey = (iso: string, zone: string | undefined): string =>
  new Intl.DateTimeFormat('en-CA', {
    ...(zone ? { timeZone: zone } : {}),
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(iso));
