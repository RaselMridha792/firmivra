'use client';

import type { RelatedItems, ReminderChannel, SchedulingOptions } from '@firmivra/types';
import { Avatar, Checkbox, Textarea, Toggle } from '@firmivra/ui';
import {
  ArrowsClockwise,
  Bell,
  CalendarPlus,
  Copy,
  Info,
  NotePencil,
  Rows,
  UserCircle,
  Users,
  X,
} from '@phosphor-icons/react';
import Link from 'next/link';
import { useState } from 'react';
import { METHOD_LABELS, STATUS_LABELS } from './ap-shared';
import {
  COLORS,
  type FormState,
  REMINDER_UNITS,
  TIMES,
  durationText,
  minutesOf,
  hhmmOf,
  problems,
  timeText,
  zoneOptions,
} from './form-model';
import { CONTROL, ContactPicker, Field, Segmented, SectionCard } from './form-parts';

type Errors = ReturnType<typeof problems>;

interface Props {
  form: FormState;
  patch: (change: Partial<FormState>) => void;
  options: SchedulingOptions | undefined;
  firmZone: string;
  /** Shown after a failed save: which fields to flag. */
  errors: Errors;
  /** Edit Existing: the records the appointment is already linked to. */
  related?: RelatedItems | undefined;
}

const METHODS = (['IN_PERSON', 'PHONE', 'VIDEO', 'OTHER'] as const).map((value) => ({
  value,
  label: METHOD_LABELS[value],
}));

const Select = ({
  value,
  onChange,
  options,
  id,
  disabled,
  label,
  compact,
}: {
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
  id?: string;
  disabled?: boolean;
  label: string;
  /** The small selects of the reminder rows. */
  compact?: boolean;
}) => (
  <div className="relative">
    <select
      id={id}
      aria-label={label}
      value={value}
      disabled={disabled}
      onChange={(event) => onChange(event.target.value)}
      className={`${CONTROL} appearance-none ${compact ? 'min-h-9 pr-7 pl-2 text-xs' : 'pr-9'}`}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-muted"
    >
      <path d="m6 9 6 6 6-6" />
    </svg>
  </div>
);

