import { z } from 'zod';
import { CalendarDate, MemberRef } from '../clients/schemas.js';
import { clearable, SearchText, text } from '../clients/text.js';
import { HttpsUrl } from '../content/schemas.js';
import { AppointmentEvent, TimeOfDay } from './schemas.js';

// Appointments workspace (R42 contract, for Tumit's screens): the overview's KPIs, the Calendar /
// List / Today views with search, the full Schedule Appointment form (Create New and Edit
// Existing, drafts, reminders, recurrence, related items), the Staff Availability panel with
// conflict checks, Edit My Availability's rules, appointment-type configuration and the firm's
// appointment notice settings. It adds to R12's appointments contract (schemas.ts), which stays
// as it is: the same appointment records, one calendar.
// Designs: docs/mockups/firm-workspace/appointment/source/. Brief:
// docs/work/briefs/appointments-contract.md. Visibility is R12's rule: Owner and Admin see every
// appointment; Staff see their own and their assigned clients' in full and the rest as Busy.
// Responses are plain objects; requests are strict.

const DateTime = z.iso.datetime({ offset: true });

/**
 * What the screens show as status. The database keeps SCHEDULED, CANCELLED, COMPLETED, NO_SHOW;
 * PENDING / CONFIRMED need a confirmed_at column, RESCHEDULED is a SCHEDULED one that moved
 * (reschedule_count > 0), DRAFT needs the drafts table (to build).
 */
export const AppointmentDisplayStatus = z.enum([
  'DRAFT',
  'PENDING',
  'CONFIRMED',
  'RESCHEDULED',
  'COMPLETED',
  'NO_SHOW',
  'CANCELED',
]);
export type AppointmentDisplayStatus = z.infer<typeof AppointmentDisplayStatus>;

/** In Person, Phone, Zoom / Video, Other. OTHER is new (database enum has the first three). */
export const MeetingMethod = z.enum(['IN_PERSON', 'PHONE', 'VIDEO', 'OTHER']);
export type MeetingMethod = z.infer<typeof MeetingMethod>;

/** Who the appointment is with: a client, a lead (no client yet), or a new contact. */
export const ContactKind = z.enum(['CLIENT', 'LEAD', 'CONTACT']);
export type ContactKind = z.infer<typeof ContactKind>;

export const AppointmentContact = z.object({
  kind: ContactKind,
  /** The client or lead id; null for a contact typed in the form. */
  id: z.uuid().nullable(),
  name: z.string(),
  businessName: z.string().nullable(),
  email: z.string().nullable(),
  phone: z.string().nullable(),
  clientType: z.enum(['INDIVIDUAL', 'BUSINESS']).nullable(),
});
export type AppointmentContact = z.infer<typeof AppointmentContact>;

export const NamedItem = z.object({ id: z.uuid(), name: z.string() });
export type NamedItem = z.infer<typeof NamedItem>;

/** Office / Branch and Room. No locations table yet: firm-configured locations (to build). */
export const AppointmentVenue = z.object({
  office: NamedItem.nullable(),
  room: NamedItem.nullable(),
  /** Address, phone number or the "Other" description. */
  details: z.string().nullable(),
});
export type AppointmentVenue = z.infer<typeof AppointmentVenue>;

// ---------- Overview: KPIs ----------

export const CountWithPrevious = z.object({
  value: z.number().int(),
  /** The same period a month earlier ("↑ 20% vs last month"); null when not comparable. */
  previous: z.number().int().nullable(),
});
export type CountWithPrevious = z.infer<typeof CountWithPrevious>;

/** GET /business/appointments/summary: the five cards. A card's click filters by its status. */
export const AppointmentsSummaryQuery = z.strictObject({
  /** The month shown, YYYY-MM; this month when left out. */
  month: z
    .string()
    .regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Use YYYY-MM')
    .optional(),
});
export type AppointmentsSummaryQuery = z.input<typeof AppointmentsSummaryQuery>;

