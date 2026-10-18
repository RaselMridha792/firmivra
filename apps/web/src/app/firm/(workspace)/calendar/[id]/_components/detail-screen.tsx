'use client';

import type { AppointmentRecord } from '@firmivra/types';
import { Badge, Button, Callout, Modal, Skeleton, Table, Textarea } from '@firmivra/ui';
import {
  ArrowLeft,
  Bell,
  CalendarCheck,
  ClockCounterClockwise,
  Info,
  LinkSimple,
  NotePencil,
  User,
  VideoCamera,
} from '@phosphor-icons/react';
import Link from 'next/link';
import { type ReactNode, useState } from 'react';
import { api } from '../../../../../../lib/api';
import { errorCode, errorMessage } from '../../../../../../lib/errors';
import { useApiMutation, useApiQuery } from '../../../../../../lib/query';
import {
  METHOD_LABELS,
  NOT_LOADED,
  SCHEDULING,
  STATUS_LOOKS,
  dateAndTime,
} from '../../_components/appointments-parts';

const card =
  'flex min-w-0 flex-col gap-3 rounded-xl border border-divider bg-surface p-4 shadow-sm';
const quiet = 'rounded-lg bg-subtle p-4 text-sm text-muted';

const DETAIL_ERRORS: Record<string, string> = {
  NOT_FOUND:
    'This appointment was not found. It may have been removed, or you may not have access.',
  APPOINTMENT_CLOSED: 'This appointment is no longer scheduled.',
};

const CHANNELS: Record<string, string> = { EMAIL: 'Email', SMS: 'SMS', PORTAL: 'Portal' };

/** "Email, 1 day before". */
const reminderText = (m: { channel: string; amount: number; unit: string }) => {
  const unit = m.unit.toLowerCase().replace(/s$/, '');
  return `${CHANNELS[m.channel] ?? m.channel}, ${m.amount} ${unit}${m.amount === 1 ? '' : 's'} before`;
};

const ACTIONS: Record<string, string> = {
  BOOKED: 'Booked',
  RESCHEDULED: 'Rescheduled',
  CANCELLED: 'Canceled',
  COMPLETED: 'Marked completed',
  NO_SHOW: 'Marked no-show',
};

function Card({
  title,
  icon: Glyph,
  testId,
  children,
}: {
  title: string;
  icon: typeof User;
  testId?: string;
  children: ReactNode;
}) {
  return (
    <section aria-label={title} data-testid={testId} className={card}>
      <h2 className="flex items-center gap-2 text-lg font-bold text-heading">
        <Glyph aria-hidden weight="fill" className="size-5 text-action" />
        {title}
      </h2>
      {children}
    </section>
  );
}

