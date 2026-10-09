import { z } from 'zod';
import { ClientId, MemberRef } from '../clients/schemas.js';
import { clearable, text } from '../clients/text.js';

// Appointments (R12): the firm's calendar, availability and appointment types, and the client's
// own appointments in the portal (System Wiring section 2).
// Firm routes: /api/v1/business/... (x-business-id). Owner and Admin see and change every
// appointment, manage appointment types, anyone's working hours and blocked time. Staff manage
// their own working hours and blocked time, and see the calendar by the clients API's rule (#63):
// - in full only the appointments they are the staff member of, or whose client is assigned to
//   them (clients.assigned_user_id);
// - every other one only as Busy (time, staff member, status); its detail is 404;
// - they book only for clients assigned to them, and change only appointments they see in full
//   (404 otherwise); a clientId filter on a client not assigned to them is 404;
// - they still get every member's free slots (times and staff names only).
// Firm users change an appointment at any time (no client cutoff).
// Portal routes: /api/v1/portal/{firmSlug}/me/appointments/... (the signed-in client's own).
// - Clients see only types with clientBookable, and only free slots: the client's assigned staff
//   member when free, otherwise the free member with the fewest appointments that day.
// - Clients reschedule or cancel until the type's cancelCutoffHours before the start
//   (0 = until the start); after that 409 CHANGE_WINDOW_CLOSED (contact the firm). The type's
//   cutoff applies whether or not it is client-bookable; an appointment without a type uses 24
//   hours. Staff can change any appointment at any time.
// - The database stops double booking: an overlap with the staff member's or the client's other
//   appointments, or with blocked time, is 409 SLOT_TAKEN.
// - Every book, reschedule, cancel, complete and no-show is kept as the appointment's history.
// - A busy calendar (another change holds it for more than 2 s) answers 429 RATE_LIMITED: try
//   again in a moment.
// Times: ISO 8601 instants with an offset, and dates, from 2000 to 2100 (the API's calendar
// years; anything else is 400 VALIDATION_FAILED). Times of day (working hours) are in the firm's
// timezone, which availability and slot answers name (IANA, for example America/New_York).
// Responses are plain objects (fields the API adds later are dropped); requests are strict.

/** The calendar's years: [2000-01-01, 2101-01-01) UTC, as the API checks them. */
const FIRST_INSTANT = Date.UTC(2000, 0, 1);
const AFTER_LAST_INSTANT = Date.UTC(2101, 0, 1);
const inCalendarYears = (value: string) => {
  const instant = Date.parse(value);
  return instant >= FIRST_INSTANT && instant < AFTER_LAST_INSTANT;
};
const DateTime = z.iso
  .datetime({ offset: true })
  .refine(inCalendarYears, 'Use a date from 2000 to 2100');
const CalendarDate = z.iso.date().refine(inCalendarYears, 'Use a date from 2000 to 2100');
const DAY_MS = 24 * 60 * 60_000;

export const AppointmentId = z.uuid();
export const AppointmentTypeId = z.uuid();
export const BlockedTimeId = z.uuid();
export const MemberId = z.uuid();

/** 0 = Sunday ... 6 = Saturday. */
export const Weekday = z.number().int().min(0).max(6);
/** A time of day in the firm's timezone, on a 15-minute grid: "09:00", "17:30". */
export const TimeOfDay = z
  .string()
  .regex(/^([01]\d|2[0-3]):(00|15|30|45)$/, 'Use HH:MM in 15-minute steps');
export const LocationKind = z.enum(['IN_PERSON', 'PHONE', 'VIDEO']);
export type LocationKind = z.infer<typeof LocationKind>;
/** SCHEDULED until it happens. CANCELLED, COMPLETED and NO_SHOW are final. */
export const AppointmentStatus = z.enum(['SCHEDULED', 'CANCELLED', 'COMPLETED', 'NO_SHOW']);
export type AppointmentStatus = z.infer<typeof AppointmentStatus>;

/** Minutes, in 15-minute steps, up to 8 hours. */
const Duration = z
  .number()
  .int()
  .min(15)
  .max(480)
  .refine((m) => m % 15 === 0, 'Use 15-minute steps');
/** Hours before the start until which a client may reschedule or cancel; 0 = until the start. */
const CutoffHours = z.number().int().min(0).max(720);
const SortOrder = z.number().int().min(0).max(1000);
/** Optional text: leave it out, or send '' or null, for none. */
const Reason = clearable(text(500, 'many'));
const nonEmpty = (o: object) => Object.keys(o).length > 0;

