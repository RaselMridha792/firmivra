'use client';

import type { AppointmentRecord } from '@firmivra/types';
import { Avatar, Badge, Button, Textarea, Timeline, type TimelineItem, Toast } from '@firmivra/ui';
import {
  ArrowLeft,
  CalendarCheck,
  CalendarX,
  CheckCircle,
  ChatCircleDots,
  Copy,
  Envelope,
  NotePencil,
  PencilSimple,
  PlusCircle,
  Prohibit,
  UserMinus,
  VideoCamera,
  XCircle,
} from '@phosphor-icons/react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, type ReactNode } from 'react';
import { api } from '../../../../../lib/api';
import { errorMessage } from '../../../../../lib/errors';
import { useApiMutation, useApiQuery } from '../../../../../lib/query';
import { useAppointmentActions } from './ap-actions';
import { useOptions } from './ap-data';
import {
  AP,
  AP_RECORD,
  METHOD_LABELS,
  STATUS_LABELS,
  STATUS_TONES,
  clock,
  dateLabel,
} from './ap-shared';
import { durationText } from './form-model';

const CLOSED = new Set(['COMPLETED', 'CANCELED', 'NO_SHOW']);
const NOTICE_KIND = {
  CONFIRMATION: 'Confirmation',
  REMINDER: 'Reminder',
  UPDATE: 'Update',
  RESCHEDULE: 'Reschedule',
  CANCELLATION: 'Cancellation',
} as const;
const ACTION_LABEL = {
  BOOKED: 'Appointment booked',
  RESCHEDULED: 'Appointment rescheduled',
  CANCELLED: 'Appointment canceled',
  COMPLETED: 'Marked completed',
  NO_SHOW: 'Marked as a no-show',
} as const;

function Card({
  title,
  children,
  testId,
  aside,
}: {
  title: string;
  children: ReactNode;
  testId?: string;
  aside?: ReactNode;
}) {
  return (
    <section className="rounded-xl bg-surface p-4 shadow-md" data-testid={testId}>
      <header className="mb-3 flex items-center justify-between gap-2">
        <h2 className="text-lg font-bold text-heading">{title}</h2>
        {aside}
      </header>
      {children}
    </section>
  );
}

const Quiet = ({ children }: { children: ReactNode }) => (
  <p className="rounded-md bg-canvas p-3 text-sm text-muted">{children}</p>
);

function Facts({ rows }: { rows: [string, ReactNode][] }) {
  return (
    <dl className="grid grid-cols-[8rem_1fr] gap-x-3 gap-y-2 text-sm">
      {rows.map(([label, value]) => (
        <div key={label} className="contents">
          <dt className="text-text">{label}</dt>
          <dd className="whitespace-pre-line text-heading">{value || '–'}</dd>
        </div>
      ))}
    </dl>
  );
}

/** /calendar/[id]: the whole record, its actions, notes, reminders, notices and history. */
export function DetailScreen({ id }: { id: string }) {
  const { timeZone } = useOptions();
  const record = useApiQuery([...AP_RECORD, id], () => api.scheduling.record(id));
  const [message, setMessage] = useState<{ text: string; tone: 'success' | 'error' }>();
  const data = record.data;
  return (
    <div className="flex flex-col gap-5" data-testid="appointment-detail">
      <Link
        href="/calendar"
        className="flex w-fit items-center gap-2 text-sm font-medium text-link"
      >
        <ArrowLeft aria-hidden weight="bold" className="size-4" /> Back to Appointments
      </Link>
      {message ? (
        <Toast message={message.text} tone={message.tone} onDismiss={() => setMessage(undefined)} />
      ) : null}
      {data ? (
        <Loaded
          record={data}
          timeZone={data.timezone || timeZone}
          notify={(text, tone = 'success') => setMessage({ text, tone })}
        />
      ) : (
        <>
          <header className="flex flex-col gap-1">
            <h1 className="font-display text-3xl font-bold text-heading">Appointment Details</h1>
            <p
              role={record.isError ? 'alert' : 'status'}
              className="text-base text-muted"
              data-testid="detail-state"
            >
              {record.isPending ? 'Loading…' : errorMessage(record.error)}
            </p>
          </header>
          <Frames />
        </>
      )}
    </div>
  );
}