export const AppointmentsSummary = z.object({
  month: z.string(),
  total: CountWithPrevious,
  /** Next 7 days from now, not cancelled. */
  upcoming: z.number().int(),
  completed: CountWithPrevious,
  noShows: CountWithPrevious,
  canceled: CountWithPrevious,
});
export type AppointmentsSummary = z.infer<typeof AppointmentsSummary>;

// ---------- Calendar, List and Today views ----------

/** One appointment as every view shows it (calendar card, Upcoming row, Today's row). */
export const AgendaItem = z.object({
  restricted: z.literal(false),
  id: z.uuid(),
  startsAt: DateTime,
  endsAt: DateTime,
  allDay: z.boolean(),
  contact: AppointmentContact,
  /** Related service (Services & Pricing); null when none. */
  service: NamedItem.nullable(),
  type: NamedItem.nullable(),
  status: AppointmentDisplayStatus,
  /** Assigned staff; the first is the owner. */
  staff: z.array(MemberRef).min(1),
  method: MeetingMethod,
  place: AppointmentVenue,
  /** Join Meeting shows when set (VIDEO). */
  videoUrl: z.string().nullable(),
  /** `#rrggbb`: the appointment's colour, else its type's; null uses the status colour. */
  color: z.string().nullable(),
  /** Internal meeting (Team Meeting) with no client or lead. */
  internal: z.boolean(),
});
export type AgendaItem = z.infer<typeof AgendaItem>;

/** For Staff, another member's appointment: only time, staff and status ("Busy"). */
export const BusyAgendaItem = z.object({
  restricted: z.literal(true),
  id: z.uuid(),
  startsAt: DateTime,
  endsAt: DateTime,
  staff: z.array(MemberRef).min(1),
  status: AppointmentDisplayStatus,
});
export type BusyAgendaItem = z.infer<typeof BusyAgendaItem>;

export const AgendaEntry = z.discriminatedUnion('restricted', [AgendaItem, BusyAgendaItem]);
export type AgendaEntry = z.infer<typeof AgendaEntry>;

/**
 * GET /business/appointments/agenda: one source for Calendar, List, Today and Upcoming. Search
 * matches the client or lead name, email, phone, business, service, staff and type. Sorted by
 * start time; at most 31 days per page of the calendar, cursor paging for the List view.
 */
export const AgendaQuery = z.strictObject({
  from: DateTime,
  to: DateTime,
  search: SearchText.optional(),
  status: AppointmentDisplayStatus.optional(),
  staffUserId: z.uuid().optional(),
  clientId: z.uuid().optional(),
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(500).optional().default(200),
});
export type AgendaQuery = z.input<typeof AgendaQuery>;

export const AgendaPage = z.object({
  timezone: z.string(),
  items: z.array(AgendaEntry).max(500),
  nextCursor: z.string().nullable(),
});
export type AgendaPage = z.infer<typeof AgendaPage>;

// ---------- Schedule Appointment form ----------

/** GET /business/appointments/contacts: the Client / Lead search box. */
export const ContactSearchQuery = z.strictObject({
  search: SearchText,
  limit: z.coerce.number().int().min(1).max(20).optional().default(10),
});
export type ContactSearchQuery = z.input<typeof ContactSearchQuery>;

export const ContactSearchResult = z.object({ items: z.array(AppointmentContact) });
export type ContactSearchResult = z.infer<typeof ContactSearchResult>;

/** The form's contact: an existing client or lead, or a new contact typed in. */
export const ContactInput = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('CLIENT'), id: z.uuid() }),
  z.strictObject({ kind: z.literal('LEAD'), id: z.uuid() }),
  z.strictObject({
    kind: z.literal('CONTACT'),
    name: text(120),
    businessName: clearable(text(160)),
    email: z.string().trim().toLowerCase().pipe(z.email().max(254)),
    phone: clearable(text(40)),
    clientType: z.enum(['INDIVIDUAL', 'BUSINESS']).default('INDIVIDUAL'),
  }),
]);
export type ContactInput = z.input<typeof ContactInput>;