/** The time an appointment or block takes. */
export const TimeRange = z.object({ startsAt: DateTime, endsAt: DateTime });
export type TimeRange = z.infer<typeof TimeRange>;
/** A date range in a query: from and to, at most `days` apart. */
const within = (days: number) => (q: { from: string; to: string }) => {
  const span = Date.parse(q.to) - Date.parse(q.from);
  return span >= 0 && span <= days * DAY_MS;
};

// ---------- Appointment types (firm) ----------
/** A kind of appointment the firm offers: "Tax consultation", 30 minutes, video. */
export const AppointmentType = z.object({
  id: z.uuid(),
  name: z.string(),
  durationMinutes: z.number().int(),
  locationKind: LocationKind,
  /** Clients see and book only these. */
  clientBookable: z.boolean(),
  /** Clients reschedule or cancel until this many hours before; 0 = until the start. */
  cancelCutoffHours: z.number().int(),
  sortOrder: z.number().int(),
  /** Archived types stay on past appointments; nobody books them. */
  archivedAt: DateTime.nullable(),
});
export type AppointmentType = z.infer<typeof AppointmentType>;

export const AppointmentTypeList = z.object({ items: z.array(AppointmentType) });
export type AppointmentTypeList = z.infer<typeof AppointmentTypeList>;

/** GET /business/appointment-types: in sort order; active ones unless `status` says more. */
export const AppointmentTypesQuery = z.strictObject({
  status: z.enum(['active', 'archived', 'all']).optional().default('active'),
});
export type AppointmentTypesQuery = z.input<typeof AppointmentTypesQuery>;

/** Owner and Admin. A duplicate name is 409 DUPLICATE_NAME. */
export const CreateAppointmentTypeRequest = z.strictObject({
  name: text(80),
  durationMinutes: Duration,
  locationKind: LocationKind.default('VIDEO'),
  clientBookable: z.boolean().default(false),
  cancelCutoffHours: CutoffHours.default(24),
  sortOrder: SortOrder.optional(),
});
export type CreateAppointmentTypeRequest = z.input<typeof CreateAppointmentTypeRequest>;

/** Owner and Admin; send only what changes. Existing appointments keep their times. */
export const UpdateAppointmentTypeRequest = z
  .strictObject({
    name: text(80).optional(),
    durationMinutes: Duration.optional(),
    locationKind: LocationKind.optional(),
    clientBookable: z.boolean().optional(),
    cancelCutoffHours: CutoffHours.optional(),
    sortOrder: SortOrder.optional(),
  })
  .refine(nonEmpty, 'Change at least one field');
export type UpdateAppointmentTypeRequest = z.input<typeof UpdateAppointmentTypeRequest>;

// ---------- Availability (firm) ----------
/** One range of a staff member's regular week; several a day are fine (a lunch break). */
export const WorkingHoursRange = z.object({
  weekday: Weekday,
  startsAt: TimeOfDay,
  endsAt: TimeOfDay,
});
export type WorkingHoursRange = z.infer<typeof WorkingHoursRange>;

export const MemberAvailability = z.object({
  member: MemberRef,
  hours: z.array(WorkingHoursRange),
});
export type MemberAvailability = z.infer<typeof MemberAvailability>;

/** GET /business/availability: every active member's regular week, in the firm's timezone. */
export const Availability = z.object({
  timezone: z.string(),
  members: z.array(MemberAvailability),
});
export type Availability = z.infer<typeof Availability>;

const overlapsNone = (hours: { weekday: number; startsAt: string; endsAt: string }[]) =>
  hours.every((a, i) =>
    hours.every(
      (b, j) =>
        i === j || a.weekday !== b.weekday || a.endsAt <= b.startsAt || b.endsAt <= a.startsAt,
    ),
  );

/**
 * PUT /business/availability/{userId}/working-hours: replaces that member's whole week. Owner
 * and Admin for anyone, Staff for themselves (403 otherwise). An empty list means no hours.
 */
export const SetWorkingHoursRequest = z.strictObject({
  hours: z
    .array(
      z
        .strictObject({ weekday: Weekday, startsAt: TimeOfDay, endsAt: TimeOfDay })
        .refine((r) => r.startsAt < r.endsAt, 'The end must be after the start'),
    )
    .max(42)
    .refine(overlapsNone, 'Ranges on the same day cannot overlap'),
});
export type SetWorkingHoursRequest = z.input<typeof SetWorkingHoursRequest>;

