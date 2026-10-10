import {
  AppointmentsQuery,
  BlockedTimesQuery,
  BookAppointmentRequest,
  BookMyAppointmentRequest,
  CancelAppointmentRequest,
  CancelMyAppointmentRequest,
  CreateAppointmentTypeRequest,
  CreateBlockedTimeRequest,
  MySlotsQuery,
  RescheduleAppointmentRequest,
  RescheduleMyAppointmentRequest,
  SlotsQuery,
  UpdateAppointmentRequest,
  UpdateAppointmentTypeRequest,
} from '@firmivra/types';
import type { z } from 'zod';

// The contract's request schemas, plus two things the API cannot take as they are (400
// VALIDATION_FAILED, never a 500 from the driver or the date math):
// - Text Postgres cannot hold. The contract's text rules already refuse a NUL (a control
//   character); half of a UTF-16 surrogate pair ("\ud800" in JSON) gets through them, and the
//   driver would store it as U+FFFD or fail. A type's name, a block's reason, location details
//   and cancel reasons refuse it. Every other field is a uuid, a time, a date or an enum.
// - Times and dates outside the calendar's years. The contract takes years 0000 to 9999; at the
//   edges the firm-time and slot arithmetic leaves four-digit years (year 0000 with an offset is
//   1 BC, 9999-12-31 plus a day is +010000). Appointments and blocks live in 2000 to 2100.

/** A lone surrogate: in a `u` regex a whole pair is one astral code point, never `Cs`. */
const LONE_SURROGATE = /\p{Cs}/u;
/** The calendar's years: [2000-01-01, 2101-01-01) UTC. */
const FIRST_INSTANT = Date.UTC(2000, 0, 1);
const AFTER_LAST_INSTANT = Date.UTC(2101, 0, 1);

/** Whether a time ("2026-10-12T10:00:00Z") or date ("2026-10-12") is in the calendar's years. */
export function inCalendarYears(value: string): boolean {
  const instant = Date.parse(value);
  return instant >= FIRST_INSTANT && instant < AFTER_LAST_INSTANT;
}

/**
 * A uuid may come with capitals, the same uuid to Postgres; the calendar's lock keys and the
 * id comparisons need one spelling, so every uuid in a request is lower-cased as it comes in
 * (#108 review). Only a whole uuid changes: free text keeps its letters.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const lowerIds = <T extends Record<string, unknown>>(values: T): T =>
  Object.fromEntries(
    Object.entries(values).map(([k, v]) => [
      k,
      typeof v === 'string' && UUID.test(v) ? v.toLowerCase() : v,
    ]),
  ) as T;
/** A uuid in the path, lower-cased (see lowerIds). */
export const idParam = <S extends z.ZodType<string>>(schema: S) =>
  schema.transform((v) => v.toLowerCase());

/** A block ends in the future: a past block would only count against nothing (#108 review). */
const endsInFuture = (values: { endsAt: string }, ctx: z.RefinementCtx): void => {
  if (Date.parse(values.endsAt) <= Date.now()) {
    ctx.addIssue({ code: 'custom', path: ['endsAt'], message: 'A block must end in the future' });
  }
};

/** Refuses lone surrogates in every string, and `times` outside the calendar's years. */
const refine =
  (times: readonly string[] = []) =>
  (values: Record<string, unknown>, ctx: z.RefinementCtx): void => {
    for (const [key, value] of Object.entries(values)) {
      if (typeof value !== 'string') continue;
      if (LONE_SURROGATE.test(value)) {
        ctx.addIssue({ code: 'custom', path: [key], message: 'Remove the special characters' });
      }
      if (times.includes(key) && !inCalendarYears(value)) {
        ctx.addIssue({ code: 'custom', path: [key], message: 'Use a date from 2000 to 2100' });
      }
    }
  };

// ---------- Firm routes ----------
/** POST /business/appointment-types */
export const CreateTypeBody =
  CreateAppointmentTypeRequest.superRefine(refine()).transform(lowerIds);
/** PATCH /business/appointment-types/{id} */
export const UpdateTypeBody =
  UpdateAppointmentTypeRequest.superRefine(refine()).transform(lowerIds);
/** GET /business/blocked-times */
export const BlocksQuery = BlockedTimesQuery.superRefine(refine(['from', 'to'])).transform(
  lowerIds,
);
/** POST /business/blocked-times */
export const CreateBlockBody = CreateBlockedTimeRequest.superRefine(refine(['startsAt', 'endsAt']))
  .superRefine(endsInFuture)
  .transform(lowerIds);
/** GET /business/appointments */
export const CalendarQuery = AppointmentsQuery.superRefine(refine(['from', 'to'])).transform(
  lowerIds,
);
/** GET /business/appointments/slots */
export const FirmSlotsQuery = SlotsQuery.superRefine(refine(['from', 'to'])).transform(lowerIds);
/** POST /business/appointments */
export const BookBody = BookAppointmentRequest.superRefine(refine(['startsAt'])).transform(
  lowerIds,
);
/** POST /business/appointments/{id}/reschedule */
export const RescheduleBody = RescheduleAppointmentRequest.superRefine(
  refine(['startsAt']),
).transform(lowerIds);
/** PATCH /business/appointments/{id}: free text only, so no ids to lower-case. */
export const UpdateBody = UpdateAppointmentRequest.superRefine(refine());
/** POST /business/appointments/{id}/cancel */
export const CancelBody = CancelAppointmentRequest.superRefine(refine()).transform(lowerIds);

// ---------- Portal routes ----------
/** GET /portal/{firmSlug}/me/appointments/slots */
export const MineSlotsQuery = MySlotsQuery.superRefine(refine(['from', 'to'])).transform(lowerIds);
/** POST /portal/{firmSlug}/me/appointments */
export const BookMineBody = BookMyAppointmentRequest.superRefine(refine(['startsAt'])).transform(
  lowerIds,
);
/** POST /portal/{firmSlug}/me/appointments/{id}/reschedule */
export const RescheduleMineBody = RescheduleMyAppointmentRequest.superRefine(
  refine(['startsAt']),
).transform(lowerIds);
/** POST /portal/{firmSlug}/me/appointments/{id}/cancel */
export const CancelMineBody = CancelMyAppointmentRequest.superRefine(refine()).transform(lowerIds);