export const ReminderChannel = z.enum(['EMAIL', 'SMS', 'PORTAL']);
export type ReminderChannel = z.infer<typeof ReminderChannel>;
export const ReminderUnit = z.enum(['MINUTES', 'HOURS', 'DAYS', 'WEEKS']);
export type ReminderUnit = z.infer<typeof ReminderUnit>;

/** "1 day before" by email. Several per channel allowed (48 hours + 24 hours). */
export const AppointmentReminder = z.strictObject({
  channel: ReminderChannel,
  amount: z.number().int().min(0).max(60),
  unit: ReminderUnit,
});
export type AppointmentReminder = z.infer<typeof AppointmentReminder>;

export const RecurrenceFrequency = z.enum(['NONE', 'DAILY', 'WEEKLY', 'MONTHLY', 'CUSTOM']);
export type RecurrenceFrequency = z.infer<typeof RecurrenceFrequency>;

/** "Does not repeat" is NONE. A series ends on `until` or after `count` occurrences. */
export const AppointmentRecurrence = z.strictObject({
  frequency: RecurrenceFrequency,
  /** Every n days / weeks / months. */
  interval: z.number().int().min(1).max(12).default(1),
  /** WEEKLY or CUSTOM: 0 = Sunday ... 6 = Saturday. */
  weekdays: z.array(z.number().int().min(0).max(6)).max(7).optional(),
  until: CalendarDate.optional(),
  count: z.number().int().min(1).max(52).optional(),
});
export type AppointmentRecurrence = z.input<typeof AppointmentRecurrence>;

/** Related Items (Optional). Ids of records at this firm, for the same client. */
export const RelatedItemsInput = z.strictObject({
  taxReturnId: z.uuid().nullable().optional(),
  /** "Link to Bookkeeping Client": the client's bookkeeping engagement. */
  bookkeepingEngagementId: z.uuid().nullable().optional(),
  invoiceId: z.uuid().nullable().optional(),
  taskId: z.uuid().nullable().optional(),
  /** "Send Intake Form Before Appointment". */
  intakeFormId: z.uuid().nullable().optional(),
  /** "Require Documents Before Appointment": the document request to wait for. */
  documentRequestId: z.uuid().nullable().optional(),
});
export type RelatedItemsInput = z.input<typeof RelatedItemsInput>;

/** The form's fields (no defaults, so a PATCH never resets what it leaves out). Times are instants; `timezone` is how the form and notices show them. */
const scheduleFields = {
  contact: ContactInput,
  typeId: z.uuid(),
  serviceId: z.uuid().nullable().optional(),
  startsAt: DateTime,
  endsAt: DateTime,
  /** IANA name; the firm's when left out. */
  timezone: z.string().max(100).optional(),
  allDay: z.boolean(),
  method: MeetingMethod,
  officeId: z.uuid().nullable().optional(),
  roomId: z.uuid().nullable().optional(),
  details: clearable(text(500, 'many')),
  /** "Generate Zoom Link": made by the video integration on save (none connected: 409). */
  generateVideoLink: z.boolean(),
  videoUrl: HttpsUrl.nullable().optional(),
  staffUserIds: z.array(z.uuid()).min(1, 'Choose a staff member').max(5),
  status: z.enum(['PENDING', 'CONFIRMED']),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .nullable()
    .optional(),
  internalNotes: clearable(text(2000, 'many')),
  clientInstructions: clearable(text(2000, 'many')),
  related: RelatedItemsInput.optional(),
  reminders: z.array(AppointmentReminder).max(10),
  /** "Send Confirmation Message Immediately". */
  sendConfirmation: z.boolean(),
  recurrence: AppointmentRecurrence.optional(),
  /** An authorised, audited override of the conflicts the check found. */
  overrideConflicts: z.strictObject({ reason: text(500, 'many') }).optional(),
};

