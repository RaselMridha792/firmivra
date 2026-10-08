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
export const CreateTypeBody = CreateAppointmentTypeRequest.superRefine(refine());
/** PATCH /business/appointment-types/{id} */
export const UpdateTypeBody = UpdateAppointmentTypeRequest.superRefine(refine());
/** GET /business/blocked-times */
export const BlocksQuery = BlockedTimesQuery.superRefine(refine(['from', 'to']));
/** POST /business/blocked-times */
export const CreateBlockBody = CreateBlockedTimeRequest.superRefine(refine(['startsAt', 'endsAt']));
/** GET /business/appointments */
export const CalendarQuery = AppointmentsQuery.superRefine(refine(['from', 'to']));
/** GET /business/appointments/slots */
export const FirmSlotsQuery = SlotsQuery.superRefine(refine(['from', 'to']));
/** POST /business/appointments */
export const BookBody = BookAppointmentRequest.superRefine(refine(['startsAt']));
/** POST /business/appointments/{id}/reschedule */
export const RescheduleBody = RescheduleAppointmentRequest.superRefine(refine(['startsAt']));
/** POST /business/appointments/{id}/cancel */
export const CancelBody = CancelAppointmentRequest.superRefine(refine());

// ---------- Portal routes ----------
/** GET /portal/{firmSlug}/me/appointments/slots */
export const MineSlotsQuery = MySlotsQuery.superRefine(refine(['from', 'to']));
/** POST /portal/{firmSlug}/me/appointments */
export const BookMineBody = BookMyAppointmentRequest.superRefine(refine(['startsAt']));
/** POST /portal/{firmSlug}/me/appointments/{id}/reschedule */
export const RescheduleMineBody = RescheduleMyAppointmentRequest.superRefine(refine(['startsAt']));
/** POST /portal/{firmSlug}/me/appointments/{id}/cancel */
export const CancelMineBody = CancelMyAppointmentRequest.superRefine(refine());
