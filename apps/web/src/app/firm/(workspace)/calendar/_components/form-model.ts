import {
  type AppointmentContact,
  type AppointmentRecord,
  type AppointmentReminder,
  type MeetingMethod,
  type ReminderChannel,
  type ReminderUnit,
  type ScheduleAppointmentRequest,
  type SchedulingOptions,
} from '@firmivra/types';
import { addDays, localParts, toInstant } from './time';

/** The Schedule Appointment form, as the person edits it (strings and flags; the request is built on save). */
export type Recurrence = 'NONE' | 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'CUSTOM';

export interface ReminderRow {
  on: boolean;
  amount: number;
  unit: ReminderUnit;
}

export interface FormState {
  /** An existing client or lead picked in the search box. */
  picked: AppointmentContact | null;
  /** A contact typed in (docx 3 step 2): used when `picked` is null and `newContact` is on. */
  newContact: boolean;
  contactName: string;
  businessName: string;
  email: string;
  phone: string;
  clientType: 'INDIVIDUAL' | 'BUSINESS';
  typeId: string;
  serviceId: string;
  date: string;
  start: string;
  end: string;
  timezone: string;
  allDay: boolean;
  method: MeetingMethod;
  officeId: string;
  roomId: string;
  details: string;
  generateVideo: boolean;
  videoUrl: string;
  staffIds: string[];
  status: 'PENDING' | 'CONFIRMED';
  color: string;
  internalNotes: string;
  clientInstructions: string;
  reminders: Record<ReminderChannel, ReminderRow>;
  sendConfirmation: boolean;
  recurrence: Recurrence;
  recurrenceInterval: number;
  recurrenceCount: number;
  overrideReason: string;
}

export const REMINDER_UNITS: { value: ReminderUnit; label: string }[] = [
  { value: 'MINUTES', label: 'min before' },
  { value: 'HOURS', label: 'hr before' },
  { value: 'DAYS', label: 'day before' },
  { value: 'WEEKS', label: 'wk before' },
];

export const COLORS: { value: string; label: string }[] = [
  { value: '', label: 'Type colour' },
  { value: '#2563eb', label: 'Blue' },
  { value: '#e11d48', label: 'Red' },
  { value: '#16a34a', label: 'Green' },
  { value: '#d97706', label: 'Amber' },
  { value: '#7c3aed', label: 'Purple' },
  { value: '#0891b2', label: 'Teal' },
];

/** Time zones offered next to the firm's own. */
const ZONES = [
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'America/Anchorage',
  'Pacific/Honolulu',
];

/** "(GMT-04:00) Eastern Time (ET)" for an IANA zone, now. */
export function zoneLabel(zone: string): string {
  try {
    const long = new Intl.DateTimeFormat('en-US', {
      timeZone: zone,
      timeZoneName: 'longGeneric',
    })
      .formatToParts(Date.now())
      .find((p) => p.type === 'timeZoneName')?.value;
    const short = new Intl.DateTimeFormat('en-US', { timeZone: zone, timeZoneName: 'short' })
      .formatToParts(Date.now())
      .find((p) => p.type === 'timeZoneName')?.value;
    const offset =
      new Intl.DateTimeFormat('en-US', { timeZone: zone, timeZoneName: 'longOffset' })
        .formatToParts(Date.now())
        .find((p) => p.type === 'timeZoneName')?.value ?? 'GMT';
    const gmt = offset === 'GMT' ? 'GMT+00:00' : offset;
    return `(${gmt}) ${long ?? zone}${short ? ` (${short})` : ''}`;
  } catch {
    return zone;
  }
}

export const zoneOptions = (firmZone: string) =>
  [firmZone, ...ZONES.filter((z) => z !== firmZone)].map((value) => ({
    value,
    label: zoneLabel(value),
  }));

/** Every quarter hour of the day, '06:00' to '21:45': the start and end pickers. */
export const TIMES = Array.from({ length: 64 }, (_, i) => {
  const minutes = 6 * 60 + i * 15;
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
});