/** POST /business/appointments/schedule: Schedule Appointment. Retry-safe by idempotencyKey. */
export const ScheduleAppointmentRequest = z
  .strictObject({
    idempotencyKey: z.uuid(),
    ...scheduleFields,
    allDay: scheduleFields.allDay.default(false),
    generateVideoLink: scheduleFields.generateVideoLink.default(false),
    status: scheduleFields.status.default('CONFIRMED'),
    reminders: scheduleFields.reminders.default([]),
    sendConfirmation: scheduleFields.sendConfirmation.default(true),
  })
  .refine((b) => Date.parse(b.endsAt) > Date.parse(b.startsAt), {
    message: 'End time must be after the start',
    path: ['endsAt'],
  });
export type ScheduleAppointmentRequest = z.input<typeof ScheduleAppointmentRequest>;

/** POST /business/appointment-drafts, PUT .../{id}: Save as Draft. Nothing is sent or booked. */
export const SaveAppointmentDraftRequest = z.strictObject(scheduleFields).partial();
export type SaveAppointmentDraftRequest = z.input<typeof SaveAppointmentDraftRequest>;

/**
 * PATCH /business/appointments/{id}/details: Edit Existing (same record and history). A change of
 * time, staff, place or link sends an update notice. `version` catches a concurrent edit.
 */
export const UpdateAppointmentDetailsRequest = z
  .strictObject({ version: z.string().min(1).max(100), ...scheduleFields })
  .partial()
  .required({ version: true });
export type UpdateAppointmentDetailsRequest = z.input<typeof UpdateAppointmentDetailsRequest>;

/** One sent notice (confirmation, reminder, update, cancellation): delivery history. */
export const AppointmentNotice = z.object({
  at: DateTime,
  kind: z.enum(['CONFIRMATION', 'REMINDER', 'UPDATE', 'RESCHEDULE', 'CANCELLATION']),
  channel: ReminderChannel,
  /** Masked: "j***@example.com", "(***) ***-0187", or "Firm master email". */
  recipient: z.string(),
  status: z.enum(['QUEUED', 'SENT', 'DELIVERED', 'FAILED']),
});
export type AppointmentNotice = z.infer<typeof AppointmentNotice>;

export const RelatedItems = z.object({
  taxReturn: NamedItem.nullable(),
  bookkeepingEngagement: NamedItem.nullable(),
  invoice: NamedItem.nullable(),
  task: NamedItem.nullable(),
  intakeForm: NamedItem.extend({ completed: z.boolean() }).nullable(),
  documentRequest: NamedItem.extend({ received: z.boolean() }).nullable(),
});
export type RelatedItems = z.infer<typeof RelatedItems>;

/** GET /business/appointments/{id}/record: the detail panel and Edit Existing. */
export const AppointmentRecord = AgendaItem.extend({
  timezone: z.string(),
  internalNotes: z.string().nullable(),
  clientInstructions: z.string().nullable(),
  related: RelatedItems,
  reminders: z.array(AppointmentReminder),
  recurrence: AppointmentRecurrence.nullable(),
  /** Set for an appointment in a series. */
  seriesId: z.uuid().nullable(),
  history: z.array(AppointmentEvent),
  notices: z.array(AppointmentNotice),
  createdAt: DateTime,
  version: z.string(),
});
export type AppointmentRecord = z.infer<typeof AppointmentRecord>;

/** A saved draft (Save as Draft): the form so far. */
export const AppointmentDraft = z.object({
  id: z.uuid(),
  data: z.record(z.string(), z.unknown()),
  createdBy: z.string().nullable(),
  updatedAt: DateTime,
});
export type AppointmentDraft = z.infer<typeof AppointmentDraft>;

export const AppointmentDraftList = z.object({ items: z.array(AppointmentDraft) });
export type AppointmentDraftList = z.infer<typeof AppointmentDraftList>;

