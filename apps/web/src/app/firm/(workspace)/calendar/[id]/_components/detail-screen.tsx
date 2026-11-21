'use client';

import {
  type AppointmentRecord,
  LEAD_APPOINTMENT_OUTCOME_LABELS,
  LeadAppointmentOutcome,
  SERIES_SCOPE_LABELS,
  SeriesScope,
} from '@firmivra/types';
import {
  Badge,
  Button,
  Callout,
  Input,
  Modal,
  Radio,
  Skeleton,
  Table,
  Textarea,
} from '@firmivra/ui';
import {
  ArrowLeft,
  Bell,
  CalendarCheck,
  ChatCircleDots,
  ClockCounterClockwise,
  Info,
  LinkSimple,
  NotePencil,
  User,
  VideoCamera,
} from '@phosphor-icons/react';
import Link from 'next/link';
import { type ReactNode, useState } from 'react';
import { OriginLink, useOriginNavigate } from '../../../../../../components/origin-link';
import { api } from '../../../../../../lib/api';
import { errorCode, errorMessage } from '../../../../../../lib/errors';
import { useApiMutation, useApiQuery } from '../../../../../../lib/query';
import { SendIntakeDialog } from './send-intake-dialog';
import {
  METHOD_LABELS,
  NOT_LOADED,
  SCHEDULING,
  STATUS_LOOKS,
  dateAndTime,
} from '../../_components/appointments-parts';
import { todayIn } from '../../_components/time';
import { WaitlistRequests } from '../../_components/waitlist-requests';
import { CALENDAR_ERRORS } from '../../_components/shared';

const card =
  'flex min-w-0 flex-col gap-3 rounded-xl border border-divider bg-surface p-4 shadow-sm';
const quiet = 'rounded-lg bg-subtle p-4 text-sm text-muted';

const DETAIL_ERRORS: Record<string, string> = {
  ...CALENDAR_ERRORS,
  NOT_FOUND:
    'This appointment was not found. It may have been removed, or you may not have access.',
  APPOINTMENT_CLOSED: 'This appointment is no longer scheduled.',
};

const CHANNELS: Record<string, string> = { EMAIL: 'Email', SMS: 'SMS', PORTAL: 'Portal' };