/** Time a member is away (holiday, training), or the whole firm when `member` is null. */
export const BlockedTime = z.object({
  id: z.uuid(),
  member: MemberRef.nullable(),
  startsAt: DateTime,
  endsAt: DateTime,
  /** Internal; never shown to clients. */
  reason: z.string().nullable(),
  createdBy: MemberRef.nullable(),
});
export type BlockedTime = z.infer<typeof BlockedTime>;

export const BlockedTimeList = z.object({ items: z.array(BlockedTime) });
export type BlockedTimeList = z.infer<typeof BlockedTimeList>;

/** GET /business/blocked-times: blocks touching [from, to), at most 93 days; one member's or all. */
export const BlockedTimesQuery = z
  .strictObject({ from: DateTime, to: DateTime, userId: MemberId.optional() })
  .refine(within(93), 'Use a range of at most 93 days');
export type BlockedTimesQuery = z.input<typeof BlockedTimesQuery>;

/**
 * POST /business/blocked-times. `userId` null blocks the whole firm (Owner and Admin). Staff
 * block only themselves. A block over a scheduled appointment is 409 BLOCKS_APPOINTMENT: move or
 * cancel the appointment first.
 */
export const CreateBlockedTimeRequest = z
  .strictObject({
    userId: MemberId.nullable(),
    startsAt: DateTime,
    endsAt: DateTime,
    reason: Reason,
  })
  .refine((b) => Date.parse(b.startsAt) < Date.parse(b.endsAt), 'The end must be after the start')
  .refine(
    (b) => Date.parse(b.endsAt) - Date.parse(b.startsAt) <= 366 * DAY_MS,
    'A block lasts at most 366 days',
  );
export type CreateBlockedTimeRequest = z.input<typeof CreateBlockedTimeRequest>;

// ---------- Appointments (firm) ----------
export const ClientRef = z.object({ id: z.uuid(), displayName: z.string() });
export type ClientRef = z.infer<typeof ClientRef>;
export const AppointmentTypeRef = z.object({ id: z.uuid(), name: z.string() });
export type AppointmentTypeRef = z.infer<typeof AppointmentTypeRef>;

export const Appointment = z.object({
  id: z.uuid(),
  client: ClientRef,
  staff: MemberRef,
  type: AppointmentTypeRef.nullable(),
  engagementId: z.uuid().nullable(),
  startsAt: DateTime,
  endsAt: DateTime,
  status: AppointmentStatus,
  locationKind: LocationKind,
  /** The address, phone number or video link. */
  locationDetails: z.string().nullable(),
  bookedByClient: z.boolean(),
  rescheduleCount: z.number().int(),
  cancelledAt: DateTime.nullable(),
  cancelReason: z.string().nullable(),
  createdAt: DateTime,
});
export type Appointment = z.infer<typeof Appointment>;

export const AppointmentAction = z.enum([
  'BOOKED',
  'RESCHEDULED',
  'CANCELLED',
  'COMPLETED',
  'NO_SHOW',
]);
export type AppointmentAction = z.infer<typeof AppointmentAction>;

/** One change, oldest first: who did it, and the times (and staff member) before and after. */
export const AppointmentEvent = z.object({
  at: DateTime,
  action: AppointmentAction,
  by: z.object({ kind: z.enum(['STAFF', 'CLIENT']), name: z.string() }),
  /** Before the change: null when booked. */
  from: TimeRange.extend({ staff: MemberRef }).nullable(),
  /** After the change: null when cancelled, completed or a no-show. */
  to: TimeRange.extend({ staff: MemberRef }).nullable(),
  reason: z.string().nullable(),
});
export type AppointmentEvent = z.infer<typeof AppointmentEvent>;

/** GET /business/appointments/{id}: the appointment and its history. Staff: 404 unless in full. */
export const AppointmentDetail = Appointment.extend({ history: z.array(AppointmentEvent) });
export type AppointmentDetail = z.infer<typeof AppointmentDetail>;

/**
 * What Staff see of an appointment that is not theirs and not their assigned client's: only that
 * the staff member is busy then. No client, type, location, engagement, reason or history.
 */
export const BusyAppointment = z.object({
  restricted: z.literal(true),
  id: z.uuid(),
  staff: MemberRef,
  startsAt: DateTime,
  endsAt: DateTime,
  status: AppointmentStatus,
});
export type BusyAppointment = z.infer<typeof BusyAppointment>;