/** GET /business/appointments/options: the form's dropdowns in one call. */
export const SchedulingOptions = z.object({
  timezone: z.string(),
  types: z.array(
    NamedItem.extend({
      durationMinutes: z.number().int(),
      color: z.string().nullable(),
      serviceId: z.uuid().nullable(),
    }),
  ),
  services: z.array(NamedItem),
  staff: z.array(MemberRef),
  /** Optional until firm locations exist (Settings > Company Profile, to build). */
  offices: z.array(NamedItem).optional(),
  /** Optional until rooms exist (to build). */
  rooms: z.array(NamedItem.extend({ officeId: z.uuid() })).optional(),
  /** SMS reminders need the firm's SMS sender (Communications) and a client phone number. */
  smsEnabled: z.boolean(),
  portalEnabled: z.boolean(),
  /** A connected video integration (Integrations module): "Generate Zoom Link". */
  videoProvider: z.enum(['ZOOM', 'TEAMS', 'GOOGLE_MEET']).nullable(),
});
export type SchedulingOptions = z.infer<typeof SchedulingOptions>;

// ---------- Staff availability panel and conflicts ----------

export const AvailabilityBlockKind = z.enum([
  'AVAILABLE',
  /** A Firmivra appointment. */
  'APPOINTMENT',
  /** A connected Google / Outlook calendar's busy time, never its title. */
  'CALENDAR_BUSY',
  /** Blocked time (blocked_times). */
  'BLOCKED',
  'TIME_OFF',
  'BUFFER',
  'OUTSIDE_HOURS',
]);
export type AvailabilityBlockKind = z.infer<typeof AvailabilityBlockKind>;

export const AvailabilityBlock = z.object({
  startsAt: DateTime,
  endsAt: DateTime,
  kind: AvailabilityBlockKind,
  /** "Team Meeting", "Client Consultation", "Blocked (Admin)"; null when private. */
  label: z.string().nullable(),
});
export type AvailabilityBlock = z.infer<typeof AvailabilityBlock>;

export const ConflictKind = z.enum([
  'STAFF_BOOKED',
  'CALENDAR_BUSY',
  'OUTSIDE_HOURS',
  'BLOCKED_TIME',
  'TIME_OFF',
  'ROOM',
  'CLIENT_DOUBLE_BOOKED',
  'BUFFER',
  'RECURRING_OCCURRENCE',
]);
export type ConflictKind = z.infer<typeof ConflictKind>;

export const SchedulingConflict = z.object({
  kind: ConflictKind,
  staff: MemberRef.nullable(),
  startsAt: DateTime,
  endsAt: DateTime,
  message: z.string(),
});
export type SchedulingConflict = z.infer<typeof SchedulingConflict>;

/** "No Conflicts - Octavia Holder is available at this time", or the conflicts and alternatives. */
export const ConflictResult = z.object({
  ok: z.boolean(),
  conflicts: z.array(SchedulingConflict),
  alternatives: z.array(z.object({ startsAt: DateTime, endsAt: DateTime })).max(10),
  /** The signed-in person may override (with a reason, audited). */
  canOverride: z.boolean(),
});
export type ConflictResult = z.infer<typeof ConflictResult>;

/** GET /business/availability/day: one staff member's day, with the proposed time checked. */
export const StaffDayQuery = z.strictObject({
  staffUserId: z.uuid(),
  date: CalendarDate,
  startsAt: DateTime.optional(),
  endsAt: DateTime.optional(),
  excludeAppointmentId: z.uuid().optional(),
});
export type StaffDayQuery = z.input<typeof StaffDayQuery>;

export const StaffDay = z.object({
  staff: MemberRef,
  date: CalendarDate,
  timezone: z.string(),
  blocks: z.array(AvailabilityBlock),
  /** Present when startsAt and endsAt were given. */
  conflict: ConflictResult.nullable(),
});
export type StaffDay = z.infer<typeof StaffDay>;