/** "Email, 1 day before". */
const reminderText = (m: {
  channel: string;
  amount: number;
  unit: string;
  note?: string | null;
}) => {
  const unit = m.unit.toLowerCase().replace(/s$/, '');
  // Review 2 (B7): a reminder's own note, else the standard reminder.
  return `${CHANNELS[m.channel] ?? m.channel}, ${m.amount} ${unit}${m.amount === 1 ? '' : 's'} before${m.note ? ` ("${m.note}")` : ''}`;
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

export type Ask = 'cancel' | 'complete' | 'noShow';

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
  // A9: the intake form this appointment's type asks for, sent from here.
  const typeConfig = useApiQuery([...SCHEDULING, 'type-config', r?.type?.id ?? 'none'], async () =>
    r?.type ? api.scheduling.typeConfig(r.type.id) : null,
  );
  const requiredFormId = typeConfig.data?.requiredIntakeFormId ?? null;
  const [sendingIntake, setSendingIntake] = useState(false);
  const canSendIntake =
    !!r && !!open && r.contact.kind === 'CLIENT' && !!r.contact.id && !r.related.intakeForm;

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
          {r && !r.internal && r.contact.kind === 'CLIENT' && r.contact.id ? (
            // MSG-F21: New Message with this client chosen and this appointment in Related To;
            // Back returns here (SH1).
            <OriginLink
              href={`/messages/new?clientId=${r.contact.id}&related=appointment:${r.id}`}
              className="inline-flex min-h-11 items-center gap-2 rounded-control border border-action px-4 text-sm font-semibold text-action hover:bg-folder-surface"
            >
              <ChatCircleDots aria-hidden weight="fill" className="size-4" />
              Send Message
            </OriginLink>
          ) : null}
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

      {sendingIntake && r ? (
        <SendIntakeDialog
          record={r}
          requiredFormId={requiredFormId}
          onClose={() => setSendingIntake(false)}
          onSent={() => {
            setSendingIntake(false);
            setMessage('Intake form sent. This appointment shows when the client completes it.');
          }}
        />
      ) : null}

      {/* Appointments A3: the client asked for an earlier time; staff approve or reject it. */}
      {r ? <WaitlistRequests timeZone={r.timezone} appointmentId={r.id} /> : null}

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
                    // Review 2 (B9, B7): where the instructions show, and the confirmation's words.
                    [
                      'Instructions shown in',
                      (['email', 'portal', 'sms'] as const)
                        .filter((k) => r.instructionsIn[k])
                        .map((k) => (k === 'sms' ? 'Text' : k === 'email' ? 'Email' : 'Portal'))
                        .join(', ') || 'Nowhere',
                    ],
                    ['Confirmation message', r.confirmationMessage ?? 'The standard wording'],
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
                  // Review 2 (D2): Bookkeeping, Invoice, Task and Documents links are not built
                  // yet (nothing can set them), so they are not shown until they are.
                  [
                    'Intake form',
                    r.related.intakeForm
                      ? `${r.related.intakeForm.name} (${r.related.intakeForm.completed ? 'completed' : 'waiting'})`
                      : '—',
                  ],
                ]}
              />
            )}
            {canSendIntake ? (
              <div className="mt-3 flex flex-col gap-2" data-testid="detail-intake">
                {requiredFormId ? (
                  <p className="text-xs text-muted">
                    This appointment type asks for an intake form before the appointment.
                  </p>
                ) : null}
                <Button
                  variant="secondary"
                  className="self-start"
                  onClick={() => setSendingIntake(true)}
                  data-testid="send-intake"
                >
                  Send Intake Form
                </Button>
              </div>
            ) : null}
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
          // P4-2: a lead's own appointment (its contact is the lead) records an outcome.
          leadId={r.contact.kind === 'LEAD' ? r.contact.id : null}
          canConvert={r.contact.kind === 'LEAD' && r.contact.leadReach === true}
          timeZone={r.timezone}
          series={r.seriesId !== null}
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
      : `${METHOD_LABELS[r.method]}${r.otherVideoPlatform ? ` (${r.otherVideoPlatform})` : ''}${r.place.details ? `, ${r.place.details}` : ''}`;
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
          // Appointments A1: a group appointment's other clients (staff only).
          ...(r.attendees.length > 0
            ? ([['Other attendees', r.attendees.map((a) => a.name).join(', ')]] as [
                string,
                string,
              ][])
            : []),
          ['Type', r.type?.name ?? '—'],
          ['Service', r.service?.name ?? '—'],
          ['Date & time', r.allDay ? `${d}, all day` : `${d}, ${t1} – ${t2}`],
          ['Time zone', r.timezone],
          ['Staff', r.staff.map((s) => s.name).join(', ')],
          ['Location', where],
          // Review 2 (A2): the equipment it books.
          ['Equipment', r.equipment.map((e) => e.name).join(', ') || '—'],
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

/** P4-2 (Clients Review 2 N8-18): what each outcome of a lead's appointment does. */
const OUTCOME_HINTS: Record<LeadAppointmentOutcome, string> = {
  KEEP_LEAD: 'Undecided, or no service was chosen. The person stays a lead.',
  KEEP_LEAD_FOLLOW_UP: 'The person stays a lead; their next follow-up is set for the date below.',
  CONVERT_NEW:
    'A service was chosen. Next, Convert to Client makes them a New client; you can complete intake for them there.',
};

/**
 * Mark Completed, No-Show or Cancel (R12's calls), after asking; Cancel takes a reason. P4-2:
 * completing a lead's own appointment (`leadId`: a lead, no client yet) records its outcome and
 * notes; Convert to New client then opens the lead's Convert page, with Back to here.
 */
