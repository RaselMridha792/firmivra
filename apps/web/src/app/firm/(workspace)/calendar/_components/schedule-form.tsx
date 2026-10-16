'use client';

import {
  type AppointmentContact,
  type AppointmentRecord,
  type MeetingMethod,
  type ReminderChannel,
  type ReminderUnit,
  ScheduleAppointmentRequest,
  type SchedulingOptions,
} from '@firmivra/types';
import { Button, Callout, Checkbox, Input, Select, Skeleton, Textarea, Toggle } from '@firmivra/ui';
import {
  ArrowLeft,
  ArrowRight,
  Bell,
  CalendarBlank,
  CaretDown,
  CaretRight,
  ClipboardText,
  Copy,
  Info,
  Lightbulb,
  MagnifyingGlass,
  NotePencil,
  Repeat,
  User,
  UsersThree,
} from '@phosphor-icons/react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { type ReactNode, createElement, useState } from 'react';
import { api } from '../../../../../lib/api';
import { errorCode, errorMessage } from '../../../../../lib/errors';
import { useApiMutation, useApiQuery } from '../../../../../lib/query';
import { MultiPick } from '../../team/new/_components/multi-pick';
import { METHOD_LABELS, NOT_LOADED, SCHEDULING, STATUS_LOOKS } from './appointments-parts';
import { TONE_DOTS, TONE_NAMES, colourTone } from './colour';
import { StaffDayPanel } from './staff-day-panel';
import { localParts, todayIn, toInstant } from './time';

const TIME_ZONES: [string, string][] = [
  ['America/New_York', '(GMT-05:00) Eastern Time (ET)'],
  ['America/Chicago', '(GMT-06:00) Central Time (CT)'],
  ['America/Denver', '(GMT-07:00) Mountain Time (MT)'],
  ['America/Phoenix', '(GMT-07:00) Arizona'],
  ['America/Los_Angeles', '(GMT-08:00) Pacific Time (PT)'],
];

