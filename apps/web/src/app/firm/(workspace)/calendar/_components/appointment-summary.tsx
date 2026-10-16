'use client';

import type { ReminderChannel, SchedulingOptions } from '@firmivra/types';
import { Callout } from '@firmivra/ui';
import { CalendarCheck, Lightbulb } from '@phosphor-icons/react';
import Link from 'next/link';
import { METHOD_LABELS, STATUS_LABELS } from './ap-shared';
import { type FormState, durationText, minutesOf, rangeOf, remindersOf } from './form-model';

const CHANNEL: Record<ReminderChannel, string> = { EMAIL: 'Email', SMS: 'SMS', PORTAL: 'Portal' };

function whenText(form: FormState): string {
  const range = rangeOf(form);
  if (!range) return '–';
  const day = new Date(range.startsAt).toLocaleDateString('en-US', {
    timeZone: form.timezone,
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
  if (form.allDay) return `${day}, all day`;
  const t = (iso: string) =>
    new Date(iso).toLocaleTimeString('en-US', {
      timeZone: form.timezone,
      hour: 'numeric',
      minute: '2-digit',
    });
  const zone =
    new Intl.DateTimeFormat('en-US', { timeZone: form.timezone, timeZoneName: 'short' })
      .formatToParts(new Date(range.startsAt))
      .find((p) => p.type === 'timeZoneName')?.value ?? '';
  return `${day}\n${t(range.startsAt)} – ${t(range.endsAt)} (${zone})`;
}

/** The current form in words, so the person reviews it before saving. */
export function AppointmentSummary({
  form,
  options,
}: {
  form: FormState;
  options: SchedulingOptions | undefined;
}) {
  const type = options?.types.find((t) => t.id === form.typeId);
  const service = options?.services.find((s) => s.id === form.serviceId);
  const office = options?.offices?.find((o) => o.id === form.officeId);
  const room = options?.rooms?.find((r) => r.id === form.roomId);
  const staff = form.staffIds.map((id) => options?.staff.find((s) => s.userId === id)?.name ?? '');
  const reminders = remindersOf(form);
  const place = [METHOD_LABELS[form.method], office?.name].filter(Boolean).join(' – ');
  const rows: [string, string][] = [
    ['Client', form.picked?.name ?? (form.newContact ? form.contactName : '') ?? ''],
    ['Type', [type?.name, service?.name].filter(Boolean).join(' · ')],
    ['Date & Time', whenText(form)],
    [
      'Duration',
      form.allDay ? 'All day' : durationText(minutesOf(form.end) - minutesOf(form.start)),
    ],
    ['Location', [place, room?.name].filter(Boolean).join('\n')],
    ['Staff', staff.filter(Boolean).join(', ')],
    ['Status', STATUS_LABELS[form.status]],
    [
      'Video Link',
      form.method !== 'VIDEO'
        ? ''
        : form.generateVideo
          ? 'Will be generated'
          : form.videoUrl
            ? 'Link added'
            : 'No link yet',
    ],
    [
      'Reminders',
      reminders.length
        ? `${reminders.map((r) => CHANNEL[r.channel]).join(', ')} (${reminders[0]?.amount} ${(reminders[0]?.unit ?? 'DAYS').toLowerCase().replace(/s$/, '')} before)`
        : '',
    ],
  ];
  return (
    <>
      <section
        aria-label="Appointment summary"
        data-testid="appointment-summary"
        className="rounded-xl bg-surface p-4 shadow-md"
      >
        <header className="mb-3 flex items-center justify-between gap-2">
          <div className="flex items-center gap-3">
            <span
              aria-hidden
              className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-action text-on-action"
            >
              <CalendarCheck weight="fill" className="size-5" />
            </span>
            <h2 className="text-lg font-bold text-heading">Appointment Summary</h2>
          </div>
          <button
            type="button"
            onClick={() => document.getElementById('ap-type')?.focus()}
            className="text-sm text-link underline"
          >
            Edit
          </button>
        </header>
        <dl className="grid grid-cols-[6rem_1fr] gap-x-3 gap-y-2 text-sm">
          {rows.map(([label, value]) => (
            <div key={label} className="contents">
              <dt className="text-text">{label}</dt>
              <dd
                className={`whitespace-pre-line ${label === 'Status' ? 'flex items-center gap-2 font-semibold text-success' : 'text-heading'}`}
              >
                {label === 'Status' ? (
                  <span
                    aria-hidden
                    className={`size-2.5 rounded-full ${form.status === 'CONFIRMED' ? 'bg-success' : 'bg-warning'}`}
                  />
                ) : null}
                {value || '–'}
              </dd>
            </div>
          ))}
        </dl>
      </section>
      <Callout
        icon={Lightbulb}
        title="Pro Tip:"
        titleStyle="tip"
        surface="info"
        action={
          <Link href="/calendar/availability" className="text-sm font-medium text-link underline">
            Edit My Availability →
          </Link>
        }
      >
        Keep your availability up to date so clients can easily find a time that works.
      </Callout>
    </>
  );
}