function Rows({ rows }: { rows: [string, ReactNode][] }) {
  return (
    <dl className="grid grid-cols-[minmax(0,9rem)_1fr] gap-x-4 gap-y-2 text-sm">
      {rows.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="text-muted">{k}</dt>
          <dd className="min-w-0 break-words text-heading">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

type Ask = 'cancel' | 'complete' | 'noShow';

/**
 * Appointment detail (`/calendar/[id]`, guide §6, §17; no design: the calendar chip and the
 * upcoming row open it): the record (`api.scheduling.record`) with who, what, when and where,
 * notes and client instructions, related items, reminders and the notices sent, and the history.
 * Actions: Edit, Confirm, Send Reminder, Join Meeting, Add Note, and Mark Completed, No-Show or
 * Cancel (R12's calls), each asking first.
 */
export function DetailScreen({ id }: { id: string }) {
  const record = useApiQuery([...SCHEDULING, 'record', id], () => api.scheduling.record(id));
  const r = record.data;
  const [ask, setAsk] = useState<Ask | null>(null);
  const [message, setMessage] = useState('');
  const confirm = useApiMutation(() => api.scheduling.confirm(id), { invalidate: SCHEDULING });
  const remind = useApiMutation(() => api.scheduling.sendReminder(id), { invalidate: SCHEDULING });
  const open = r && ['PENDING', 'CONFIRMED', 'RESCHEDULED'].includes(r.status);
  const error = confirm.error ?? remind.error;

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <Link
        href="/calendar"
        className="inline-flex min-h-9 w-fit items-center gap-2 text-sm font-semibold text-link hover:underline"
      >
        <ArrowLeft aria-hidden weight="bold" className="size-4" />
        Back to Appointments
      </Link>
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div className="min-w-0">
          <h1 data-testid="page-title" className="text-3xl font-bold text-heading">
            Appointment Details
          </h1>
          <p className="text-base text-link">
            {r
              ? `${r.internal ? 'Team Meeting' : r.contact.name}${r.type ? ` · ${r.type.name}` : ''}`
              : record.isError
                ? errorMessage(record.error, DETAIL_ERRORS)
                : 'Loading the appointment…'}
          </p>
        </div>
        <div className="flex flex-wrap gap-2" data-testid="detail-actions">
          <Link
            href={`/calendar/${id}/edit`}
            aria-disabled={!open}
            className={`inline-flex min-h-11 items-center rounded-control border px-4 text-sm font-semibold ${open ? 'border-action text-action hover:bg-folder-surface' : 'pointer-events-none border-border text-muted'}`}
          >
            Edit
          </Link>
          <Button
            variant="secondary"
            disabled={r?.status !== 'PENDING' || confirm.isPending}
            onClick={() =>
              confirm.mutate(undefined, {
                onSuccess: () => setMessage('The appointment is confirmed.'),
              })
            }
          >
            Confirm
          </Button>
          <Button
            variant="secondary"
            disabled={!open || remind.isPending}
            onClick={() =>
              remind.mutate(undefined, {
                onSuccess: (s) =>
                  setMessage(s.sent ? 'A reminder was sent.' : 'No reminder could be sent.'),
              })
            }
          >
            <Bell aria-hidden weight="fill" className="size-4" />
            Send Reminder
          </Button>
          {r?.videoUrl ? (
            <a
              href={r.videoUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex min-h-11 items-center gap-2 rounded-control bg-action px-4 text-sm font-semibold text-on-action hover:bg-action-hover"
            >
              <VideoCamera aria-hidden weight="fill" className="size-4" />
              Join Meeting
            </a>
          ) : null}
        </div>
      </header>

      {message || error ? (
        <p
          role={error ? 'alert' : 'status'}
          data-testid="detail-result"
          className={`text-sm ${error ? 'text-danger' : 'text-success'}`}
        >
          {error ? errorMessage(error, DETAIL_ERRORS) : message}
        </p>
      ) : null}

      <div className="grid grid-cols-1 items-start gap-4 min-[1440px]:grid-cols-3">
        <div className="flex min-w-0 flex-col gap-4 min-[1440px]:col-span-2">
          <Card title="Appointment" icon={CalendarCheck} testId="detail-summary">
            {!r ? (
              record.isPending ? (
                <Skeleton className="h-40" />
              ) : (
                <p className={quiet}>
                  {record.isError ? errorMessage(record.error, DETAIL_ERRORS) : NOT_LOADED}
                </p>
              )
            ) : (
              <Summary r={r} />
            )}
          </Card>
          <Card title="Notes & Instructions" icon={NotePencil} testId="detail-notes">
            {!r ? (
              <p className={quiet}>{record.isPending ? 'Loading…' : NOT_LOADED}</p>
            ) : (
              <>
                <Rows
                  rows={[
                    ['Internal notes', r.internalNotes ?? 'None'],
                    ['Client instructions', r.clientInstructions ?? 'None'],
                  ]}
                />
                <NoteForm id={id} onDone={setMessage} />
              </>
            )}
          </Card>
          <Card title="History" icon={ClockCounterClockwise} testId="detail-history">
            <Table
              rows={r?.history ?? []}
              loading={record.isPending}
              rowKey={(e) => `${e.at}-${e.action}`}
              caption="Appointment history"
              dense
              showPagination={false}
              columns={[
                {
                  id: 'at',
                  label: 'When',
                  cell: (e) => dateAndTime(e.at, r?.timezone ?? 'America/New_York').join(' '),
                },
                { id: 'what', label: 'What', cell: (e) => ACTIONS[e.action] ?? e.action },
                { id: 'by', label: 'By', cell: (e) => e.by.name },
                { id: 'why', label: 'Reason', cell: (e) => e.reason ?? '—' },
              ]}
              emptyTitle={record.isError ? 'History is not available' : 'No changes yet'}
              emptyText={record.isError ? NOT_LOADED : 'Changes to this appointment show here.'}
            />
          </Card>
        </div>

        <aside className="grid min-w-0 grid-cols-1 items-start gap-4 lg:grid-cols-2 min-[1440px]:grid-cols-1">
          <Card title="Related Items" icon={LinkSimple} testId="detail-related">
            {!r ? (
              <p className={quiet}>{record.isPending ? 'Loading…' : NOT_LOADED}</p>
            ) : (
              <Rows
                rows={[
                  ['Tax return', r.related.taxReturn?.name ?? '—'],
                  ['Bookkeeping', r.related.bookkeepingEngagement?.name ?? '—'],
                  ['Invoice', r.related.invoice?.name ?? '—'],
                  ['Task', r.related.task?.name ?? '—'],
                  [
                    'Intake form',
                    r.related.intakeForm
                      ? `${r.related.intakeForm.name} (${r.related.intakeForm.completed ? 'completed' : 'waiting'})`
                      : '—',
                  ],
                  [
                    'Documents',
                    r.related.documentRequest
                      ? `${r.related.documentRequest.name} (${r.related.documentRequest.received ? 'received' : 'waiting'})`
                      : '—',
                  ],
                ]}
              />
            )}
          </Card>
          <Card title="Reminders & Notices" icon={Bell} testId="detail-reminders">
            {!r ? (
              <p className={quiet}>{record.isPending ? 'Loading…' : NOT_LOADED}</p>
            ) : (
              <>
                <p className="text-sm text-heading">
                  {r.reminders.length
                    ? r.reminders.map(reminderText).join('; ')
                    : 'No reminders set.'}
                </p>
                {r.notices.length ? (
                  <ul className="flex flex-col divide-y divide-divider text-sm">
                    {r.notices.map((n) => (
                      <li
                        key={`${n.at}-${n.kind}-${n.channel}`}
                        className="flex flex-wrap justify-between gap-2 py-1.5"
                      >
                        <span className="text-heading">
                          {n.kind.charAt(0)}
                          {n.kind.slice(1).toLowerCase()} · {n.channel.toLowerCase()} ·{' '}
                          {n.recipient}
                        </span>
                        <span className="text-muted">{n.status.toLowerCase()}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-xs text-muted">No notices sent yet.</p>
                )}
              </>
            )}
          </Card>
          <Card title="Close This Appointment" icon={Info} testId="detail-close">
            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" disabled={!open} onClick={() => setAsk('complete')}>
                Mark Completed
              </Button>
              <Button variant="secondary" disabled={!open} onClick={() => setAsk('noShow')}>
                Mark No-Show
              </Button>
              <button
                type="button"
                disabled={!open}
                onClick={() => setAsk('cancel')}
                className="inline-flex min-h-11 items-center rounded-control border border-danger bg-surface px-4 text-sm font-semibold text-danger hover:bg-danger-soft disabled:cursor-not-allowed disabled:border-border disabled:text-muted disabled:hover:bg-surface"
              >
                Cancel Appointment
              </button>
            </div>
            <p className="text-xs text-muted">
              The client is told when an appointment is canceled.
            </p>
          </Card>
        </aside>
      </div>

      {ask && r ? (
        <CloseModal
          id={id}
          ask={ask}
          name={r.internal ? 'Team Meeting' : r.contact.name}
          onClose={() => setAsk(null)}
          onDone={(text) => {
            setAsk(null);
            setMessage(text);
          }}
        />
      ) : null}
    </div>
  );
}

function Summary({ r }: { r: AppointmentRecord }) {
  const [d, t1] = dateAndTime(r.startsAt, r.timezone);
  const [, t2] = dateAndTime(r.endsAt, r.timezone);
  const where =
    r.method === 'IN_PERSON'
      ? [r.place.office?.name, r.place.room?.name, r.place.details].filter(Boolean).join(', ') ||
        'In-Person'
      : `${METHOD_LABELS[r.method]}${r.place.details ? `, ${r.place.details}` : ''}`;
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={STATUS_LOOKS[r.status].tone}>{STATUS_LOOKS[r.status].label}</Badge>
        {r.seriesId ? <Badge tone="info">Repeats</Badge> : null}
      </div>
      <Rows
        rows={[
          [
            r.contact.kind === 'LEAD' ? 'Lead' : 'Client',
            r.internal ? 'Internal meeting' : r.contact.name,
          ],
          ['Email', r.contact.email ?? '—'],
          ['Phone', r.contact.phone ?? '—'],
          ['Type', r.type?.name ?? '—'],
          ['Service', r.service?.name ?? '—'],
          ['Date & time', r.allDay ? `${d}, all day` : `${d}, ${t1} – ${t2}`],
          ['Time zone', r.timezone],
          ['Staff', r.staff.map((s) => s.name).join(', ')],
          ['Location', where],
          ['Video link', r.videoUrl ? 'Join Meeting (above)' : '—'],
        ]}
      />
    </div>
  );
}

function NoteForm({ id, onDone }: { id: string; onDone: (text: string) => void }) {
  const [text, setText] = useState('');
  const add = useApiMutation((t: string) => api.scheduling.addNote(id, { text: t }), {
    invalidate: SCHEDULING,
  });
  return (
    <form
      noValidate
      className="flex flex-col gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        if (!text.trim()) return;
        add.mutate(text.trim(), {
          onSuccess: () => {
            setText('');
            onDone('Note added.');
          },
        });
      }}
    >
      <Textarea
        label="Add a note (internal)"
        rows={2}
        maxLength={2000}
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
      {add.error ? (
        <p role="alert" className="text-sm text-danger">
          {errorMessage(add.error, DETAIL_ERRORS)}
        </p>
      ) : null}
      <Button
        type="submit"
        variant="secondary"
        className="self-end"
        disabled={!text.trim() || add.isPending}
      >
        Add Note
      </Button>
    </form>
  );
}

const ASKS: Record<
  Ask,
  { title: string; line: (name: string) => string; button: string; done: string }
> = {
  complete: {
    title: 'Mark Completed',
    line: (n) => `Record that the appointment with ${n} took place.`,
    button: 'Mark Completed',
    done: 'The appointment is marked completed.',
  },
  noShow: {
    title: 'Mark No-Show',
    line: (n) => `Record that ${n} did not come.`,
    button: 'Mark No-Show',
    done: 'The appointment is marked no-show.',
  },
  cancel: {
    title: 'Cancel Appointment',
    line: (n) => `Cancel the appointment with ${n}. They are told, and the time frees up.`,
    button: 'Cancel Appointment',
    done: 'The appointment is canceled.',
  },
};

/** Mark Completed, No-Show or Cancel (R12's calls), after asking; Cancel takes a reason. */
function CloseModal({
  id,
  ask,
  name,
  onClose,
  onDone,
}: {
  id: string;
  ask: Ask;
  name: string;
  onClose: () => void;
  onDone: (text: string) => void;
}) {
  const look = ASKS[ask];
  const [reason, setReason] = useState('');
  const run = useApiMutation(
    () =>
      ask === 'cancel'
        ? api.appointments.cancel(id, { reason: reason.trim() || null })
        : ask === 'complete'
          ? api.appointments.complete(id)
          : api.appointments.noShow(id),
    { invalidate: SCHEDULING },
  );
  return (
    <Modal open title={look.title} onClose={onClose}>
      <div className="flex flex-col gap-4">
        <p className="text-sm text-text">{look.line(name)}</p>
        {ask === 'cancel' ? (
          <Textarea
            label="Reason (optional)"
            rows={2}
            maxLength={500}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        ) : null}
        {run.error ? (
          <Callout icon={Info} tone="amber" surface="warning" size="compact">
            {errorMessage(run.error, DETAIL_ERRORS)}
            {errorCode(run.error) === 'NOT_FOUND'
              ? ' Reload the page to see its current state.'
              : ''}
          </Callout>
        ) : null}
        <div className="flex justify-end gap-3">
          <Button variant="secondary" onClick={onClose}>
            Keep It
          </Button>
          <Button
            disabled={run.isPending}
            className={ask === 'cancel' ? 'bg-danger text-on-action hover:bg-danger' : ''}
            onClick={() => run.mutate(undefined, { onSuccess: () => onDone(look.done) })}
          >
            {look.button}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
