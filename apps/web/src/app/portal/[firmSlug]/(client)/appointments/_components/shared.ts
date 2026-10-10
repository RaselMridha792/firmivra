import type { LocationKind } from '@firmivra/types';

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

/**
 * Times are shown in the client's own time zone, with its short name ("10:00 AM EDT"). Free times
 * are asked for by the firm's calendar dates, which can differ from the client's.
 */
export const when = (iso: string) =>
  new Date(iso).toLocaleString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
  });

/** A date ('YYYY-MM-DD') in the client's time zone. */
const dayOf = (date: Date) => new Intl.DateTimeFormat('en-CA').format(date);

/** Today's date ('YYYY-MM-DD') in the client's time zone. */
export const today = () => dayOf(new Date());

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
export const slotLabel = (iso: string, day: string) =>
  new Date(iso).toLocaleString('en-US', {
    ...(dayOf(new Date(iso)) === day ? {} : { weekday: 'short' }),
    hour: 'numeric',
    minute: '2-digit',
  });

/** The date tile of a row: 'OCT', '15', 'Thu', in the client's time zone. */
export const dateTile = (iso: string) => {
  const date = new Date(iso);
  return {
    month: date.toLocaleString('en-US', { month: 'short' }).toUpperCase(),
    day: date.toLocaleString('en-US', { day: 'numeric' }),
    weekday: date.toLocaleString('en-US', { weekday: 'short' }),
  };
};

/** '10:00 AM – 10:30 AM EDT', in the client's time zone. */
export const timeRange = (startsAt: string, endsAt: string) => {
  const time = (iso: string, zone: boolean) =>
    new Date(iso).toLocaleString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      ...(zone ? { timeZoneName: 'short' } : {}),
    });
  return `${time(startsAt, false)} – ${time(endsAt, true)}`;
};