/** "9:00 AM" from '09:00'. */
export const timeText = (hhmm: string) => {
  const [h = 0, m = 0] = hhmm.split(':').map(Number);
  return `${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
};

export const minutesOf = (hhmm: string) => {
  const [h = 0, m = 0] = hhmm.split(':').map(Number);
  return h * 60 + m;
};
export const hhmmOf = (minutes: number) =>
  `${String(Math.floor(minutes / 60) % 24).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;

/** "1 hour", "1 hour 30 minutes", "45 minutes". */
export function durationText(minutes: number): string {
  if (minutes <= 0) return '';
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return [h ? `${h} hour${h === 1 ? '' : 's'}` : '', m ? `${m} minutes` : '']
    .filter(Boolean)
    .join(' ');
}

const noReminder = (channel: ReminderChannel): ReminderRow => ({
  on: false,
  amount: 1,
  unit: channel === 'SMS' ? 'HOURS' : 'DAYS',
});

export function blankForm(timeZone: string, date: string, start = '10:00'): FormState {
  return {
    picked: null,
    newContact: false,
    contactName: '',
    businessName: '',
    email: '',
    phone: '',
    clientType: 'INDIVIDUAL',
    typeId: '',
    serviceId: '',
    date,
    start,
    end: hhmmOf(Math.min(minutesOf(start) + 60, 23 * 60 + 45)),
    timezone: timeZone,
    allDay: false,
    method: 'IN_PERSON',
    officeId: '',
    roomId: '',
    details: '',
    generateVideo: false,
    videoUrl: '',
    staffIds: [],
    status: 'CONFIRMED',
    color: '',
    internalNotes: '',
    clientInstructions: '',
    reminders: {
      EMAIL: { ...noReminder('EMAIL'), on: true },
      SMS: noReminder('SMS'),
      PORTAL: noReminder('PORTAL'),
    },
    sendConfirmation: true,
    recurrence: 'NONE',
    recurrenceInterval: 1,
    recurrenceCount: 4,
    overrideReason: '',
  };
}

/** Edit Existing: the form filled from the appointment's record. */
export function formFromRecord(record: AppointmentRecord): FormState {
  const zone = record.timezone;
  const start = localParts(record.startsAt, zone);
  const end = localParts(record.endsAt, zone);
  const reminders = blankForm(zone, start.date).reminders;
  reminders.EMAIL.on = false;
  for (const r of record.reminders)
    reminders[r.channel] = { on: true, amount: r.amount, unit: r.unit };
  return {
    ...blankForm(zone, start.date, start.time),
    picked: record.internal ? null : record.contact,
    typeId: record.type?.id ?? '',
    serviceId: record.service?.id ?? '',
    start: start.time,
    end: end.time,
    allDay: record.allDay,
    method: record.method,
    officeId: record.place.office?.id ?? '',
    roomId: record.place.room?.id ?? '',
    details: record.place.details ?? '',
    videoUrl: record.videoUrl ?? '',
    staffIds: record.staff.map((s) => s.userId),
    status: record.status === 'PENDING' ? 'PENDING' : 'CONFIRMED',
    color: record.color && COLORS.some((c) => c.value === record.color) ? record.color : '',
    internalNotes: record.internalNotes ?? '',
    clientInstructions: record.clientInstructions ?? '',
    reminders,
    sendConfirmation: false,
    recurrence: record.recurrence?.frequency ?? 'NONE',
    recurrenceInterval: record.recurrence?.interval ?? 1,
    recurrenceCount: record.recurrence?.count ?? 4,
  };
}

/** The proposed time as instants; null while the date or times are not valid. */
export function rangeOf(form: FormState): { startsAt: string; endsAt: string } | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(form.date)) return null;
  try {
    if (form.allDay) {
      return {
        startsAt: toInstant(form.date, '00:00', form.timezone),
        endsAt: toInstant(addDays(form.date, 1), '00:00', form.timezone),
      };
    }
    if (!form.start || !form.end || minutesOf(form.end) <= minutesOf(form.start)) return null;
    return {
      startsAt: toInstant(form.date, form.start, form.timezone),
      endsAt: toInstant(form.date, form.end, form.timezone),
    };
  } catch {
    return null;
  }
}

