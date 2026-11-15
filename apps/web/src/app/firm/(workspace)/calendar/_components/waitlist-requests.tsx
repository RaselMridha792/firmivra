'use client';

import type { WaitlistEntry } from '@firmivra/types';
import { Button } from '@firmivra/ui';
import { ClockCounterClockwise } from '@phosphor-icons/react';
import { useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useState } from 'react';
import { api } from '../../../../../lib/api';
import { errorCode, errorMessage } from '../../../../../lib/errors';
import { useApiMutation, useApiQuery } from '../../../../../lib/query';
import { dateAndTime, SCHEDULING } from './appointments-parts';

// R55, Appointments A3: the waitlist requests staff decide (the firm's STAFF_APPROVAL mode). A
// client took an offered earlier time; the appointment keeps its current time until a member
// approves, and approving checks the time again (a time taken meanwhile is said plainly, and the
// client waits for the next opening). Staff see only the appointments they see in full.

export const WAITLIST_KEY = ['appointment-waitlist'];

const ERRORS: Record<string, string> = {
  OFFER_TAKEN:
    'That earlier time was taken meanwhile, so the appointment keeps its time. The client stays on the waitlist for the next opening.',
  WAITLIST_ENTRY_CLOSED: 'This request was already decided. The list has been refreshed.',
};

const timeOf = (iso: string, timeZone: string) => dateAndTime(iso, timeZone).join(', ');

/**
 * The requests to decide: on the Appointments screen every one the member sees (shown only when
 * there is one), or, with `appointmentId`, that appointment's own (its detail page).
 */
export function WaitlistRequests({
  timeZone,
  appointmentId,
}: {
  timeZone: string;
  appointmentId?: string;
}) {
  const list = useApiQuery([...WAITLIST_KEY, 'live'], () => api.appointmentWaitlist.list());
  const [note, setNote] = useState<{ text: string; failed: boolean } | null>(null);
  const requests = (list.data?.items ?? []).filter(
    (e) => e.status === 'REQUESTED' && (!appointmentId || e.appointmentId === appointmentId),
  );
  if (requests.length === 0 && !note) return null;
  return (
    <section
      aria-labelledby="waitlist-requests-title"
      data-testid="waitlist-requests"
      className="flex min-w-0 flex-col gap-3 rounded-xl border border-divider bg-surface p-4 shadow-sm"
    >
      <h2
        id="waitlist-requests-title"
        className="flex items-center gap-2 text-lg font-bold text-heading"
      >
        <ClockCounterClockwise aria-hidden weight="fill" className="size-5 text-link" />
        {appointmentId ? 'Waitlist Request' : `Waitlist Requests (${requests.length})`}
      </h2>
      {note ? (
        <p
          role={note.failed ? 'alert' : 'status'}
          className={`text-sm ${note.failed ? 'text-danger' : 'text-success'}`}
        >
          {note.text}
        </p>
      ) : null}
      {requests.length ? (
        <ul className="flex flex-col divide-y divide-divider">
          {requests.map((e) => (
            <Request
              key={e.id}
              entry={e}
              timeZone={timeZone}
              linked={!appointmentId}
              onNote={setNote}
            />
          ))}
        </ul>
      ) : null}
    </section>
  );
}

function Request({
  entry,
  timeZone,
  linked,
  onNote,
}: {
  entry: WaitlistEntry;
  timeZone: string;
  /** On the Appointments screen the client's name opens the appointment. */
  linked: boolean;
  onNote: (note: { text: string; failed: boolean } | null) => void;
}) {
  const decide = useApiMutation(
    (kind: 'approve' | 'reject') => api.appointmentWaitlist[kind](entry.id),
    { invalidate: WAITLIST_KEY },
  );
  const client = useQueryClient();
  // The calendar and the record show the new time (or the time kept).
  const refresh = () => void client.invalidateQueries({ queryKey: SCHEDULING });
  const act = (kind: 'approve' | 'reject') => {
    onNote(null);
    decide.mutate(kind, {
      onSuccess: () => {
        refresh();
        onNote({
          text:
            kind === 'approve'
              ? `${entry.client.name}'s appointment moved to the earlier time. They were told.`
              : `${entry.client.name} keeps the current time.`,
          failed: false,
        });
      },
      onError: (error) => {
        onNote({ text: errorMessage(error, ERRORS), failed: true });
        if (errorCode(error) === 'OFFER_TAKEN' || errorCode(error) === 'WAITLIST_ENTRY_CLOSED') {
          refresh();
        }
      },
    });
  };
  const requested = entry.offer ? timeOf(entry.offer.startsAt, timeZone) : '—';
  return (
    <li
      className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm"
      data-testid="waitlist-request"
    >
      <div className="flex min-w-0 flex-col gap-1">
        {linked ? (
          <Link
            href={`/calendar/${entry.appointmentId}`}
            className="font-semibold text-link hover:underline"
          >
            {entry.client.name}
          </Link>
        ) : (
          <span className="font-semibold text-heading">{entry.client.name}</span>
        )}
        <span className="text-text">
          {entry.typeName ?? 'Appointment'} with {entry.staffName}:{' '}
          <span className="text-muted">{timeOf(entry.startsAt, timeZone)}</span> →{' '}
          <span className="font-semibold text-heading">{requested}</span>
        </span>
        <span className="text-xs text-muted">
          The current time stands until you approve. Approving checks the new time again.
        </span>
      </div>
      <div className="flex gap-2">
        <Button variant="secondary" disabled={decide.isPending} onClick={() => act('reject')}>
          Reject
        </Button>
        <Button disabled={decide.isPending} onClick={() => act('approve')}>
          Approve
        </Button>
      </div>
    </li>
  );
}
