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

/**
 * Times are shown in the client's own time zone, with its short name ("10:00 AM EDT"): the
 * portal has no firm time zone to show. Free times are for the firm's calendar dates.
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

export const clock = (iso: string) =>
  new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });

/** Today's date ('YYYY-MM-DD') in the client's time zone. */
export const today = () => new Intl.DateTimeFormat('en-CA').format(new Date());
