import { BadRequestException } from '@nestjs/common';
import { addDays, zonedInstant } from '@firmivra/types';

/**
 * Intake Forms Review Two, INTAKE-EXPIRY-01: a form's expiration is an exact time, shown in the
 * firm's time zone. A whole day means the end of that day in the firm's time zone (11:59 PM), as
 * the default of N days does. A time that is not later than now is refused on its own field.
 */
export const LATER_THAN_NOW = 'Choose an expiration date and time later than now.';
export const DUE_BEFORE_EXPIRY = 'Choose a due date on or before the expiration date.';

/** A 400 that names its field, so the screen highlights it with the message. */
export const fieldError = (path: string, message: string) =>
  new BadRequestException({ code: 'VALIDATION_FAILED', message, details: [{ path, message }] });

/** The calendar day an instant falls on in the zone. */
export function dayIn(at: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(at);
}

/** The end (11:59:59.999 PM) of a calendar day in the zone. */
export function endOfDayIn(day: string, timeZone: string): Date {
  return new Date(zonedInstant(day, '23:59', timeZone).getTime() + 59_999);
}

/** The default expiration: the end of the day `days` after today, in the zone. */
export function expiryAfterDays(days: number, timeZone: string, now = new Date()): Date {
  return endOfDayIn(addDays(dayIn(now, timeZone), days), timeZone);
}

export interface ExpiryInput {
  expiresAt?: string | null;
  expiresOn?: string | null;
}

/**
 * The expiration a send, draft or change asks for: `expiresAt` an exact time, `expiresOn` a whole
 * day (its end in the firm's time zone), null no expiration, neither `undefined` (the caller's
 * default, or no change). Not both. `future` checks it is later than now (a draft is checked when
 * it is sent).
 */
export function chosenExpiry(
  input: ExpiryInput,
  timeZone: string,
  future = true,
  now = new Date(),
): Date | null | undefined {
  if (input.expiresAt !== undefined && input.expiresOn !== undefined) {
    throw fieldError('expiresAt', 'Send an expiration time or a date, not both.');
  }
  let at: Date | null;
  let path = 'expiresAt';
  if (input.expiresAt !== undefined) {
    at = input.expiresAt === null ? null : new Date(input.expiresAt);
  } else if (input.expiresOn !== undefined) {
    path = 'expiresOn';
    at = input.expiresOn === null ? null : endOfDayIn(input.expiresOn, timeZone);
  } else {
    return undefined;
  }
  if (future && at && at.getTime() <= now.getTime()) throw fieldError(path, LATER_THAN_NOW);
  return at;
}

/** A due date is on or before the day the form expires (in the firm's time zone). */
export function checkDue(dueOn: string | null | undefined, expires: Date | null, timeZone: string) {
  if (dueOn && expires && dueOn > dayIn(expires, timeZone)) {
    throw fieldError('dueOn', DUE_BEFORE_EXPIRY);
  }
}