/** One calendar entry: the whole appointment, or (Staff) Busy. Check `restricted` first. */
export const CalendarAppointment = z.discriminatedUnion('restricted', [
  Appointment.extend({ restricted: z.literal(false) }),
  BusyAppointment,
]);
export type CalendarAppointment = z.infer<typeof CalendarAppointment>;

export const AppointmentList = z.object({ items: z.array(CalendarAppointment) });
export type AppointmentList = z.infer<typeof AppointmentList>;

/**
 * GET /business/appointments: the calendar for [from, to), at most 62 days, oldest first. Staff
 * get Busy entries for appointments they don't see in full, and 404 for a `clientId` of a client
 * not assigned to them (so a Busy entry cannot be traced to a client).
 */
export const AppointmentsQuery = z
  .strictObject({
    from: DateTime,
    to: DateTime,
    staffUserId: MemberId.optional(),
    clientId: ClientId.optional(),
    status: AppointmentStatus.optional(),
  })
  .refine(within(62), 'Use a range of at most 62 days');
export type AppointmentsQuery = z.input<typeof AppointmentsQuery>;

/** A free time for a type: within working hours, outside blocks and other appointments. */
export const Slot = z.object({ startsAt: DateTime, endsAt: DateTime, staff: MemberRef });
export type Slot = z.infer<typeof Slot>;

export const SlotList = z.object({ timezone: z.string(), slots: z.array(Slot) });
export type SlotList = z.infer<typeof SlotList>;

/**
 * GET /business/appointments/slots: free starts on a 15-minute grid for one type, from one
 * calendar date to another (firm timezone, at most 31 days); one member's or everyone's (Staff
 * too). When rescheduling, pass `excludeAppointmentId`: the moved appointment's own time counts
 * as free, its own length is used, and its client's other appointments are taken. When booking,
 * pass `clientId` to leave out times the client already has an appointment (Staff: their own
 * clients, else 404).
 */
export const SlotsQuery = z
  .strictObject({
    typeId: AppointmentTypeId,
    staffUserId: MemberId.optional(),
    clientId: z.uuid().optional(),
    from: CalendarDate,
    to: CalendarDate,
    excludeAppointmentId: AppointmentId.optional(),
  })
  .refine(within(31), 'Use a range of at most 31 days');
export type SlotsQuery = z.input<typeof SlotsQuery>;

/**
 * POST /business/appointments: firm users book for a client, at any time that is free (working
 * hours are a guide for them, not a rule). Staff book only for clients assigned to them (404
 * otherwise), with any staff member. With a type, its duration and location kind are the default;
 * without one, give the duration.
 */
export const BookAppointmentRequest = z
  .strictObject({
    clientId: z.uuid(),
    staffUserId: MemberId,
    typeId: AppointmentTypeId.optional(),
    startsAt: DateTime,
    durationMinutes: Duration.optional(),
    locationKind: LocationKind.optional(),
    locationDetails: clearable(text(500, 'many')),
    engagementId: z.uuid().optional(),
  })
  .refine((b) => b.typeId !== undefined || b.durationMinutes !== undefined, {
    message: 'Choose a type or give the duration',
    path: ['durationMinutes'],
  });
export type BookAppointmentRequest = z.input<typeof BookAppointmentRequest>;

/** A new start (same duration), and optionally another staff member. Staff: only in full ones. */
export const RescheduleAppointmentRequest = z.strictObject({
  startsAt: DateTime,
  staffUserId: MemberId.optional(),
});
export type RescheduleAppointmentRequest = z.input<typeof RescheduleAppointmentRequest>;

export const CancelAppointmentRequest = z.strictObject({ reason: Reason });
export type CancelAppointmentRequest = z.input<typeof CancelAppointmentRequest>;

// ---------- The client's own appointments (portal) ----------
/** What a client sees of an appointment: never internal reasons or other clients. */
export const MyAppointment = z.object({
  id: z.uuid(),
  type: AppointmentTypeRef.nullable(),
  staffName: z.string(),
  startsAt: DateTime,
  endsAt: DateTime,
  status: AppointmentStatus,
  locationKind: LocationKind,
  locationDetails: z.string().nullable(),
  /**
   * The last moment the client may reschedule or cancel (the type's cutoff, or 24 hours without
   * a type), or null once it is past or final.
   */
  changeableUntil: DateTime.nullable(),
});
export type MyAppointment = z.infer<typeof MyAppointment>;

