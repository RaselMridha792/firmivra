'use client';

import type { MyAppointment, MyWaitlist, MyWaitlistEntry } from '@firmivra/types';
import { Button } from '@firmivra/ui';
import type { UseQueryResult } from '@tanstack/react-query';
import { api } from '../../../../../../lib/api';
import { errorMessage } from '../../../../../../lib/errors';
import { useApiMutation, useApiQuery } from '../../../../../../lib/query';
import { myAppointmentsKey, when } from './shared';

// R55, Appointments A3: the waitlist for an earlier time, on each of the client's own upcoming
// appointments. Join waits for an earlier opening; an offer is held for the client until its time
// and they take it (the appointment moves, or the firm is asked: the firm's mode) or let it go.
// The appointment keeps its time until a move is confirmed.

const LIVE = new Set(['WAITING', 'OFFERED', 'REQUESTED']);

export const WAITLIST_ERRORS: Record<string, string> = {
  WAITLIST_OFF: 'The waitlist is not available right now.',
  ALREADY_WAITING: 'This appointment is already on the waitlist.',
  WAITLIST_ENTRY_CLOSED: 'This offer is no longer open. The list has been refreshed.',
  OFFER_TAKEN: 'That earlier time was just taken. You stay on the waitlist for the next opening.',
};

/** The client's waitlist (under the appointments' key, so a change refreshes both). */
export const useMyWaitlist = (slug: string) =>
  useApiQuery([...myAppointmentsKey(slug), 'waitlist'], () => api.myWaitlist(slug).list());

/** The live entry of one appointment, if any. */
const liveOf = (list: MyWaitlist | undefined, appointmentId: string) =>
  list?.items.find((e) => e.appointmentId === appointmentId && LIVE.has(e.status));

export function WaitlistRow({
  slug,
  item,
  waitlist,
  onNotice,
  clientTimezone,
  firmTimezone,
}: {
  slug: string;
  item: MyAppointment;
  waitlist: UseQueryResult<MyWaitlist>;
  onNotice: (notice: { text: string; failed: boolean } | null) => void;
  clientTimezone?: string;
  firmTimezone?: string;
}) {
  const invalidate = myAppointmentsKey(slug);
  const client = api.myWaitlist(slug);
  const join = useApiMutation(() => client.join({ appointmentId: item.id }), { invalidate });
  const step = useApiMutation(
    ({ kind, id }: { kind: 'accept' | 'decline' | 'leave'; id: string }) => client[kind](id),
    { invalidate },
  );
  const list = waitlist.data;
  // The upcoming list holds scheduled ones only; an attended one is the other client's to move.
  const ownUpcoming = !item.attending && item.status === 'SCHEDULED';
  if (!list || !ownUpcoming) return null;
  const entry = liveOf(list, item.id);
  if (!entry && !list.enabled) return null;
  const busy = join.isPending || step.isPending;
  const failed = (error: Error) =>
    onNotice({ text: errorMessage(error, WAITLIST_ERRORS), failed: true });
  const act = (kind: 'accept' | 'decline' | 'leave', e: MyWaitlistEntry, done: string) =>
    step.mutate(
      { kind, id: e.id },
      {
        onSuccess: (after) =>
          onNotice({
            text:
              after.status === 'MOVED' ? 'Your appointment was moved to the earlier time.' : done,
            failed: false,
          }),
        onError: failed,
      },
    );

  if (!entry) {
    return (
      <div className="flex flex-wrap items-center gap-2" data-testid="waitlist-join">
        <Button
          variant="ghost"
          disabled={busy}
          onClick={() =>
            join.mutate(undefined, {
              onSuccess: () =>
                onNotice({
                  text: 'You are on the waitlist. We will let you know if an earlier time opens.',
                  failed: false,
                }),
              onError: failed,
            })
          }
        >
          Join Waitlist for an Earlier Time
        </Button>
      </div>
    );
  }
  if (entry.status === 'WAITING') {
    return (
      <div className="flex flex-wrap items-center gap-2 text-sm" data-testid="waitlist-waiting">
        <span className="text-text">You are on the waitlist for an earlier time.</span>
        <Button
          variant="ghost"
          disabled={busy}
          onClick={() => act('leave', entry, 'You left the waitlist.')}
        >
          Leave Waitlist
        </Button>
      </div>
    );
  }
  const offer = entry.offer;
  if (!offer) return null;
  // The day and time (the offer may be on another day than the appointment).
  const range = when(offer.startsAt, clientTimezone, firmTimezone);
  if (entry.status === 'REQUESTED') {
    return (
      <p
        className="rounded-card border border-border bg-canvas p-3 text-sm text-text"
        data-testid="waitlist-requested"
      >
        You asked for {range}. The firm will confirm it; your current time stands until then.
      </p>
    );
  }
  const auto = list.mode === 'AUTO_CONFIRM';
  return (
    <div
      className="flex flex-col gap-2 rounded-card border border-border bg-canvas p-3 text-sm"
      data-testid="waitlist-offer"
    >
      <p className="font-semibold text-heading">An earlier time is available: {range}</p>
      <p className="text-text">
        It is held for you until {when(offer.expiresAt)}.{' '}
        {auto
          ? 'Taking it moves your appointment at once.'
          : 'The firm confirms the change; your current time stands until then.'}
      </p>
      <div className="flex flex-wrap gap-2">
        <Button
          variant="dark"
          disabled={busy}
          onClick={() =>
            act(
              'accept',
              entry,
              auto ? 'Your appointment was moved.' : 'You asked for the earlier time.',
            )
          }
        >
          {auto ? 'Take This Time' : 'Request This Time'}
        </Button>
        <Button
          variant="secondary"
          disabled={busy}
          onClick={() => act('decline', entry, 'You kept your current time.')}
        >
          No Thanks
        </Button>
      </div>
    </div>
  );
}
