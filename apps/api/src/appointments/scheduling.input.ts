import {
  AgendaQuery,
  AppointmentNoteRequest,
  AppointmentsSummaryQuery,
  ConflictCheckRequest,
  ContactSearchQuery,
  SaveAppointmentDraftRequest,
  ScheduleAppointmentRequest,
  SendReminderRequest,
  SendRemindersRequest,
  SetAppointmentNoticeSettingsRequest,
  SetAppointmentTypeConfigRequest,
  SetAvailabilityRulesRequest,
  StaffDayQuery,
  UpdateAppointmentDetailsRequest,
} from '@firmivra/types';
import { z } from 'zod';
import { inCalendarYears } from './appointments.input.js';

// The scheduling contract's request schemas (packages/types/src/appointments/scheduling.ts), plus
// what the API cannot take as it is (400 VALIDATION_FAILED): times outside the calendar's years,
// and uuids in other spellings (the calendar's lock keys and id comparisons need one).

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Every whole uuid in a request, lower-cased (free text that is not a whole uuid is untouched). */
export function lowerDeep<T>(value: T): T {
  if (typeof value === 'string') return (UUID.test(value) ? value.toLowerCase() : value) as T;
  if (Array.isArray(value)) return value.map(lowerDeep) as T;
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, lowerDeep(v)]),
    ) as T;
  }
  return value;
}

const timesInCalendar =
  (keys: readonly string[]) =>
  (values: Record<string, unknown>, ctx: z.RefinementCtx): void => {
    for (const key of keys) {
      const value = values[key];
      if (typeof value === 'string' && !inCalendarYears(value)) {
        ctx.addIssue({ code: 'custom', path: [key], message: 'Use a date from 2000 to 2100' });
      }
    }
  };

/** A time range must end after it starts (when both are given). */
const endsAfterStart = (values: { startsAt?: string; endsAt?: string }, ctx: z.RefinementCtx) => {
  if (
    values.startsAt &&
    values.endsAt &&
    Date.parse(values.endsAt) <= Date.parse(values.startsAt)
  ) {
    ctx.addIssue({ code: 'custom', path: ['endsAt'], message: 'End time must be after the start' });
  }
};

/** GET /business/appointments/summary */
export const SummaryQuery = AppointmentsSummaryQuery;
/** GET /business/appointments/agenda */
export const AgendaQ = AgendaQuery.superRefine(timesInCalendar(['from', 'to'])).transform(
  lowerDeep,
);
/** GET /business/appointments/contacts */
export const ContactsQuery = ContactSearchQuery;
/** POST /business/appointments/schedule */
export const ScheduleBody = ScheduleAppointmentRequest.superRefine(
  timesInCalendar(['startsAt', 'endsAt']),
).transform(lowerDeep);
/** PATCH /business/appointments/{id}/details */
export const DetailsBody = UpdateAppointmentDetailsRequest.superRefine(
  timesInCalendar(['startsAt', 'endsAt']),
).transform(lowerDeep);

// ---------- Part 2 ----------

/** POST /business/appointments/{id}/send-reminder */
export const ReminderBody = SendReminderRequest;
/** POST /business/appointments/reminders/send */
export const RemindersBody = SendRemindersRequest.transform(lowerDeep);
/** POST /business/appointments/{id}/notes */
export const NoteBody = AppointmentNoteRequest;
/** POST /business/appointments/conflicts */
export const ConflictsBody = ConflictCheckRequest.superRefine(
  timesInCalendar(['startsAt', 'endsAt']),
)
  .superRefine(endsAfterStart)
  .transform(lowerDeep);
/** GET /business/availability/day */
export const DayQuery = StaffDayQuery.superRefine(timesInCalendar(['startsAt', 'endsAt']))
  .superRefine(endsAfterStart)
  .transform(lowerDeep);
/** PUT /business/availability/{userId}/rules */
export const RulesBody = SetAvailabilityRulesRequest;
/** PUT /business/appointment-types/{id}/config */
export const TypeConfigBody = SetAppointmentTypeConfigRequest.transform(lowerDeep);
/** PUT /business/appointments/settings */
export const NoticeSettingsBody = SetAppointmentNoticeSettingsRequest;
/** POST, PUT /business/appointment-drafts */
export const DraftBody = SaveAppointmentDraftRequest.transform(lowerDeep);
/** /business/appointment-drafts/{id} */
export const DraftIdParam = z.uuid().transform((v) => v.toLowerCase());
