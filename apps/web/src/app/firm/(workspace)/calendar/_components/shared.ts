import type { LocationKind } from '@firmivra/types';

/**
 * Query keys under one root: a change to hours, blocks or appointments invalidates CALENDAR, so the
 * free times (under APPOINTMENTS) never outlive the availability they came from.
 */
export const CALENDAR = ['calendar'];
export const AVAILABILITY = [...CALENDAR, 'availability'];
export const APPOINTMENTS = [...CALENDAR, 'appointments'];

export const LOCATION_LABELS: Record<LocationKind, string> = {
  IN_PERSON: 'In person',
  PHONE: 'Phone',
  VIDEO: 'Video',
};

/** The appointment module's error codes (packages/types appointments), in plain words. */
/** Someone else changed or removed the appointment: reload it instead of offering actions. */
export const GONE = new Set(['APPOINTMENT_CLOSED', 'NOT_FOUND']);

export const CALENDAR_ERRORS: Record<string, string> = {
  SLOT_TAKEN: 'Someone else just took this time. Pick another one.',
  APPOINTMENT_CLOSED: 'This appointment is no longer scheduled.',
  TYPE_ARCHIVED: 'This appointment type is archived. Choose another one.',
  CLIENT_ARCHIVED: 'This client is archived.',
  BLOCKS_APPOINTMENT: 'An appointment is booked in that time. Move or cancel it first.',
  BLOCK_LIMIT: 'This calendar has too many upcoming blocks. Remove some first.',
  RATE_LIMITED: 'The calendar is busy with another change. Try again in a moment.',
};