/** The cards' frames, so the page keeps its shape while the record loads or is missing. */
function Frames() {
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {[
        'Appointment',
        'Client / Lead',
        'Notes',
        'Reminders',
        'Notification history',
        'Activity',
      ].map((title) => (
        <Card key={title} title={title}>
          <Quiet>Nothing to show yet.</Quiet>
        </Card>
      ))}
    </div>
  );
}

function Loaded({
  record,
  timeZone,
  notify,
}: {
  record: AppointmentRecord;
  timeZone: string;
  notify: (text: string, tone?: 'success' | 'error') => void;
}) {
  const router = useRouter();
  const actions = useAppointmentActions(notify);
  const [note, setNote] = useState('');
  const closed = CLOSED.has(record.status);
  const name = record.internal ? (record.type?.name ?? 'Internal meeting') : record.contact.name;
  const addNote = useApiMutation(() => api.scheduling.addNote(record.id, { text: note }), {
    invalidate: AP_RECORD,
  });
  const duplicate = useApiMutation(() => api.scheduling.duplicate(record.id), { invalidate: AP });
  const place = [
    METHOD_LABELS[record.method],
    record.place.office?.name,
    record.place.room?.name,
    record.place.details,
  ]
    .filter(Boolean)
    .join('\n');
  const history: TimelineItem[] = [...record.history].reverse().map((event, i) => ({
    id: `${event.at}-${i}`,
    icon:
      event.action === 'CANCELLED'
        ? XCircle
        : event.action === 'COMPLETED'
          ? CheckCircle
          : event.action === 'NO_SHOW'
            ? UserMinus
            : event.action === 'RESCHEDULED'
              ? CalendarCheck
              : PlusCircle,
    tone:
      event.action === 'CANCELLED' || event.action === 'NO_SHOW'
        ? 'red'
        : event.action === 'COMPLETED'
          ? 'green'
          : 'blue',
    title: event.reason
      ? `${ACTION_LABEL[event.action]}: ${event.reason}`
      : ACTION_LABEL[event.action],
    time: `${dateLabel(event.at, timeZone)}, ${clock(event.at, timeZone)}`,
    dateTime: event.at,
    actor: event.by.name,
  }));
  const act = 'min-h-10';
  return (
    <>
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-center gap-4">
          <Avatar name={name} size="xl" />
          <div>
            <h1 className="font-display text-3xl font-bold text-heading">{name}</h1>
            <p className="mt-1 flex flex-wrap items-center gap-2 text-base text-muted">
              {record.type?.name ?? 'Appointment'} · {dateLabel(record.startsAt, timeZone)},{' '}
              {clock(record.startsAt, timeZone)}
              <Badge tone={STATUS_TONES[record.status]}>{STATUS_LABELS[record.status]}</Badge>
            </p>
          </div>
        </div>
        <div
          className="flex flex-wrap items-center gap-2"
          role="group"
          aria-label="Appointment actions"
        >
          {closed ? null : (
            <>
              <Link
                href={`/calendar/${record.id}/edit`}
                className="inline-flex min-h-10 items-center gap-2 rounded-control bg-action px-4 text-sm font-medium text-on-action hover:bg-action-hover"
              >
                <PencilSimple aria-hidden weight="fill" className="size-4" /> Edit
              </Link>
              <Link
                href={`/calendar/${record.id}/edit`}
                className="inline-flex min-h-10 items-center gap-2 rounded-control border border-border bg-surface px-4 text-sm font-medium text-text hover:bg-canvas"
              >
                <CalendarX aria-hidden weight="fill" className="size-4" /> Reschedule
              </Link>
              {record.status === 'PENDING' ? (
                <Button
                  variant="secondary"
                  className={act}
                  onClick={() => actions.confirm(record.id)}
                >
                  <CheckCircle aria-hidden weight="fill" className="size-4" /> Confirm
                </Button>
              ) : null}
              <Button variant="secondary" className={act} onClick={() => actions.remind(record.id)}>
                <Envelope aria-hidden weight="fill" className="size-4" /> Send Reminder
              </Button>
            </>
          )}
          {record.videoUrl && !closed ? (
            <a
              href={record.videoUrl}
              target="_blank"
              rel="noreferrer noopener"
              className="inline-flex min-h-10 items-center gap-2 rounded-control border border-border bg-surface px-4 text-sm font-medium text-text hover:bg-canvas"
            >
              <VideoCamera aria-hidden weight="fill" className="size-4" /> Join Meeting
            </a>
          ) : null}
        </div>
      </header>

      <div className="flex flex-wrap items-center gap-2" role="group" aria-label="More actions">
        {record.contact.id && !record.internal ? (
          <Link
            href={
              record.contact.kind === 'LEAD'
                ? `/leads/${record.contact.id}`
                : `/clients/${record.contact.id}`
            }
            className="inline-flex min-h-9 items-center rounded-control border border-divider bg-surface px-3 text-sm font-medium text-heading hover:bg-canvas"
          >
            View {record.contact.kind === 'LEAD' ? 'Lead' : 'Client'}
          </Link>
        ) : null}
        <Link
          href="/messages"
          className="inline-flex min-h-9 items-center gap-2 rounded-control border border-divider bg-surface px-3 text-sm font-medium text-heading hover:bg-canvas"
        >
          <ChatCircleDots aria-hidden weight="fill" className="size-4" /> Send Message
        </Link>
        <Link
          href="/modules/tasks"
          className="inline-flex min-h-9 items-center gap-2 rounded-control border border-divider bg-surface px-3 text-sm font-medium text-heading hover:bg-canvas"
        >
          <PlusCircle aria-hidden weight="fill" className="size-4" /> Create Task
        </Link>
        <Button
          variant="secondary"
          className="min-h-9"
          disabled={duplicate.isPending}
          onClick={() =>
            duplicate.mutate(undefined, {
              onSuccess: (draft) => router.push(`/calendar/new?draft=${draft.id}`),
              onError: (error) => notify(errorMessage(error), 'error'),
            })
          }
        >
          <Copy aria-hidden weight="fill" className="size-4" /> Duplicate
        </Button>
        {closed ? null : (
          <>
            <Button
              variant="secondary"
              className="min-h-9"
              onClick={() => actions.complete(record.id)}
            >
              <CheckCircle aria-hidden weight="fill" className="size-4" /> Mark Completed
            </Button>
            <Button
              variant="secondary"
              className="min-h-9"
              onClick={() => actions.noShow(record.id)}
            >
              <UserMinus aria-hidden weight="fill" className="size-4" /> Mark No-Show
            </Button>
            <Button
              variant="secondary"
              className="min-h-9 text-danger"
              onClick={() => actions.cancel(record.id)}
            >
              <Prohibit aria-hidden weight="fill" className="size-4" /> Cancel
            </Button>
          </>
        )}
      </div>

      <div className="grid items-start gap-4 lg:grid-cols-2">
        <Card title="Appointment" testId="detail-appointment">
          <Facts
            rows={[
              ['Type', record.type?.name ?? ''],
              ['Service', record.service?.name ?? ''],
              [
                'Date & Time',
                `${dateLabel(record.startsAt, timeZone)}\n${clock(record.startsAt, timeZone)} – ${clock(record.endsAt, timeZone)} (${timeZone})`,
              ],
              [
                'Duration',
                record.allDay
                  ? 'All day'
                  : durationText(
                      Math.round((Date.parse(record.endsAt) - Date.parse(record.startsAt)) / 60000),
                    ),
              ],
              ['Location', place],
              ['Video link', record.method === 'VIDEO' ? (record.videoUrl ?? 'No link yet') : ''],
              [
                'Staff',
                <span key="s" className="flex flex-wrap gap-2">
                  {record.staff.map((s) => (
                    <span key={s.userId} className="inline-flex items-center gap-2">
                      <Avatar name={s.name} size="sm" /> {s.name}
                    </span>
                  ))}
                </span>,
              ],
              record.recurrence && record.recurrence.frequency !== 'NONE'
                ? ['Repeats', record.recurrence.frequency.toLowerCase()]
                : ['Repeats', 'Does not repeat'],
            ]}
          />
        </Card>
        <Card title="Client / Lead" testId="detail-contact">
          {record.internal ? (
            <Quiet>Internal meeting: no client or lead.</Quiet>
          ) : (
            <Facts
              rows={[
                ['Name', record.contact.name],
                [
                  'Kind',
                  record.contact.kind === 'LEAD'
                    ? 'Lead'
                    : record.contact.kind === 'CLIENT'
                      ? 'Client'
                      : 'Contact',
                ],
                ['Business', record.contact.businessName ?? ''],
                ['Email', record.contact.email ?? ''],
                ['Phone', record.contact.phone ?? ''],
              ]}
            />
          )}
        </Card>
        <Card
          title="Notes"
          testId="detail-notes"
          aside={<NotePencil aria-hidden weight="fill" className="size-5 text-action" />}
        >
          <div className="flex flex-col gap-3">
            <div>
              <p className="text-sm font-medium text-text">Internal notes</p>
              <p className="mt-1 whitespace-pre-line text-sm text-heading">
                {record.internalNotes || <span className="text-muted">No internal notes.</span>}
              </p>
            </div>
            <div>
              <p className="text-sm font-medium text-text">Client instructions</p>
              <p className="mt-1 whitespace-pre-line text-sm text-heading">
                {record.clientInstructions || (
                  <span className="text-muted">No instructions for the client.</span>
                )}
              </p>
            </div>
            <Textarea
              label="Add a note"
              rows={2}
              maxLength={2000}
              value={note}
              onChange={(event) => setNote(event.target.value)}
            />
            <div className="flex items-center gap-3">
              <Button
                variant="secondary"
                disabled={!note.trim() || addNote.isPending}
                onClick={() =>
                  addNote.mutate(undefined, {
                    onSuccess: () => {
                      setNote('');
                      notify('Note added.');
                    },
                    onError: (error) => notify(errorMessage(error), 'error'),
                  })
                }
              >
                Add Note
              </Button>
            </div>
          </div>
        </Card>
        <Card title="Reminders" testId="detail-reminders">
          {record.reminders.length === 0 ? (
            <Quiet>No reminders are scheduled.</Quiet>
          ) : (
            <ul className="flex flex-col gap-1 text-sm text-heading">
              {record.reminders.map((r) => (
                <li key={`${r.channel}-${r.amount}-${r.unit}`}>
                  {{ EMAIL: 'Email', SMS: 'SMS', PORTAL: 'Portal' }[r.channel]}: {r.amount}{' '}
                  {r.unit.toLowerCase().replace(/s$/, r.amount === 1 ? '' : 's')} before
                </li>
              ))}
            </ul>
          )}
          <div className="mt-3 flex flex-col gap-1 text-sm">
            {[
              ['Tax return', record.related.taxReturn?.name],
              ['Bookkeeping', record.related.bookkeepingEngagement?.name],
              ['Invoice', record.related.invoice?.name],
              ['Task', record.related.task?.name],
              [
                'Intake form',
                record.related.intakeForm
                  ? `${record.related.intakeForm.name} (${record.related.intakeForm.completed ? 'completed' : 'not completed'})`
                  : undefined,
              ],
              [
                'Documents',
                record.related.documentRequest
                  ? `${record.related.documentRequest.name} (${record.related.documentRequest.received ? 'received' : 'not received'})`
                  : undefined,
              ],
            ]
              .filter(([, v]) => v)
              .map(([label, value]) => (
                <p key={label}>
                  <span className="text-text">{label}: </span>
                  <span className="text-heading">{value}</span>
                </p>
              ))}
          </div>
        </Card>
        <Card title="Notification history" testId="detail-notices">
          {record.notices.length === 0 ? (
            <Quiet>No notices were sent yet.</Quiet>
          ) : (
            <ul className="flex flex-col divide-y divide-divider text-sm">
              {record.notices.map((n) => (
                <li
                  key={`${n.at}-${n.channel}-${n.kind}`}
                  className="flex flex-wrap items-center justify-between gap-2 py-2"
                >
                  <span className="text-heading">
                    {NOTICE_KIND[n.kind]} ·{' '}
                    {n.channel === 'EMAIL' ? 'Email' : n.channel === 'SMS' ? 'SMS' : 'Portal'} ·{' '}
                    {n.recipient}
                  </span>
                  <span className="flex items-center gap-2 text-muted">
                    {dateLabel(n.at, timeZone)}, {clock(n.at, timeZone)}
                    <Badge
                      tone={
                        n.status === 'FAILED'
                          ? 'danger'
                          : n.status === 'QUEUED'
                            ? 'warning'
                            : 'success'
                      }
                    >
                      {n.status.charAt(0) + n.status.slice(1).toLowerCase()}
                    </Badge>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card title="Activity" testId="detail-history">
          <Timeline items={history} label="Appointment history" emptyText="No activity yet." />
        </Card>
      </div>
    </>
  );
}