export const MyAppointmentList = z.object({ items: z.array(MyAppointment) });
export type MyAppointmentList = z.infer<typeof MyAppointmentList>;

/** Upcoming: scheduled, soonest first. Past: everything else, newest first. */
export const MyAppointmentsQuery = z.strictObject({
  when: z.enum(['upcoming', 'past']).default('upcoming'),
});
export type MyAppointmentsQuery = z.input<typeof MyAppointmentsQuery>;

/** A type the client can book. */
export const BookableType = z.object({
  id: z.uuid(),
  name: z.string(),
  durationMinutes: z.number().int(),
  locationKind: LocationKind,
  cancelCutoffHours: z.number().int(),
});
export type BookableType = z.infer<typeof BookableType>;

export const BookableTypeList = z.object({ items: z.array(BookableType) });
export type BookableTypeList = z.infer<typeof BookableTypeList>;

/** A free start for the client; the firm picks the staff member when it is booked. */
export const MySlot = z.object({ startsAt: DateTime, endsAt: DateTime });
export type MySlot = z.infer<typeof MySlot>;

export const MySlotList = z.object({ timezone: z.string(), slots: z.array(MySlot) });
export type MySlotList = z.infer<typeof MySlotList>;

/**
 * Free starts for a bookable type, from one date to another (at most 31 days, from today). When
 * rescheduling, pass `excludeAppointmentId` (the client's own): its time counts as free.
 */
export const MySlotsQuery = z
  .strictObject({
    typeId: AppointmentTypeId,
    from: CalendarDate,
    to: CalendarDate,
    excludeAppointmentId: AppointmentId.optional(),
  })
  .refine(within(31), 'Use a range of at most 31 days');
export type MySlotsQuery = z.input<typeof MySlotsQuery>;

/** Book one of `slots()`; a slot someone took meanwhile is 409 SLOT_TAKEN (pick another). */
export const BookMyAppointmentRequest = z.strictObject({
  typeId: AppointmentTypeId,
  startsAt: DateTime,
});
export type BookMyAppointmentRequest = z.input<typeof BookMyAppointmentRequest>;

/** A new start from `slots()` for the same type, before the cutoff. */
export const RescheduleMyAppointmentRequest = z.strictObject({ startsAt: DateTime });
export type RescheduleMyAppointmentRequest = z.input<typeof RescheduleMyAppointmentRequest>;

export const CancelMyAppointmentRequest = z.strictObject({ reason: Reason });
export type CancelMyAppointmentRequest = z.input<typeof CancelMyAppointmentRequest>;

// ---------- Errors ----------
/** Stable `error.code` values of these routes, besides the generic ones. */
export const AppointmentErrorCode = z.enum([
  /** 409: the time overlaps the staff member's or the client's other appointment, or blocked time. */
  'SLOT_TAKEN',
  /** 409: a client asked for a time that is not one of the type's free slots. */
  'SLOT_UNAVAILABLE',
  /** 409: past the type's cancelCutoffHours: the client should contact the firm. */
  'CHANGE_WINDOW_CLOSED',
  /** 409: the appointment is cancelled, completed or a no-show; that is final. */
  'APPOINTMENT_CLOSED',
  /** 409: complete and no-show only once the appointment has started. */
  'APPOINTMENT_NOT_STARTED',
  /** 409: the type is archived and cannot be booked. */
  'TYPE_ARCHIVED',
  /** 409: the blocked time would cover a scheduled appointment. */
  'BLOCKS_APPOINTMENT',
  /**
   * 409: the calendar already has 200 blocks that have not ended (a member's, or the whole
   * firm's): delete some first.
   */
  'BLOCK_LIMIT',
  /** 409: the firm already has an appointment type with this name. */
  'DUPLICATE_NAME',
  /**
   * 409: the client is archived (R10's code): nothing new is booked for them. The firm restores
   * the client first; on the portal, the client contacts the firm.
   */
  'CLIENT_ARCHIVED',
  /**
   * 409, for now: a type's cancelCutoffHours can only be 24 until R0 adds
   * appointment_types.cancel_cutoff_hours (every type answers 24 until then). Then any value in
   * range works and this code goes away.
   */
  'CUTOFF_NOT_SUPPORTED',
]);
export type AppointmentErrorCode = z.infer<typeof AppointmentErrorCode>;
