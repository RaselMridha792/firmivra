import type { LocationKind } from '@firmivra/types';

/** Query keys: every appointment query starts with APPOINTMENTS, so one invalidate covers all. */
export const AVAILABILITY = ['availability'];
export const APPOINTMENTS = ['appointments'];

export const LOCATION_LABELS: Record<LocationKind, string> = {
  IN_PERSON: 'In person',
  PHONE: 'Phone',
  VIDEO: 'Video',
};

/** The appointment module's error codes (packages/types appointments), in plain words. */
export const CALENDAR_ERRORS: Record<string, string> = {
  SLOT_TAKEN: 'Someone else just took this time. Pick another one.',
  APPOINTMENT_CLOSED: 'This appointment is no longer scheduled.',
  TYPE_ARCHIVED: 'This appointment type is archived. Choose another one.',
  CLIENT_ARCHIVED: 'This client is archived.',
  BLOCKS_APPOINTMENT: 'An appointment is booked in that time. Move or cancel it first.',
  BLOCK_LIMIT: 'This calendar has too many upcoming blocks. Remove some first.',
  RATE_LIMITED: 'The calendar is busy with another change. Try again in a moment.',
};