export function CloseModal({
  id,
  ask,
  name,
  leadId = null,
  canConvert = false,
  timeZone,
  series = false,
  onClose,
  onDone,
}: {
  id: string;
  ask: Ask;
  name: string;
  /** Review 2 (R2): one of a repeating series: Cancel asks which occurrences. */
  series?: boolean;
  leadId?: string | null;
  /**
   * The member reaches the lead (its owner, or an Owner or Admin): only they are offered Convert to
   * New client; the appointment's own staff member records the other two (the lead's answer, Nov 18).
   */
  canConvert?: boolean;
  /** The firm's time zone: the follow-up date is today or later there. */
  timeZone?: string;
  onClose: () => void;
  onDone: (text: string) => void;
}) {
  const look = ASKS[ask];
  const [reason, setReason] = useState('');
  const [scope, setScope] = useState<SeriesScope>('THIS');
  const withOutcome = ask === 'complete' && !!leadId;
  const [outcome, setOutcome] = useState<LeadAppointmentOutcome | null>(null);
  const [notes, setNotes] = useState('');
  const [followUpOn, setFollowUpOn] = useState('');
  const [tried, setTried] = useState(false);
  const navigate = useOriginNavigate();
  const missing = {
    outcome: withOutcome && !outcome ? 'Choose the outcome' : undefined,
    notes: withOutcome && !notes.trim() ? 'Add notes about the appointment' : undefined,
    followUpOn:
      withOutcome && outcome === 'KEEP_LEAD_FOLLOW_UP' && !followUpOn
        ? 'Choose the follow-up date'
        : undefined,
  };
  const run = useApiMutation(
    () =>
      ask === 'cancel'
        ? api.appointments.cancel(id, {
            reason: reason.trim() || null,
            ...(series ? { scope } : {}),
          })
        : ask === 'complete'
          ? api.appointments.complete(
              id,
              withOutcome && outcome
                ? {
                    outcome,
                    notes: notes.trim(),
                    ...(outcome === 'KEEP_LEAD_FOLLOW_UP' ? { followUpOn } : {}),
                  }
                : {},
            )
          : api.appointments.noShow(id),
    { invalidate: SCHEDULING },
  );
  const submit = () => {
    setTried(true);
    if (missing.outcome || missing.notes || missing.followUpOn) return;
    run.mutate(undefined, {
      onSuccess: () => {
        if (withOutcome && outcome === 'CONVERT_NEW' && leadId) {
          navigate(`/leads/${leadId}/convert`);
          return;
        }
        onDone(
          withOutcome && outcome
            ? `The appointment is marked completed: ${LEAD_APPOINTMENT_OUTCOME_LABELS[outcome]}.`
            : look.done,
        );
      },
    });
  };
  return (
    <Modal open title={look.title} onClose={onClose}>
      <div className="flex flex-col gap-4">
        <p className="text-sm text-text">{look.line(name)}</p>
        {withOutcome ? (
          <>
            <fieldset
              className="flex flex-col gap-1"
              aria-invalid={tried && missing.outcome ? true : undefined}
              aria-describedby={tried && missing.outcome ? 'outcome-error' : undefined}
            >
              <legend className="mb-1 text-sm font-semibold text-heading">Outcome</legend>
              {LeadAppointmentOutcome.options
                .filter((value) => canConvert || value !== 'CONVERT_NEW')
                .map((value) => (
                  <div key={value} className="flex flex-col">
                    <Radio
                      name="lead-outcome"
                      value={value}
                      label={LEAD_APPOINTMENT_OUTCOME_LABELS[value]}
                      checked={outcome === value}
                      onChange={() => setOutcome(value)}
                    />
                    <p className="pl-8 text-xs text-muted">{OUTCOME_HINTS[value]}</p>
                  </div>
                ))}
              {canConvert ? null : (
                <p className="text-xs text-muted">The lead&apos;s owner can convert this lead.</p>
              )}
              {tried && missing.outcome ? (
                <p id="outcome-error" className="text-sm font-medium text-danger">
                  {missing.outcome}
                </p>
              ) : null}
            </fieldset>
            {outcome === 'KEEP_LEAD_FOLLOW_UP' ? (
              <Input
                label="Follow-up date"
                type="date"
                min={timeZone ? todayIn(timeZone) : undefined}
                value={followUpOn}
                onChange={(e) => setFollowUpOn(e.target.value)}
                error={tried ? missing.followUpOn : undefined}
              />
            ) : null}
            <Textarea
              label="Notes"
              hint="Internal: kept on this appointment and the lead's activity."
              rows={3}
              maxLength={2000}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              error={tried ? missing.notes : undefined}
            />
          </>
        ) : null}
        {ask === 'cancel' && series ? (
          <fieldset className="flex flex-col gap-1" data-testid="cancel-scope">
            <legend className="mb-1 text-sm font-semibold text-heading">Cancel</legend>
            {SeriesScope.options.map((value) => (
              <Radio
                key={value}
                name="cancel-scope"
                value={value}
                label={SERIES_SCOPE_LABELS[value]}
                checked={scope === value}
                onChange={() => setScope(value)}
              />
            ))}
          </fieldset>
        ) : null}
        {ask === 'cancel' ? (
          <Textarea
            label="Reason (optional)"
            // Appointments Review 2 (P3): the cancellation email shows it to the client.
            hint="The client sees this in the cancellation email. Don't add internal notes."
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
            onClick={submit}
          >
            {look.button}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