export const remindersOf = (form: FormState): AppointmentReminder[] =>
  (Object.keys(form.reminders) as ReminderChannel[])
    .filter((channel) => form.reminders[channel].on)
    .map((channel) => ({
      channel,
      amount: form.reminders[channel].amount,
      unit: form.reminders[channel].unit,
    }));

/** What is missing or wrong, per field, before any request is sent. */
export function problems(form: FormState, options: SchedulingOptions | undefined) {
  const found: Partial<Record<'contact' | 'email' | 'type' | 'time' | 'staff' | 'video', string>> =
    {};
  if (!form.picked) {
    if (!form.newContact || !form.contactName.trim())
      found.contact = 'Choose a client or lead, or add a new contact';
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim()))
      found.email = 'Enter a valid email address';
  }
  if (!form.typeId) found.type = 'Choose an appointment type';
  if (!rangeOf(form)) found.time = 'Choose a date, and an end time after the start';
  if (form.staffIds.length === 0) found.staff = 'Choose a staff member';
  if (form.generateVideo && options && !options.videoProvider)
    found.video = 'No video integration is connected. Paste a meeting link instead.';
  return found;
}

/** The body of POST /schedule (or the fields of PATCH /details), from the form. */
export function requestFrom(
  form: FormState,
  idempotencyKey: string,
): ScheduleAppointmentRequest | null {
  const range = rangeOf(form);
  if (!range) return null;
  const contact: ScheduleAppointmentRequest['contact'] = form.picked
    ? form.picked.kind === 'CLIENT'
      ? { kind: 'CLIENT', id: form.picked.id ?? '' }
      : form.picked.kind === 'LEAD'
        ? { kind: 'LEAD', id: form.picked.id ?? '' }
        : {
            kind: 'CONTACT',
            name: form.picked.name,
            email: form.picked.email ?? '',
            clientType: form.picked.clientType ?? 'INDIVIDUAL',
          }
    : {
        kind: 'CONTACT',
        name: form.contactName,
        businessName: form.businessName,
        email: form.email,
        phone: form.phone,
        clientType: form.clientType,
      };
  return {
    idempotencyKey,
    contact,
    typeId: form.typeId,
    serviceId: form.serviceId || null,
    ...range,
    timezone: form.timezone,
    allDay: form.allDay,
    method: form.method,
    officeId: form.officeId || null,
    roomId: form.roomId || null,
    details: form.details,
    generateVideoLink: form.method === 'VIDEO' && form.generateVideo,
    ...(form.method === 'VIDEO' && !form.generateVideo && form.videoUrl.trim()
      ? { videoUrl: form.videoUrl.trim() }
      : {}),
    staffUserIds: form.staffIds,
    status: form.status,
    color: form.color || null,
    internalNotes: form.internalNotes,
    clientInstructions: form.clientInstructions,
    reminders: remindersOf(form),
    sendConfirmation: form.sendConfirmation,
    ...(form.recurrence !== 'NONE'
      ? {
          recurrence: {
            frequency: form.recurrence,
            interval: form.recurrenceInterval,
            count: form.recurrenceCount,
          },
        }
      : {}),
    ...(form.overrideReason.trim()
      ? { overrideConflicts: { reason: form.overrideReason.trim() } }
      : {}),
  };
}

/** The fields a saved draft (or Duplicate) carries that the form can take. */
export function fromDraft(data: Record<string, unknown>): Partial<FormState> {
  const text = (key: string) => (typeof data[key] === 'string' ? (data[key] as string) : undefined);
  const methods: MeetingMethod[] = ['IN_PERSON', 'PHONE', 'VIDEO', 'OTHER'];
  const method = methods.find((m) => m === data['method']);
  const staff = Array.isArray(data['staffUserIds'])
    ? data['staffUserIds'].filter((id): id is string => typeof id === 'string')
    : [];
  return {
    ...(text('typeId') ? { typeId: text('typeId') as string } : {}),
    ...(text('serviceId') ? { serviceId: text('serviceId') as string } : {}),
    ...(text('internalNotes') ? { internalNotes: text('internalNotes') as string } : {}),
    ...(text('clientInstructions')
      ? { clientInstructions: text('clientInstructions') as string }
      : {}),
    ...(method ? { method } : {}),
    ...(staff.length ? { staffIds: staff } : {}),
  };
}