/** POST /business/appointments/conflicts: the whole check before saving (all staff, room, series). */
export const ConflictCheckRequest = z.strictObject({
  staffUserIds: z.array(z.uuid()).min(1).max(5),
  startsAt: DateTime,
  endsAt: DateTime,
  contact: ContactInput.optional(),
  roomId: z.uuid().nullable().optional(),
  recurrence: AppointmentRecurrence.optional(),
  excludeAppointmentId: z.uuid().optional(),
});
export type ConflictCheckRequest = z.input<typeof ConflictCheckRequest>;

// ---------- Edit My Availability ----------

export const TimeRangeOfDay = z.strictObject({ startsAt: TimeOfDay, endsAt: TimeOfDay });
export type TimeRangeOfDay = z.infer<typeof TimeRangeOfDay>;

/**
 * Availability rules beyond the weekly hours (api.availability.setWorkingHours) and blocked
 * time (api.availability.block), which R12 already has. New table (to build).
 */
export const AvailabilityRules = z.object({
  userId: z.uuid(),
  /** Hours for one date instead of the weekly ones; empty ranges = day off. */
  dateOverrides: z.array(z.object({ date: CalendarDate, ranges: z.array(TimeRangeOfDay) })),
  /** Time Off / Vacation, inclusive dates. */
  timeOff: z.array(
    z.object({ id: z.uuid(), from: CalendarDate, to: CalendarDate, reason: z.string().nullable() }),
  ),
  bufferBeforeMinutes: z.number().int(),
  bufferAfterMinutes: z.number().int(),
  minNoticeHours: z.number().int(),
  maxWindowDays: z.number().int(),
  /** Connected calendars whose busy time blocks Firmivra (Integrations; empty until then). */
  busyCalendarIds: z.array(z.string()),
  effectiveFrom: CalendarDate.nullable(),
  updatedAt: DateTime.nullable(),
});
export type AvailabilityRules = z.infer<typeof AvailabilityRules>;

export const SetAvailabilityRulesRequest = z.strictObject({
  dateOverrides: z
    .array(z.strictObject({ date: CalendarDate, ranges: z.array(TimeRangeOfDay).max(4) }))
    .max(100)
    .optional(),
  timeOff: z
    .array(
      z.strictObject({
        from: CalendarDate,
        to: CalendarDate,
        reason: clearable(text(200)),
      }),
    )
    .max(50)
    .optional(),
  bufferBeforeMinutes: z.number().int().min(0).max(120).optional(),
  bufferAfterMinutes: z.number().int().min(0).max(120).optional(),
  minNoticeHours: z.number().int().min(0).max(720).optional(),
  maxWindowDays: z.number().int().min(1).max(730).optional(),
  busyCalendarIds: z.array(z.string().max(200)).max(10).optional(),
  effectiveFrom: CalendarDate.nullable().optional(),
});
export type SetAvailabilityRulesRequest = z.input<typeof SetAvailabilityRulesRequest>;

// ---------- Manage Appointment Types (configuration beyond R12's type) ----------

export const AppointmentTypeConfig = z.object({
  typeId: z.uuid(),
  description: z.string().nullable(),
  serviceId: z.uuid().nullable(),
  /** Empty: anyone. */
  eligibleStaffUserIds: z.array(z.uuid()),
  methods: z.array(MeetingMethod),
  officeIds: z.array(z.uuid()),
  bufferBeforeMinutes: z.number().int(),
  bufferAfterMinutes: z.number().int(),
  minNoticeHours: z.number().int(),
  maxWindowDays: z.number().int(),
  requiredIntakeFormId: z.uuid().nullable(),
  requiredDocuments: z.array(z.string()),
  defaultReminders: z.array(AppointmentReminder),
  color: z.string().nullable(),
});
export type AppointmentTypeConfig = z.infer<typeof AppointmentTypeConfig>;