/** Every half hour from 6 AM to 9 PM. */
const TIMES = Array.from({ length: 31 }, (_, i) => {
  const minutes = 6 * 60 + i * 30;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  const value = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  const label = `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
  return { value, label };
});

const UNITS: [ReminderUnit, string][] = [
  ['HOURS', 'hours before'],
  ['DAYS', 'days before'],
  ['WEEKS', 'weeks before'],
];

const SCHEDULE_ERRORS: Record<string, string> = {
  SCHEDULING_CONFLICT: 'This time conflicts with the staff member’s calendar.',
  SAVE_CONFLICT:
    'Someone saved this appointment while you were editing. Reload to see their changes, then make yours again.',
  VIDEO_NOT_CONNECTED:
    'No video integration is connected, so a Zoom link cannot be made. Paste a link instead.',
  SMS_UNAVAILABLE: 'Text reminders are not available for this firm or this contact.',
};

interface Reminder {
  on: boolean;
  amount: number;
  unit: ReminderUnit;
}

interface Form {
  contact: AppointmentContact | null;
  newContact: boolean;
  name: string;
  email: string;
  phone: string;
  clientType: 'INDIVIDUAL' | 'BUSINESS';
  businessName: string;
  typeId: string;
  serviceId: string;
  date: string;
  start: string;
  end: string;
  timezone: string;
  method: MeetingMethod;
  officeId: string;
  roomId: string;
  details: string;
  generateVideoLink: boolean;
  videoUrl: string;
  staffUserIds: string[];
  status: 'PENDING' | 'CONFIRMED';
  color: string;
  allDay: boolean;
  internalNotes: string;
  clientInstructions: string;
  reminders: Record<ReminderChannel, Reminder>;
  sendConfirmation: boolean;
  repeat: 'NONE' | 'DAILY' | 'WEEKLY' | 'MONTHLY';
  count: number;
}

/** A new form; `at` is the date and hour picked on the calendar (`?date=&time=`). */
function blank(o: SchedulingOptions, at?: { date: string; time: string }): Form {
  const start = at?.time ?? '10:00';
  const end = `${String(Math.min(Number(start.slice(0, 2)) + 1, 23)).padStart(2, '0')}:${start.slice(3, 5)}`;
  return {
    contact: null,
    newContact: false,
    name: '',
    email: '',
    phone: '',
    clientType: 'INDIVIDUAL',
    businessName: '',
    typeId: '',
    serviceId: '',
    date: at?.date ?? todayIn(o.timezone),
    start,
    end,
    timezone: o.timezone,
    method: 'IN_PERSON',
    officeId: o.offices?.[0]?.id ?? '',
    roomId: '',
    details: '',
    generateVideoLink: false,
    videoUrl: '',
    staffUserIds: o.staff[0] ? [o.staff[0].userId] : [],
    status: 'CONFIRMED',
    color: '',
    allDay: false,
    internalNotes: '',
    clientInstructions: '',
    reminders: {
      EMAIL: { on: true, amount: 1, unit: 'DAYS' },
      SMS: { on: o.smsEnabled, amount: 1, unit: 'DAYS' },
      PORTAL: { on: o.portalEnabled, amount: 1, unit: 'DAYS' },
    },
    sendConfirmation: false,
    repeat: 'NONE',
    count: 4,
  };
}

function fromRecord(r: AppointmentRecord, o: SchedulingOptions): Form {
  const start = localParts(r.startsAt, r.timezone);
  const end = localParts(r.endsAt, r.timezone);
  const base = blank(o);
  const reminders = { ...base.reminders };
  for (const ch of ['EMAIL', 'SMS', 'PORTAL'] as const) {
    const m = r.reminders.find((x) => x.channel === ch);
    reminders[ch] = m
      ? { on: true, amount: m.amount, unit: m.unit }
      : { ...reminders[ch], on: false };
  }
  return {
    ...base,
    contact: r.contact,
    typeId: r.type?.id ?? '',
    serviceId: r.service?.id ?? '',
    date: start.date,
    start: start.time,
    end: end.time,
    timezone: r.timezone,
    method: r.method,
    officeId: r.place.office?.id ?? '',
    roomId: r.place.room?.id ?? '',
    details: r.place.details ?? '',
    videoUrl: r.videoUrl ?? '',
    staffUserIds: r.staff.map((s) => s.userId),
    status: r.status === 'PENDING' ? 'PENDING' : 'CONFIRMED',
    color: r.color ?? '',
    allDay: r.allDay,
    internalNotes: r.internalNotes ?? '',
    clientInstructions: r.clientInstructions ?? '',
    reminders,
    repeat: (r.recurrence?.frequency === 'CUSTOM' ? 'WEEKLY' : r.recurrence?.frequency) ?? 'NONE',
    count: r.recurrence?.count ?? 4,
  };
}

const minutesOf = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));

function Section({
  title,
  note,
  icon,
  action,
  children,
  testId,
  id,
  small,
}: {
  title: string;
  /** "(Optional)", small after the title. */
  note?: string;
  /** The three small cards at the bottom (Related Items, Client Reminders, Recurrence). */
  small?: boolean;
  icon: typeof User;
  action?: ReactNode;
  children: ReactNode;
  testId?: string;
  id?: string;
}) {
  return (
    <section
      id={id}
      aria-label={note ? `${title} ${note}` : title}
      data-testid={testId}
      className="flex min-w-0 flex-col gap-3 rounded-xl border border-divider bg-surface p-4 shadow-sm"
    >
      <div className={`flex items-center ${small ? 'gap-2' : 'gap-3'}`}>
        <span
          aria-hidden
          className={`flex shrink-0 items-center justify-center rounded-lg bg-action text-on-action ${small ? 'size-8' : 'size-9'}`}
        >
          {createElement(icon, { weight: 'fill', className: small ? 'size-4' : 'size-5' })}
        </span>
        <h2 className={`min-w-0 flex-1 font-bold text-heading ${small ? 'text-base' : 'text-lg'}`}>
          {title}
          {note ? (
            <>
              {' '}
              <span className="text-xs font-normal text-link">{note}</span>
            </>
          ) : null}
        </h2>
        {action}
      </div>
      {children}
    </section>
  );
}

/** Two to four choices drawn as joined buttons (Individual / Business, In Person / Phone ...). */
function Segmented<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: [T, string][];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="flex flex-col gap-1">
      <span className="text-sm font-medium text-text">{label}</span>
      <div className="flex overflow-hidden rounded-control border border-border">
        {options.map(([v, l]) => (
          <button
            key={v}
            type="button"
            role="radio"
            aria-checked={value === v}
            onClick={() => onChange(v)}
            className={`min-h-11 flex-1 border-r border-border px-2 text-sm whitespace-nowrap last:border-r-0 ${value === v ? 'bg-action font-semibold text-on-action' : 'bg-surface text-heading hover:bg-canvas'}`}
          >
            {l}
          </button>
        ))}
      </div>
    </div>
  );
}

/**
 * Schedule Appointment (appointments-overview-and-calendar.jpg, guide §3-5, §11-12, §16): Create
 * New (`api.scheduling.schedule`, retry-safe) or Edit Existing (`updateDetails` with `version`),
 * with the Staff Availability panel, the Appointment Summary and the Pro Tip. A conflict
 * (409 SCHEDULING_CONFLICT) shows what clashes; an Owner or Admin may book anyway with a reason.
 */
export function ScheduleForm({
  record,
  at,
}: {
  record?: AppointmentRecord;
  /** The date and hour picked on the calendar (`/calendar/new?date=&time=`). */
  at?: { date: string; time: string };
}) {
  const options = useApiQuery([...SCHEDULING, 'options'], () => api.scheduling.options());
  const header = <ScheduleHeader editing={Boolean(record)} />;
  if (options.data)
    return <FormBody options={options.data} record={record} at={at} header={header} />;
  return (
    <div className="grid grid-cols-1 items-start gap-4 min-[1440px]:grid-cols-[1fr_22rem]">
      <div className="flex min-w-0 flex-col gap-4">
        {header}
        {['Client Information', 'Appointment Details', 'Staff & Status'].map((t) => (
          <Section key={t} title={t} icon={CalendarBlank}>
            {options.isPending ? (
              <Skeleton className="h-32" />
            ) : (
              <p className="rounded-lg bg-subtle p-4 text-sm text-muted">{NOT_LOADED}</p>
            )}
          </Section>
        ))}
      </div>
      <Section title="Staff Availability" icon={UsersThree}>
        {options.isPending ? (
          <Skeleton className="h-96" />
        ) : (
          <p className="rounded-lg bg-subtle p-4 text-sm text-muted">{NOT_LOADED}</p>
        )}
      </Section>
    </div>
  );
}

export function ScheduleHeader({ editing }: { editing: boolean }) {
  return (
    <header className="flex flex-col gap-3">
      <nav aria-label="Breadcrumb" className="flex items-center gap-2 text-sm">
        <Link href="/calendar" className="text-link hover:underline">
          Appointments
        </Link>
        <CaretRight aria-hidden weight="bold" className="size-3 text-muted" />
        <span aria-current="page" className="font-semibold text-heading">
          {editing ? 'Edit Appointment' : 'Create Appointment'}
        </span>
      </nav>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <Link
            href="/calendar"
            className="inline-flex min-h-11 items-center gap-2 rounded-control border border-action px-3 text-sm font-semibold text-action hover:bg-folder-surface"
          >
            <ArrowLeft aria-hidden weight="bold" className="size-4" />
            Back to Appointments
          </Link>
          <div className="min-w-0">
            <h1 data-testid="page-title" className="text-2xl font-bold text-heading">
              Schedule Appointment
            </h1>
            <p className="text-sm text-text">Create a new appointment or edit an existing one.</p>
          </div>
        </div>
        <nav
          aria-label="Create or edit"
          className="flex rounded-xl border border-divider bg-surface p-1"
        >
          <Link
            href="/calendar/new"
            aria-current={editing ? undefined : 'page'}
            className={`inline-flex min-h-10 items-center rounded-lg px-4 text-sm font-semibold ${editing ? 'text-action hover:bg-folder-surface' : 'bg-action text-on-action'}`}
          >
            Create New
          </Link>
          <Link
            href="/calendar/list"
            aria-current={editing ? 'page' : undefined}
            className={`inline-flex min-h-10 items-center rounded-lg px-4 text-sm font-semibold ${editing ? 'bg-action text-on-action' : 'text-action hover:bg-folder-surface'}`}
          >
            Edit Existing
          </Link>
        </nav>
      </div>
    </header>
  );
}

function FormBody({
  options: o,
  record,
  at,
  header,
}: {
  options: SchedulingOptions;
  record?: AppointmentRecord;
  at?: { date: string; time: string };
  header: ReactNode;
}) {
  const router = useRouter();
  const [form, setForm] = useState<Form>(() => (record ? fromRecord(record, o) : blank(o, at)));
  const [copied, setCopied] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [search, setSearch] = useState('');
  const [key] = useState(() => crypto.randomUUID());
  const [draftId, setDraftId] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [override, setOverride] = useState('');
  const [panelStaff, setPanelStaff] = useState(form.staffUserIds[0] ?? o.staff[0]?.userId ?? '');
  const set = <K extends keyof Form>(k: K, v: Form[K]) => {
    setForm((f) => ({ ...f, [k]: v }));
    setNote('');
  };
  const contacts = useApiQuery([...SCHEDULING, 'contacts', search], () =>
    search.trim().length >= 2
      ? api.scheduling.contacts({ search: search.trim() })
      : Promise.resolve([]),
  );
  const type = o.types.find((t) => t.id === form.typeId);
  const startsAt = toInstant(form.date, form.allDay ? '00:00' : form.start, form.timezone);
  const endsAt = toInstant(form.date, form.allDay ? '23:59' : form.end, form.timezone);
  const minutes = minutesOf(form.end) - minutesOf(form.start);
  const rooms = (o.rooms ?? []).filter((r) => !form.officeId || r.officeId === form.officeId);

  const contactInput = () =>
    form.newContact
      ? {
          kind: 'CONTACT' as const,
          name: form.name.trim(),
          email: form.email.trim(),
          phone: form.phone.trim() || null,
          clientType: form.clientType,
          businessName: form.businessName.trim() || null,
        }
      : form.contact?.id && form.contact.kind !== 'CONTACT'
        ? { kind: form.contact.kind, id: form.contact.id }
        : null;

  const fields = () => ({
    contact: contactInput(),
    typeId: form.typeId,
    serviceId: form.serviceId || null,
    startsAt,
    endsAt,
    timezone: form.timezone,
    allDay: form.allDay,
    method: form.method,
    officeId: form.method === 'IN_PERSON' ? form.officeId || null : null,
    roomId: form.method === 'IN_PERSON' ? form.roomId || null : null,
    details: form.details.trim() || null,
    generateVideoLink: form.method === 'VIDEO' && form.generateVideoLink,
    videoUrl:
      form.method === 'VIDEO' && !form.generateVideoLink && form.videoUrl.trim()
        ? form.videoUrl.trim()
        : null,
    staffUserIds: form.staffUserIds,
    status: form.status,
    color: form.color || null,
    internalNotes: form.internalNotes.trim() || null,
    clientInstructions: form.clientInstructions.trim() || null,
    reminders: (['EMAIL', 'SMS', 'PORTAL'] as const)
      .filter((ch) => form.reminders[ch].on)
      .map((ch) => ({
        channel: ch,
        amount: form.reminders[ch].amount,
        unit: form.reminders[ch].unit,
      })),
    sendConfirmation: form.sendConfirmation,
    ...(form.repeat === 'NONE'
      ? {}
      : { recurrence: { frequency: form.repeat, interval: 1, count: form.count } }),
  });

  const check = () => {
    const found: Record<string, string> = {};
    const c = contactInput();
    if (!c)
      found.contact = form.newContact
        ? 'Enter the contact’s name and email.'
        : 'Choose a client or lead, or add a new contact.';
    if (form.newContact && (!form.name.trim() || !/^\S+@\S+\.\S+$/.test(form.email.trim())))
      found.contact = 'Enter the contact’s name and a valid email.';
    if (!form.typeId) found.typeId = 'Choose an appointment type.';
    if (!form.allDay && minutes <= 0) found.end = 'End time must be after the start.';
    if (!form.staffUserIds.length) found.staff = 'Choose a staff member.';
    if (!found.contact && !found.typeId) {
      const result = ScheduleAppointmentRequest.safeParse({ idempotencyKey: key, ...fields() });
      if (!result.success) {
        for (const issue of result.error.issues) {
          const f = String(issue.path[0] ?? 'form');
          found[f] ??= issue.message;
        }
      }
    }
    setErrors(found);
    return Object.keys(found).length === 0;
  };

  const schedule = useApiMutation(
    (body: Parameters<typeof api.scheduling.schedule>[0]) => api.scheduling.schedule(body),
    { invalidate: SCHEDULING },
  );
  const update = useApiMutation(
    (body: Parameters<typeof api.scheduling.updateDetails>[1]) =>
      api.scheduling.updateDetails(record?.id ?? '', body),
    { invalidate: SCHEDULING },
  );
  const draft = useApiMutation(
    (body: Parameters<typeof api.scheduling.createDraft>[0]) =>
      draftId ? api.scheduling.saveDraft(draftId, body) : api.scheduling.createDraft(body),
    { invalidate: SCHEDULING },
  );
  const busy = schedule.isPending || update.isPending || draft.isPending;
  const failure = schedule.error ?? update.error ?? draft.error;
  const conflict = errorCode(schedule.error) === 'SCHEDULING_CONFLICT';

  const submit = () => {
    if (!check()) return;
    const c = contactInput();
    if (!c) return;
    const body = { ...fields(), contact: c };
    if (record) {
      update.mutate(
        { version: record.version, ...body },
        { onSuccess: (r) => router.push(`/calendar/${r.id}`) },
      );
    } else {
      schedule.mutate(
        {
          idempotencyKey: key,
          ...body,
          ...(conflict && override.trim()
            ? { overrideConflicts: { reason: override.trim() } }
            : {}),
        },
        { onSuccess: (r) => router.push(`/calendar/${r.id}`) },
      );
    }
  };
  const saveDraft = () => {
    const { contact, ...rest } = fields();
    draft.mutate(
      { ...rest, ...(contact ? { contact } : {}), ...(form.typeId ? {} : { typeId: undefined }) },
      {
        onSuccess: (d) => {
          setDraftId(d.id);
          setNote('Draft saved. Nothing is booked or sent until you schedule it.');
        },
      },
    );
  };

  const typeName = type?.name ?? '—';
  const staffNames = o.staff.filter((s) => form.staffUserIds.includes(s.userId)).map((s) => s.name);
  const office = o.offices?.find((x) => x.id === form.officeId)?.name;
  const room = o.rooms?.find((x) => x.id === form.roomId)?.name;
  const dateLabel = new Date(`${form.date}T12:00:00Z`).toLocaleDateString('en-US', {
    timeZone: 'UTC',
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
  const timeLabel = (t: string) => TIMES.find((x) => x.value === t)?.label ?? t;
  // Colour choices are the firm's own appointment type colours (data), named by their tone; a
  // tone two colours share gets the type's name too.
  const typeColours = [
    ...new Map(o.types.filter((t) => colourTone(t.color)).map((t) => [t.color ?? '', t.name])),
  ];
  const toneName = (value: string) => TONE_NAMES[colourTone(value) ?? 'grey'];
  const colourChoices = [
    { value: '', label: 'Type colour' },
    ...typeColours.map(([value, typeName]) => ({
      value,
      label:
        typeColours.filter(([v]) => toneName(v) === toneName(value)).length > 1
          ? `${toneName(value)} (${typeName})`
          : toneName(value),
    })),
  ];
  if (form.color && !colourChoices.some((c) => c.value === form.color)) {
    colourChoices.push({ value: form.color, label: 'Current colour' });
  }
  const dotTone = colourTone(form.color || type?.color);
  const contactName = form.newContact ? form.name || '—' : (form.contact?.name ?? '—');
  const zoneShort = TIME_ZONES.find(([z]) => z === form.timezone)?.[1].match(/\(([A-Z]+)\)$/)?.[1];
  const duration = form.allDay
    ? 'All day'
    : minutes > 0
      ? `${Math.floor(minutes / 60) ? `${Math.floor(minutes / 60)} hour${minutes >= 120 ? 's' : ''} ` : ''}${minutes % 60 ? `${minutes % 60} min` : ''}`.trim()
      : '—';
  const onReminders = (['EMAIL', 'SMS', 'PORTAL'] as const).filter((c) => form.reminders[c].on);
  const firstReminder = onReminders[0] ? form.reminders[onReminders[0]] : null;
  const sameTiming = onReminders.every(
    (c) =>
      form.reminders[c].amount === firstReminder?.amount &&
      form.reminders[c].unit === firstReminder.unit,
  );
  const remindersLabel = onReminders.length
    ? `${onReminders.map((c) => (c === 'EMAIL' ? 'Email' : c === 'SMS' ? 'SMS' : 'Portal')).join(', ')}${
        firstReminder && sameTiming
          ? ` (${firstReminder.amount} ${(UNITS.find(([u]) => u === firstReminder.unit)?.[1] ?? '').replace(/s before$/, firstReminder.amount === 1 ? ' before' : 's before')})`
          : ''
      }`
    : 'None';
  const grid = 'grid gap-4 md:grid-cols-2';

  return (
    <form
      noValidate
      aria-label={record ? 'Edit appointment' : 'Schedule appointment'}
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
      className="grid grid-cols-1 items-start gap-4 min-[1440px]:grid-cols-[1fr_22rem]"
    >
      <div className="flex min-w-0 flex-col gap-4">
        {header}
        <Section
          id="client-information"
          title="Client Information"
          icon={User}
          testId="client-information"
          action={
            form.contact?.kind === 'CLIENT' && form.contact.id && !form.newContact ? (
              <Link
                href={`/clients/${form.contact.id}`}
                className="text-sm font-semibold text-link hover:underline"
              >
                View Client Profile
              </Link>
            ) : null
          }
        >
          {form.newContact ? (
            <div className={grid}>
              <Input
                label="Name *"
                value={form.name}
                onChange={(e) => set('name', e.target.value)}
                maxLength={120}
              />
              <Segmented
                label="Client Type"
                options={[
                  ['INDIVIDUAL', 'Individual'],
                  ['BUSINESS', 'Business'],
                ]}
                value={form.clientType}
                onChange={(v) => set('clientType', v)}
              />
              <Input
                label="Phone"
                type="tel"
                placeholder="(000) 000-0000"
                value={form.phone}
                onChange={(e) => set('phone', e.target.value)}
              />
              <Input
                label="Email *"
                type="email"
                placeholder="client@email.com"
                value={form.email}
                onChange={(e) => set('email', e.target.value)}
              />
              {form.clientType === 'BUSINESS' ? (
                <Input
                  label="Business Name"
                  value={form.businessName}
                  onChange={(e) => set('businessName', e.target.value)}
                />
              ) : null}
            </div>
          ) : (
            <div className={grid}>
              <div className="relative flex min-w-0 flex-col gap-1">
                <Input
                  label="Client / Lead *"
                  placeholder="Search by name, email, phone, or ID..."
                  value={form.contact ? form.contact.name : search}
                  autoComplete="off"
                  className="pr-9 pl-9"
                  onChange={(e) => {
                    set('contact', null);
                    setSearch(e.target.value);
                  }}
                />
                <MagnifyingGlass
                  aria-hidden
                  weight="bold"
                  className="pointer-events-none absolute bottom-3.5 left-3 size-4 text-muted"
                />
                <CaretDown
                  aria-hidden
                  weight="bold"
                  className="pointer-events-none absolute right-3 bottom-3.5 size-4 text-muted"
                />
                {!form.contact && search.trim().length >= 2 ? (
                  <ul
                    data-testid="contact-results"
                    className="absolute top-full right-0 left-0 z-20 mt-1 max-h-60 overflow-y-auto rounded-card border border-border bg-surface p-1 shadow-card"
                  >
                    {contacts.isPending ? (
                      <li className="p-2 text-sm text-muted">Searching…</li>
                    ) : (contacts.data ?? []).length ? (
                      (contacts.data ?? []).map((c) => (
                        <li key={`${c.kind}-${c.id}`}>
                          <button
                            type="button"
                            onClick={() => set('contact', c)}
                            className="flex w-full flex-col items-start rounded-control px-2 py-1.5 text-left text-sm hover:bg-canvas"
                          >
                            <span className="font-semibold text-heading">{c.name}</span>
                            <span className="text-xs text-muted">
                              {c.kind === 'LEAD' ? 'Lead' : 'Client'} · {c.email ?? c.phone ?? ''}
                            </span>
                          </button>
                        </li>
                      ))
                    ) : (
                      <li className="p-2 text-sm text-muted">
                        No match. Add a new contact instead.
                      </li>
                    )}
                  </ul>
                ) : null}
              </div>
              <Segmented
                label="Client Type"
                options={[
                  ['INDIVIDUAL', 'Individual'],
                  ['BUSINESS', 'Business'],
                ]}
                value={form.contact?.clientType ?? 'INDIVIDUAL'}
                onChange={() => undefined}
              />
              <Input
                label="Phone"
                disabled
                readOnly
                value={form.contact?.phone ?? ''}
                placeholder="(000) 000-0000"
              />
              <Input
                label="Email"
                disabled
                readOnly
                value={form.contact?.email ?? ''}
                placeholder="client@email.com"
              />
            </div>
          )}
          {errors.contact ? <p className="text-xs text-danger">{errors.contact}</p> : null}
          {!record ? (
            <Button
              variant="ghost"
              className="self-start"
              onClick={() => {
                setForm((f) => ({ ...f, newContact: !f.newContact, contact: null }));
                setSearch('');
              }}
            >
              {form.newContact ? 'Search clients and leads instead' : 'Add a new contact'}
            </Button>
          ) : null}
        </Section>

        <Section title="Appointment Details" icon={CalendarBlank} testId="appointment-details">
          <div className={grid}>
            <Select
              label="Appointment Type *"
              options={[
                { value: '', label: 'Select appointment type...' },
                ...o.types.map((t) => ({ value: t.id, label: t.name })),
              ]}
              value={form.typeId}
              error={errors.typeId}
              onChange={(e) => {
                const t = o.types.find((x) => x.id === e.target.value);
                setForm((f) => {
                  const end = t
                    ? (() => {
                        const m = minutesOf(f.start) + t.durationMinutes;
                        return `${String(Math.min(Math.floor(m / 60), 23)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
                      })()
                    : f.end;
                  return {
                    ...f,
                    typeId: e.target.value,
                    end,
                    serviceId: f.serviceId || t?.serviceId || '',
                  };
                });
              }}
            />
            <Select
              label="Related Service"
              options={[
                { value: '', label: 'Select service (optional)' },
                ...o.services.map((s) => ({ value: s.id, label: s.name })),
              ]}
              value={form.serviceId}
              onChange={(e) => set('serviceId', e.target.value)}
            />
          </div>
          <div className="grid gap-4 md:grid-cols-4">
            <Input
              label="Date *"
              type="date"
              value={form.date}
              onChange={(e) => set('date', e.target.value)}
            />
            <Select
              label="Start Time *"
              disabled={form.allDay}
              options={TIMES}
              value={form.start}
              onChange={(e) => set('start', e.target.value)}
            />
            <Select
              label="End Time *"
              disabled={form.allDay}
              options={TIMES}
              value={form.end}
              error={errors.end}
              onChange={(e) => set('end', e.target.value)}
            />
            <Input
              label="Duration"
              disabled
              readOnly
              value={
                form.allDay
                  ? 'All day'
                  : minutes > 0
                    ? `${Math.floor(minutes / 60) ? `${Math.floor(minutes / 60)} hour${minutes >= 120 ? 's' : ''} ` : ''}${minutes % 60 ? `${minutes % 60} min` : ''}`.trim()
                    : '—'
              }
            />
          </div>
          <div className="grid gap-4 md:grid-cols-[1fr_1.4fr]">
            <Select
              label="Time Zone"
              options={(TIME_ZONES.some(([z]) => z === form.timezone)
                ? TIME_ZONES
                : [[form.timezone, form.timezone] as [string, string], ...TIME_ZONES]
              ).map(([value, label]) => ({ value, label }))}
              value={form.timezone}
              onChange={(e) => set('timezone', e.target.value)}
            />
            <Segmented
              label="Location Type *"
              options={(Object.entries(METHOD_LABELS) as [MeetingMethod, string][]).map(
                ([v, l]) => [v, v === 'IN_PERSON' ? 'In Person' : l],
              )}
              value={form.method}
              onChange={(v) => set('method', v)}
            />
          </div>
          {/* The design's row: Office / Branch, Room and Video Meeting Link, each used by its
              location type and greyed out for the others. */}
          <div className="grid gap-4 md:grid-cols-3">
            <Select
              label="Office / Branch"
              disabled={form.method !== 'IN_PERSON'}
              options={[
                { value: '', label: 'Select office' },
                ...(o.offices ?? []).map((x) => ({ value: x.id, label: x.name })),
              ]}
              value={form.officeId}
              onChange={(e) => setForm((f) => ({ ...f, officeId: e.target.value, roomId: '' }))}
            />
            <Select
              label="Room (optional)"
              disabled={form.method !== 'IN_PERSON'}
              options={[
                { value: '', label: 'No room' },
                ...rooms.map((x) => ({ value: x.id, label: x.name })),
              ]}
              value={form.roomId}
              onChange={(e) => set('roomId', e.target.value)}
            />
            <div className="flex min-w-0 flex-col gap-1" data-testid="video-link">
              <span className="flex items-center gap-1 text-sm font-medium text-text">
                Video Meeting Link
                <Info aria-hidden weight="fill" className="size-4 text-action" />
              </span>
              <span className="flex items-center gap-2 text-xs text-text">
                <Toggle
                  label="Generate Zoom Link"
                  checked={form.generateVideoLink}
                  disabled={form.method !== 'VIDEO' || !o.videoProvider}
                  onChange={(on) => set('generateVideoLink', on)}
                />
                {o.videoProvider
                  ? 'Generate Zoom Link'
                  : 'Generate Zoom Link (connect video first)'}
              </span>
              <span className="flex min-w-0 items-stretch gap-1">
                <Input
                  label="Video Meeting Link"
                  hideLabel
                  placeholder={form.generateVideoLink ? 'Made when you schedule' : 'https://'}
                  disabled={form.method !== 'VIDEO' || form.generateVideoLink}
                  value={form.generateVideoLink ? '' : form.videoUrl}
                  error={errors.videoUrl}
                  onChange={(e) => set('videoUrl', e.target.value)}
                />
                <button
                  type="button"
                  aria-label="Copy the video link"
                  title={copied ? 'Copied' : 'Copy'}
                  disabled={!form.videoUrl.trim() || form.generateVideoLink}
                  onClick={() =>
                    void navigator.clipboard
                      ?.writeText(form.videoUrl.trim())
                      .then(() => setCopied(true))
                  }
                  className="flex w-10 shrink-0 items-center justify-center rounded-control border border-border text-action hover:bg-canvas disabled:text-muted"
                >
                  <Copy aria-hidden weight="bold" className="size-4" />
                </button>
              </span>
            </div>
          </div>
          {form.method === 'PHONE' || form.method === 'OTHER' ? (
            <Input
              label={form.method === 'PHONE' ? 'Phone number to call' : 'Where'}
              value={form.details}
              onChange={(e) => set('details', e.target.value)}
            />
          ) : null}
        </Section>

        <Section title="Staff & Status" icon={UsersThree} testId="staff-status">
          <div className="grid gap-4 md:grid-cols-[1.8fr_1.3fr_1.2fr_auto] md:items-end">
            <MultiPick
              chips="people"
              label="Assigned Staff *"
              placeholder="Choose staff"
              options={o.staff.map((s) => ({ value: s.userId, label: s.name }))}
              value={form.staffUserIds}
              error={errors.staff}
              onChange={(v) => {
                set('staffUserIds', v);
                if (v[0]) setPanelStaff(v[0]);
              }}
            />
            <div className="relative">
              <Select
                label="Appointment Status *"
                className="pl-8"
                options={[
                  { value: 'CONFIRMED', label: 'Confirmed' },
                  { value: 'PENDING', label: 'Pending' },
                ]}
                value={form.status}
                onChange={(e) => set('status', e.target.value as Form['status'])}
              />
              <span
                aria-hidden
                className={`pointer-events-none absolute bottom-4 left-3 size-3 rounded-full ${form.status === 'CONFIRMED' ? 'bg-success' : 'bg-gold'}`}
              />
            </div>
            <div className="relative">
              <Select
                label="Color"
                className="pl-8"
                options={colourChoices}
                value={form.color}
                onChange={(e) => set('color', e.target.value)}
              />
              {/* The chosen colour, else the type's, in its tone. */}
              <span
                aria-hidden
                className={`pointer-events-none absolute bottom-4 left-3 size-3 rounded-full ${TONE_DOTS[dotTone ?? 'blue']}`}
              />
            </div>
            <Checkbox
              label="All Day"
              checked={form.allDay}
              onChange={(e) => set('allDay', e.target.checked)}
              className="text-sm"
            />
          </div>
        </Section>

        <Section title="Notes & Instructions" icon={NotePencil}>
          <div className={grid}>
            <Textarea
              label="Internal Notes (not visible to client)"
              placeholder="Add internal notes..."
              rows={3}
              maxLength={2000}
              value={form.internalNotes}
              onChange={(e) => set('internalNotes', e.target.value)}
            />
            <Textarea
              label="Client Instructions (visible to client)"
              placeholder="Add appointment instructions for the client..."
              rows={3}
              maxLength={2000}
              value={form.clientInstructions}
              onChange={(e) => set('clientInstructions', e.target.value)}
            />
          </div>
        </Section>

        <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-[1.1fr_1.3fr_0.75fr]">
          <Section
            small
            title="Related Items"
            note="(Optional)"
            icon={ClipboardText}
            testId="related-items"
          >
            <div className="grid grid-cols-2 gap-x-3 gap-y-1">
              {[
                'Link to Tax Return',
                'Link to Task',
                'Link to Bookkeeping Client',
                'Send Intake Form Before Appointment',
                'Link to Invoice',
                'Require Documents Before Appointment',
              ].map((l) => (
                <Checkbox key={l} label={l} disabled className="min-h-8 text-xs" />
              ))}
            </div>
            <p className="text-xs text-muted">
              Choose these on the appointment once the client is set.
            </p>
          </Section>

          <Section small title="Client Reminders" icon={Bell} testId="client-reminders">
            {(
              [
                ['EMAIL', 'Email Reminder', true],
                ['SMS', 'SMS Reminder', o.smsEnabled],
                ['PORTAL', 'Portal Notification', o.portalEnabled],
              ] as [ReminderChannel, string, boolean][]
            ).map(([ch, label, ok]) => (
              <div key={ch} className="grid grid-cols-[1fr_3.25rem_7rem] items-center gap-x-1.5">
                <Checkbox
                  label={label}
                  disabled={!ok}
                  checked={form.reminders[ch].on}
                  onChange={(e) =>
                    set('reminders', {
                      ...form.reminders,
                      [ch]: { ...form.reminders[ch], on: e.target.checked },
                    })
                  }
                  className="min-h-8 text-xs"
                />
                <Select
                  label={`${label} amount`}
                  className="py-1! pr-7! pl-2! text-sm!"
                  hideLabel
                  disabled={!ok || !form.reminders[ch].on}
                  options={[1, 2, 3, 4, 6, 12, 24, 48].map((n) => ({
                    value: String(n),
                    label: String(n),
                  }))}
                  value={String(form.reminders[ch].amount)}
                  onChange={(e) =>
                    set('reminders', {
                      ...form.reminders,
                      [ch]: { ...form.reminders[ch], amount: Number(e.target.value) },
                    })
                  }
                />
                <Select
                  label={`${label} unit`}
                  className="py-1! pr-7! pl-2! text-sm!"
                  hideLabel
                  disabled={!ok || !form.reminders[ch].on}
                  options={UNITS.map(([value, l]) => ({ value, label: l }))}
                  value={form.reminders[ch].unit}
                  onChange={(e) =>
                    set('reminders', {
                      ...form.reminders,
                      [ch]: { ...form.reminders[ch], unit: e.target.value as ReminderUnit },
                    })
                  }
                />
              </div>
            ))}
            <Checkbox
              label="Send Confirmation Message Immediately"
              checked={form.sendConfirmation}
              onChange={(e) => set('sendConfirmation', e.target.checked)}
              className="min-h-8 text-xs"
            />
          </Section>

          <Section small title="Recurrence" note="(Optional)" icon={Repeat} testId="recurrence">
            <Select
              label="Repeat"
              className="pr-8! pl-2! text-sm!"
              hideLabel
              options={[
                { value: 'NONE', label: 'Does not repeat' },
                { value: 'DAILY', label: 'Every day' },
                { value: 'WEEKLY', label: 'Every week' },
                { value: 'MONTHLY', label: 'Every month' },
              ]}
              value={form.repeat}
              onChange={(e) => set('repeat', e.target.value as Form['repeat'])}
            />
            {form.repeat === 'NONE' ? null : (
              <Select
                label="Occurrences"
                options={[2, 3, 4, 6, 8, 12, 26, 52].map((n) => ({
                  value: String(n),
                  label: `${n} times`,
                }))}
                value={String(form.count)}
                onChange={(e) => set('count', Number(e.target.value))}
              />
            )}
          </Section>
        </div>

        {failure ? (
          <div role="alert" data-testid="schedule-error" className="flex flex-col gap-2">
            <Callout icon={Info} tone="amber" surface="warning" size="compact">
              {conflict
                ? `${SCHEDULE_ERRORS.SCHEDULING_CONFLICT} Choose another time in the Staff Availability panel, or book anyway with a reason.`
                : errorMessage(failure, SCHEDULE_ERRORS)}
            </Callout>
            {conflict ? (
              <Input
                label="Reason to book anyway (Owner or Admin)"
                value={override}
                onChange={(e) => setOverride(e.target.value)}
              />
            ) : null}
          </div>
        ) : null}
        {note ? (
          <p role="status" data-testid="schedule-note" className="text-sm text-success">
            {note}
          </p>
        ) : null}
      </div>

      <aside className="grid min-w-0 grid-cols-1 items-start gap-4 lg:grid-cols-2 min-[1440px]:grid-cols-1">
        <section
          aria-label="Staff Availability"
          className="flex flex-col gap-3 rounded-xl border border-divider bg-surface p-4 shadow-sm"
        >
          <nav aria-label="Availability" className="flex border-b border-divider">
            <span
              aria-current="page"
              className="flex-1 border-b-3 border-action py-2 text-center text-sm font-semibold text-action"
            >
              Staff Availability
            </span>
            <Link
              href="/calendar/availability"
              className="flex-1 py-2 text-center text-sm font-semibold text-heading hover:text-action"
            >
              Edit My Availability
            </Link>
          </nav>
          <StaffDayPanel
            staff={o.staff}
            staffUserId={panelStaff}
            date={form.date}
            startsAt={form.allDay ? undefined : startsAt}
            endsAt={form.allDay ? undefined : endsAt}
            excludeAppointmentId={record?.id}
            onStaff={setPanelStaff}
            onDate={(d) => set('date', d)}
          />
        </section>

        <section
          aria-label="Appointment Summary"
          data-testid="appointment-summary"
          className="flex flex-col gap-3 rounded-xl border border-divider bg-surface p-4 shadow-sm"
        >
          <div className="flex items-center gap-3">
            <span
              aria-hidden
              className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-action text-on-action"
            >
              <CalendarBlank weight="fill" className="size-5" />
            </span>
            <h2 className="flex-1 text-lg font-bold text-heading">Appointment Summary</h2>
            <a href="#client-information" className="text-sm font-semibold text-link underline">
              Edit
            </a>
          </div>
          <dl className="grid grid-cols-[6rem_1fr] gap-x-3 gap-y-2 text-sm">
            {(
              [
                ['Client', contactName],
                ['Type', typeName],
                [
                  'Date & Time',
                  <span key="when">
                    {dateLabel}
                    <br />
                    {form.allDay
                      ? 'All day'
                      : `${timeLabel(form.start)} – ${timeLabel(form.end)}${zoneShort ? ` (${zoneShort})` : ''}`}
                  </span>,
                ],
                ['Duration', duration],
                [
                  'Location',
                  form.method === 'IN_PERSON' ? (
                    <span key="where">
                      {['In Person', office].filter(Boolean).join(' – ')}
                      {room ? <br /> : null}
                      {room}
                    </span>
                  ) : (
                    METHOD_LABELS[form.method]
                  ),
                ],
                ['Staff', staffNames.join(', ') || '—'],
                [
                  'Status',
                  <span key="s" className="inline-flex items-center gap-1.5">
                    <span
                      aria-hidden
                      className={`size-2.5 rounded-full ${form.status === 'CONFIRMED' ? 'bg-success' : 'bg-gold'}`}
                    />
                    {STATUS_LOOKS[form.status].label}
                  </span>,
                ],
                [
                  'Video Link',
                  form.method === 'VIDEO'
                    ? form.generateVideoLink
                      ? 'Will be generated'
                      : form.videoUrl || '—'
                    : '—',
                ],
                ['Reminders', remindersLabel],
              ] as [string, ReactNode][]
            ).map(([k, v]) => (
              <div key={k} className="contents">
                <dt className="text-heading">{k}</dt>
                <dd className="min-w-0 break-words text-heading">{v}</dd>
              </div>
            ))}
          </dl>
        </section>

        <Callout icon={Lightbulb} tone="blue" surface="info" titleStyle="tip" title="Pro Tip:">
          Keep your availability up to date so clients can easily find a time that works.{' '}
          <Link
            href="/calendar/availability"
            className="inline-flex items-center gap-1 font-semibold text-link hover:underline"
          >
            Edit My Availability
            <ArrowRight aria-hidden weight="bold" className="size-3" />
          </Link>
        </Callout>
      </aside>

      <div className="flex flex-wrap items-center justify-end gap-3 min-[1440px]:col-span-2">
        <Link
          href={record ? `/calendar/${record.id}` : '/calendar'}
          className="inline-flex min-h-11 items-center rounded-control border border-action px-6 text-sm font-semibold text-action hover:bg-folder-surface"
        >
          Cancel
        </Link>
        {record ? null : (
          <Button variant="secondary" disabled={busy} onClick={saveDraft}>
            Save as Draft
          </Button>
        )}
        <Button
          type="submit"
          disabled={busy || (conflict && !override.trim())}
          className="min-w-64 px-8"
        >
          {record ? 'Save Changes' : conflict ? 'Book Anyway' : 'Schedule Appointment'}
        </Button>
      </div>
    </form>
  );
}