/** The Schedule Appointment form: every section of the design, Create New and Edit Existing alike. */
export function AppointmentForm({ form, patch, options, firmZone, errors, related }: Props) {
  const types = options?.types ?? [];
  const services = options?.services ?? [];
  const staff = options?.staff ?? [];
  const offices = options?.offices ?? [];
  const rooms = (options?.rooms ?? []).filter(
    (r) => !form.officeId || r.officeId === form.officeId,
  );
  const duration = minutesOf(form.end) - minutesOf(form.start);
  const [copied, setCopied] = useState(false);
  const canAddNew = form.newContact && !form.picked;
  const contact = form.picked;
  const timeOptions = (extra: string) =>
    (TIMES.includes(extra) || !extra ? TIMES : [...TIMES, extra].sort()).map((t) => ({
      value: t,
      label: timeText(t),
    }));
  const videoLink = form.generateVideo ? '' : form.videoUrl;

  return (
    <div className="flex flex-col gap-4">
      <SectionCard
        icon={UserCircle}
        title="Client Information"
        aside={
          contact?.id ? (
            <Link
              href={contact.kind === 'LEAD' ? `/leads/${contact.id}` : `/clients/${contact.id}`}
              className="text-sm text-link underline"
            >
              View Client Profile
            </Link>
          ) : (
            <span className="text-sm text-muted">View Client Profile</span>
          )
        }
      >
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Client / Lead" required error={errors.contact}>
            <ContactPicker
              picked={contact}
              newName={form.contactName}
              error={errors.contact}
              onPick={(picked) =>
                patch({
                  picked,
                  ...(picked ? { newContact: false, contactName: '' } : {}),
                })
              }
              onNew={(name) => patch(name ? { newContact: true, contactName: name } : {})}
            />
          </Field>
          <Field label="Client Type">
            <div>
              <Segmented
                label="Client type"
                value={contact?.clientType ?? form.clientType}
                disabled={!!contact}
                onChange={(clientType) => patch({ clientType })}
                options={[
                  { value: 'INDIVIDUAL', label: 'Individual' },
                  { value: 'BUSINESS', label: 'Business' },
                ]}
              />
            </div>
          </Field>
          <Field label="Phone" htmlFor="ap-phone">
            <input
              id="ap-phone"
              type="tel"
              inputMode="tel"
              className={CONTROL}
              placeholder="(000) 000-0000"
              value={contact ? (contact.phone ?? '') : form.phone}
              readOnly={!!contact}
              onChange={(event) => patch({ phone: event.target.value })}
            />
          </Field>
          <Field label="Email" htmlFor="ap-email" error={errors.email}>
            <input
              id="ap-email"
              type="email"
              className={CONTROL}
              placeholder="client@email.com"
              value={contact ? (contact.email ?? '') : form.email}
              readOnly={!!contact}
              aria-invalid={errors.email ? true : undefined}
              onChange={(event) => patch({ email: event.target.value })}
            />
          </Field>
          {canAddNew ? (
            <Field label="Business Name (optional)" htmlFor="ap-business">
              <input
                id="ap-business"
                className={CONTROL}
                value={form.businessName}
                onChange={(event) => patch({ businessName: event.target.value })}
              />
            </Field>
          ) : null}
        </div>
      </SectionCard>

      <SectionCard icon={CalendarPlus} title="Appointment Details">
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Appointment Type" required error={errors.type} htmlFor="ap-type">
            <Select
              id="ap-type"
              label="Appointment type"
              value={form.typeId}
              onChange={(typeId) => {
                const type = types.find((t) => t.id === typeId);
                patch({
                  typeId,
                  ...(type
                    ? {
                        serviceId: type.serviceId ?? form.serviceId,
                        end: hhmmOf(Math.min(minutesOf(form.start) + type.durationMinutes, 1425)),
                      }
                    : {}),
                });
              }}
              options={[
                { value: '', label: 'Select appointment type…' },
                ...types.map((t) => ({ value: t.id, label: t.name })),
              ]}
            />
          </Field>
          <Field label="Related Service" htmlFor="ap-service">
            <Select
              id="ap-service"
              label="Related service"
              value={form.serviceId}
              onChange={(serviceId) => patch({ serviceId })}
              options={[
                { value: '', label: 'Select service (optional)' },
                ...services.map((s) => ({ value: s.id, label: s.name })),
              ]}
            />
          </Field>
        </div>
        <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Date" required htmlFor="ap-date" error={errors.time}>
            <input
              id="ap-date"
              type="date"
              min="2000-01-01"
              max="2100-12-31"
              className={CONTROL}
              value={form.date}
              onChange={(event) => patch({ date: event.target.value })}
            />
          </Field>
          <Field label="Start Time" required htmlFor="ap-start">
            <Select
              id="ap-start"
              label="Start time"
              value={form.start}
              disabled={form.allDay}
              onChange={(start) => {
                const shift = minutesOf(start) - minutesOf(form.start);
                patch({
                  start,
                  end: hhmmOf(Math.min(Math.max(minutesOf(form.end) + shift, 0), 1425)),
                });
              }}
              options={timeOptions(form.start)}
            />
          </Field>
          <Field label="End Time" required htmlFor="ap-end">
            <Select
              id="ap-end"
              label="End time"
              value={form.end}
              disabled={form.allDay}
              onChange={(end) => patch({ end })}
              options={timeOptions(form.end)}
            />
          </Field>
          <Field label="Duration" htmlFor="ap-duration">
            <input
              id="ap-duration"
              readOnly
              className={CONTROL}
              value={form.allDay ? 'All day' : durationText(duration)}
              placeholder="1 hour"
            />
          </Field>
        </div>
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <Field label="Time Zone" htmlFor="ap-zone">
            <Select
              id="ap-zone"
              label="Time zone"
              value={form.timezone}
              onChange={(timezone) => patch({ timezone })}
              options={zoneOptions(firmZone)}
            />
          </Field>
          <Field label="Location Type" required>
            <div>
              <Segmented
                label="Location type"
                value={form.method}
                onChange={(method) => patch({ method })}
                options={METHODS}
              />
            </div>
          </Field>
        </div>
        <div className="mt-4 grid gap-4 md:grid-cols-[1fr_1fr_1.4fr]">
          <Field label="Office / Branch" htmlFor="ap-office">
            <Select
              id="ap-office"
              label="Office or branch"
              value={form.officeId}
              disabled={offices.length === 0}
              onChange={(officeId) => patch({ officeId, roomId: '' })}
              options={[
                { value: '', label: offices.length ? 'Select office' : 'No offices set up' },
                ...offices.map((o) => ({ value: o.id, label: o.name })),
              ]}
            />
          </Field>
          <Field label="Room (optional)" htmlFor="ap-room">
            <Select
              id="ap-room"
              label="Room"
              value={form.roomId}
              disabled={rooms.length === 0}
              onChange={(roomId) => patch({ roomId })}
              options={[
                { value: '', label: rooms.length ? 'Select room' : 'No rooms set up' },
                ...rooms.map((r) => ({ value: r.id, label: r.name })),
              ]}
            />
          </Field>
          <Field
            label="Video Meeting Link"
            error={errors.video}
            hint={
              <Info
                aria-label="Zoom links are made when the appointment is saved"
                weight="fill"
                className="ml-1 inline size-3.5 text-info"
              />
            }
            htmlFor="ap-video"
          >
            <div className="flex flex-col gap-2">
              <label className="flex items-center gap-2 text-xs text-text">
                <Toggle
                  label="Generate Zoom Link"
                  checked={form.generateVideo}
                  disabled={form.method !== 'VIDEO'}
                  onChange={(generateVideo) => patch({ generateVideo })}
                />
                Generate Zoom Link
              </label>
              <div className="flex gap-2">
                <input
                  id="ap-video"
                  type="url"
                  inputMode="url"
                  className={CONTROL}
                  disabled={form.method !== 'VIDEO'}
                  readOnly={form.generateVideo}
                  placeholder={form.generateVideo ? 'Made when you save' : 'https://…'}
                  value={videoLink}
                  onChange={(event) => patch({ videoUrl: event.target.value })}
                />
                <button
                  type="button"
                  aria-label="Copy link"
                  disabled={!videoLink}
                  onClick={() => {
                    void navigator.clipboard?.writeText(videoLink);
                    setCopied(true);
                    setTimeout(() => setCopied(false), 1500);
                  }}
                  className="inline-flex size-10 shrink-0 items-center justify-center rounded-control border border-border bg-surface text-action hover:bg-canvas disabled:text-muted"
                >
                  <Copy aria-hidden weight="fill" className="size-4" />
                </button>
              </div>
              {copied ? (
                <p role="status" className="text-xs text-success">
                  Link copied.
                </p>
              ) : null}
            </div>
          </Field>
        </div>
        {form.method !== 'VIDEO' ? (
          <div className="mt-4">
            <Field
              label={form.method === 'OTHER' ? 'Location details' : 'Location details (optional)'}
              htmlFor="ap-details"
            >
              <input
                id="ap-details"
                className={CONTROL}
                maxLength={500}
                value={form.details}
                placeholder={
                  form.method === 'PHONE' ? 'Phone number to call' : 'Address or description'
                }
                onChange={(event) => patch({ details: event.target.value })}
              />
            </Field>
          </div>
        ) : null}
      </SectionCard>

      <SectionCard icon={Users} title="Staff & Status">
        <div className="grid gap-4 md:grid-cols-[1.6fr_1.2fr_0.8fr_auto] md:items-end">
          <Field label="Assigned Staff" required error={errors.staff} htmlFor="ap-staff">
            <div
              className={`flex min-h-10 flex-wrap items-center gap-2 rounded-control border bg-surface px-2 py-1 ${errors.staff ? 'border-danger' : 'border-border'}`}
            >
              {form.staffIds.map((id) => {
                const person = staff.find((s) => s.userId === id);
                return (
                  <span
                    key={id}
                    className="inline-flex items-center gap-2 rounded-pill bg-canvas py-0.5 pr-2 pl-0.5 text-sm text-heading"
                  >
                    <Avatar name={person?.name ?? 'Staff'} size="sm" />
                    {person?.name ?? 'Staff member'}
                    <button
                      type="button"
                      aria-label={`Remove ${person?.name ?? 'staff member'}`}
                      onClick={() =>
                        patch({ staffIds: form.staffIds.filter((staffId) => staffId !== id) })
                      }
                      className="text-muted hover:text-danger"
                    >
                      <X aria-hidden weight="bold" className="size-3" />
                    </button>
                  </span>
                );
              })}
              <select
                id="ap-staff"
                aria-label="Add staff member"
                value=""
                onChange={(event) =>
                  event.target.value &&
                  patch({ staffIds: [...form.staffIds, event.target.value].slice(0, 5) })
                }
                className="min-h-8 min-w-24 flex-1 bg-transparent text-sm text-muted outline-none"
              >
                <option value="">{form.staffIds.length ? 'Add…' : 'Select staff…'}</option>
                {staff
                  .filter((s) => !form.staffIds.includes(s.userId))
                  .map((s) => (
                    <option key={s.userId} value={s.userId}>
                      {s.name}
                    </option>
                  ))}
              </select>
            </div>
          </Field>
          <Field label="Appointment Status" required htmlFor="ap-status">
            <div className="relative">
              <span
                aria-hidden
                className={`pointer-events-none absolute top-1/2 left-3 size-3 -translate-y-1/2 rounded-full ${form.status === 'CONFIRMED' ? 'bg-success' : 'bg-warning'}`}
              />
              <select
                id="ap-status"
                value={form.status}
                onChange={(event) => patch({ status: event.target.value as FormState['status'] })}
                className={`${CONTROL} appearance-none pr-9 pl-8`}
              >
                <option value="CONFIRMED">{STATUS_LABELS.CONFIRMED}</option>
                <option value="PENDING">{STATUS_LABELS.PENDING}</option>
              </select>
            </div>
          </Field>
          <Field label="Color" htmlFor="ap-color">
            <div className="relative">
              <span
                aria-hidden
                style={{ backgroundColor: form.color || undefined }}
                className={`pointer-events-none absolute top-1/2 left-3 size-3 -translate-y-1/2 rounded-full ${form.color ? '' : 'border border-border'}`}
              />
              <select
                id="ap-color"
                value={form.color}
                onChange={(event) => patch({ color: event.target.value })}
                className={`${CONTROL} appearance-none pr-9 pl-8`}
              >
                {COLORS.map((c) => (
                  <option key={c.value} value={c.value}>
                    {c.label}
                  </option>
                ))}
              </select>
            </div>
          </Field>
          <Checkbox
            label="All Day"
            checked={form.allDay}
            onChange={(event) => patch({ allDay: event.target.checked })}
          />
        </div>
      </SectionCard>

      <SectionCard icon={NotePencil} title="Notes & Instructions">
        <div className="grid gap-4 md:grid-cols-2">
          <Textarea
            label="Internal Notes (not visible to client)"
            rows={3}
            maxLength={2000}
            placeholder="Add internal notes…"
            value={form.internalNotes}
            onChange={(event) => patch({ internalNotes: event.target.value })}
          />
          <Textarea
            label="Client Instructions (visible to client)"
            rows={3}
            maxLength={2000}
            placeholder="Add appointment instructions for the client…"
            value={form.clientInstructions}
            onChange={(event) => patch({ clientInstructions: event.target.value })}
          />
        </div>
      </SectionCard>

      <div className="grid gap-4 lg:grid-cols-[1fr_1.25fr_0.9fr]">
        <SectionCard icon={Rows} title="Related Items" note="(Optional)">
          <div className="grid grid-cols-1 gap-x-3 sm:grid-cols-2">
            {(
              [
                ['Link to Tax Return', related?.taxReturn],
                ['Link to Task', related?.task],
                ['Link to Bookkeeping Client', related?.bookkeepingEngagement],
                ['Send Intake Form Before Appointment', related?.intakeForm],
                ['Link to Invoice', related?.invoice],
                ['Require Documents Before Appointment', related?.documentRequest],
              ] as const
            ).map(([label, linked]) => (
              <Checkbox
                key={label}
                label={linked ? `${label}: ${linked.name}` : label}
                disabled
                checked={!!linked}
                readOnly
                title="Linked records are chosen from the client's own record."
                className="min-h-9 text-xs"
              />
            ))}
          </div>
        </SectionCard>
        <SectionCard icon={Bell} title="Client Reminders">
          <div className="flex flex-col gap-2">
            {(['EMAIL', 'SMS', 'PORTAL'] as ReminderChannel[]).map((channel) => {
              const row = form.reminders[channel];
              const unavailable =
                (channel === 'SMS' && options?.smsEnabled === false) ||
                (channel === 'PORTAL' && options?.portalEnabled === false);
              const name = {
                EMAIL: 'Email Reminder',
                SMS: 'SMS Reminder',
                PORTAL: 'Portal Notification',
              }[channel];
              const set = (change: Partial<typeof row>) =>
                patch({ reminders: { ...form.reminders, [channel]: { ...row, ...change } } });
              return (
                <div key={channel} className="flex items-center gap-2">
                  <label
                    className="flex min-w-0 flex-1 items-center gap-2 text-xs text-text"
                    title={
                      unavailable
                        ? channel === 'SMS'
                          ? 'SMS is not set up for this firm.'
                          : 'The client portal is off.'
                        : undefined
                    }
                  >
                    <input
                      type="checkbox"
                      className="size-5"
                      checked={row.on && !unavailable}
                      disabled={unavailable}
                      onChange={(event) => set({ on: event.target.checked })}
                    />
                    {name}
                  </label>
                  <div className="w-12 shrink-0">
                    <Select
                      compact
                      label={`${name}: how many`}
                      value={String(row.amount)}
                      disabled={!row.on}
                      onChange={(amount) => set({ amount: Number(amount) })}
                      options={Array.from({ length: 14 }, (_, i) => ({
                        value: String(i + 1),
                        label: String(i + 1),
                      }))}
                    />
                  </div>
                  <div className="w-24 shrink-0">
                    <Select
                      compact
                      label={`${name}: how long before`}
                      value={row.unit}
                      disabled={!row.on}
                      onChange={(unit) => set({ unit: unit as typeof row.unit })}
                      options={REMINDER_UNITS}
                    />
                  </div>
                </div>
              );
            })}
            <Checkbox
              label="Send Confirmation Message Immediately"
              checked={form.sendConfirmation}
              onChange={(event) => patch({ sendConfirmation: event.target.checked })}
              className="min-h-9 text-xs"
            />
          </div>
        </SectionCard>
        <SectionCard icon={ArrowsClockwise} title="Recurrence" note="(Optional)">
          <div className="flex flex-col gap-3">
            <Select
              label="Recurrence"
              value={form.recurrence}
              onChange={(recurrence) =>
                patch({ recurrence: recurrence as FormState['recurrence'] })
              }
              options={[
                { value: 'NONE', label: 'Does not repeat' },
                { value: 'DAILY', label: 'Daily' },
                { value: 'WEEKLY', label: 'Weekly' },
                { value: 'MONTHLY', label: 'Monthly' },
                { value: 'CUSTOM', label: 'Custom' },
              ]}
            />
            {form.recurrence !== 'NONE' ? (
              <div className="grid grid-cols-2 gap-2">
                <Field label="Every" htmlFor="ap-interval">
                  <input
                    id="ap-interval"
                    type="number"
                    min={1}
                    max={12}
                    className={CONTROL}
                    value={form.recurrenceInterval}
                    onChange={(event) =>
                      patch({
                        recurrenceInterval: Math.min(
                          12,
                          Math.max(1, Number(event.target.value) || 1),
                        ),
                      })
                    }
                  />
                </Field>
                <Field label="Times" htmlFor="ap-count">
                  <input
                    id="ap-count"
                    type="number"
                    min={1}
                    max={52}
                    className={CONTROL}
                    value={form.recurrenceCount}
                    onChange={(event) =>
                      patch({
                        recurrenceCount: Math.min(52, Math.max(1, Number(event.target.value) || 1)),
                      })
                    }
                  />
                </Field>
              </div>
            ) : null}
          </div>
        </SectionCard>
      </div>
    </div>
  );
}