export const SetAppointmentTypeConfigRequest = z.strictObject({
  description: clearable(text(500, 'many')),
  serviceId: z.uuid().nullable().optional(),
  eligibleStaffUserIds: z.array(z.uuid()).max(200).optional(),
  methods: z.array(MeetingMethod).min(1).optional(),
  officeIds: z.array(z.uuid()).max(50).optional(),
  bufferBeforeMinutes: z.number().int().min(0).max(120).optional(),
  bufferAfterMinutes: z.number().int().min(0).max(120).optional(),
  minNoticeHours: z.number().int().min(0).max(720).optional(),
  maxWindowDays: z.number().int().min(1).max(730).optional(),
  requiredIntakeFormId: z.uuid().nullable().optional(),
  requiredDocuments: z.array(text(100)).max(20).optional(),
  defaultReminders: z.array(AppointmentReminder).max(10).optional(),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .nullable()
    .optional(),
});
export type SetAppointmentTypeConfigRequest = z.input<typeof SetAppointmentTypeConfigRequest>;

// ---------- Notice settings and actions ----------

/** GET/PUT /business/appointments/settings: the firm master email rule and defaults. */
export const AppointmentNoticeSettings = z.object({
  /** Settings > Company Profile's Primary/Admin Email; null until set there. */
  masterEmail: z.string().nullable(),
  copyMasterOnChanges: z.boolean(),
  copyMasterOnReminders: z.boolean(),
  defaultReminders: z.array(AppointmentReminder),
});
export type AppointmentNoticeSettings = z.infer<typeof AppointmentNoticeSettings>;

export const SetAppointmentNoticeSettingsRequest = z.strictObject({
  copyMasterOnChanges: z.boolean().optional(),
  copyMasterOnReminders: z.boolean().optional(),
  defaultReminders: z.array(AppointmentReminder).max(10).optional(),
});
export type SetAppointmentNoticeSettingsRequest = z.input<
  typeof SetAppointmentNoticeSettingsRequest
>;

/** POST /business/appointments/{id}/send-reminder: now, without changing the schedule. */
export const SendReminderRequest = z.strictObject({
  channels: z.array(ReminderChannel).min(1).optional(),
});
export type SendReminderRequest = z.input<typeof SendReminderRequest>;

/** Quick Actions > Send Appointment Reminders: these, or every upcoming one in `withinDays`. */
export const SendRemindersRequest = z
  .strictObject({
    appointmentIds: z.array(z.uuid()).min(1).max(200).optional(),
    withinDays: z.number().int().min(1).max(14).optional(),
  })
  .refine((b) => (b.appointmentIds === undefined) !== (b.withinDays === undefined), {
    message: 'Choose appointments or a number of days',
  });
export type SendRemindersRequest = z.input<typeof SendRemindersRequest>;

export const RemindersSent = z.object({
  sent: z.number().int(),
  /** No reachable channel (no email, SMS off), or not permitted. */
  skipped: z.number().int(),
});
export type RemindersSent = z.infer<typeof RemindersSent>;

/** Mark Completed, No-Show, Cancel with a note for the history. */
export const AppointmentNoteRequest = z.strictObject({ text: text(2000, 'many') });
export type AppointmentNoteRequest = z.input<typeof AppointmentNoteRequest>;

export const SchedulingErrorCode = z.enum([
  /** 409: the time conflicts (see the check's answer); override with a reason if permitted. */
  'SCHEDULING_CONFLICT',
  /** 409: someone saved the appointment after it was loaded. */
  'SAVE_CONFLICT',
  /** 409: "Generate Zoom Link" with no video integration connected. */
  'VIDEO_NOT_CONNECTED',
  /** 400: SMS reminders while the firm has no SMS sender or the contact no phone. */
  'SMS_UNAVAILABLE',
]);
export type SchedulingErrorCode = z.infer<typeof SchedulingErrorCode>;
