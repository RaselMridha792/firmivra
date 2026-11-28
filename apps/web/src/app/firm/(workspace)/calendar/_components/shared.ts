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

/**
 * Every appointment and scheduling code in plain words (Appointments live check P4: a code with
 * no words read "Something went wrong"). Each appointment screen spreads these under its own.
 */
export const CALENDAR_ERRORS: Record<string, string> = {
  SLOT_TAKEN: 'Someone else just took this time. Pick another one.',
  SLOT_UNAVAILABLE: 'This time is no longer free. Pick another one.',
  CHANGE_WINDOW_CLOSED: 'It is too close to the appointment to change it online.',
  APPOINTMENT_CLOSED: 'This appointment is no longer scheduled.',
  APPOINTMENT_NOT_STARTED:
    'This appointment has not started yet. You can mark it as a no show once it starts.',
  TYPE_ARCHIVED: 'This appointment type is archived. Choose another one.',
  CLIENT_ARCHIVED: 'This client is archived.',
  BLOCKS_APPOINTMENT: 'An appointment is booked in that time. Move or cancel it first.',
  BLOCK_LIMIT: 'This calendar has too many upcoming blocks. Remove some first.',
  NOTHING_FREE: 'Every minute of that time is already booked, so nothing was blocked.',
  DUPLICATE_NAME: 'That name is already in use. Choose another one.',
  CUTOFF_NOT_SUPPORTED: 'The cancellation cutoff can only be 24 hours for now.',
  MEETING_LINKS_UNAVAILABLE: 'Meeting links cannot be saved yet.',
  SCHEDULING_CONFLICT: 'This time conflicts with the staff member’s calendar.',
  SAVE_CONFLICT:
    'Someone saved this appointment while you were editing. Reload to see their changes, then make yours again.',
  VIDEO_NOT_CONNECTED:
    'No video integration is connected, so a Zoom link cannot be made. Paste a link instead.',
  VIDEO_LINK_MISSING:
    'The staff member has no meeting link yet, so Generate Zoom Link has nothing to add. Paste a link, or add theirs in Settings > Availability.',
  SMS_UNAVAILABLE: 'Text reminders are not available for this firm or this contact.',
  SMS_STOPPED: 'This client has opted out of text messages, so no text reminder was sent.',
  LEAD_APPOINTMENT: 'This appointment is for a lead. Convert the lead to a client first.',
  OFFER_TAKEN: 'That time was taken since it was offered.',
  RATE_LIMITED: 'The calendar is busy with another change. Try again in a moment.',
};
