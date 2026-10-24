'use client';

import {
  type BlockConflict,
  type BlockedTime,
  CreateBlockedTimeRequest,
  type MemberAvailability,
} from '@firmivra/types';
import { Button, Card, Input, Select } from '@firmivra/ui';
import Link from 'next/link';
import { useState } from 'react';
import { PageState } from '../../../../../../components/page-state';
import { api } from '../../../../../../lib/api';
import { errorCode, errorMessage } from '../../../../../../lib/errors';
import { useApiMutation, useApiQuery } from '../../../../../../lib/query';
import { AVAILABILITY, CALENDAR, CALENDAR_ERRORS } from '../../../calendar/_components/shared';
import {
  addDays,
  dayLabel,
  isCalendarDate,
  localParts,
  timeLabel,
  todayIn,
  toInstant,
} from '../../../calendar/_components/time';

const WHOLE_FIRM = 'firm';
const EVERYONE = '';
/** The API lists at most 93 days at a time; 91 calendar days leave room for a clock change. */
const MAX_DAYS = 91;
const BLOCK_ERRORS: Record<string, string> = {
  ...CALENDAR_ERRORS,
  NOTHING_FREE: 'Every part of this time is booked, so nothing was blocked.',
};

/**
 * Time away (holiday, training) for one person or the whole firm, by default for the next three
 * months. Owner and Admin block anyone or the firm; Staff block and unblock only their own time,
 * and say why (Octavia's Availability guide, items 5, 6 and 9).
 */
export function BlockedTimes({
  members,
  timeZone,
  me,
  manager,
}: {
  members: MemberAvailability[];
  timeZone: string;
  me: string;
  manager: boolean;
}) {
  const [today] = useState(() => todayIn(timeZone));
  const [who, setWho] = useState(EVERYONE);
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(() => addDays(today, MAX_DAYS));
  const days = (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000;
  const rangeProblem =
    !isCalendarDate(from) || !isCalendarDate(to)
      ? 'Choose the dates to show.'
      : days < 0
        ? 'The end date must be on or after the start date.'
        : days > MAX_DAYS
          ? 'Show at most three months at a time.'
          : '';
  const query = {
    from: rangeProblem ? toInstant(today, '00:00', timeZone) : toInstant(from, '00:00', timeZone),
    to: toInstant(rangeProblem ? addDays(today, 1) : addDays(to, 1), '00:00', timeZone),
    ...(who ? { userId: who } : {}),
  };
  const blocks = useApiQuery([...AVAILABILITY, 'blocked', query.from, query.to, who], () =>
    api.availability.blockedTimes(query),
  );
  const unblock = useApiMutation((id: string) => api.availability.unblock(id), {
    invalidate: CALENDAR,
  });
  const when = (iso: string) =>
    `${dayLabel(localParts(iso, timeZone).date)}, ${timeLabel(iso, timeZone)}`;
  const mine = (block: BlockedTime) => manager || block.member?.userId === me;

  return (
    <Card title="Blocked time" className="flex flex-col gap-4">
      <AddBlock members={members} timeZone={timeZone} me={me} manager={manager} />
      <div className="grid gap-3 border-t border-border pt-4 sm:grid-cols-3">
        <Select
          label="Show"
          value={who}
          onChange={(event) => setWho(event.target.value)}
          options={[
            { value: EVERYONE, label: 'Everyone' },
            ...members.map(({ member }) => ({ value: member.userId, label: member.name })),
          ]}
        />
        <Input
          label="From"
          type="date"
          value={from}
          onChange={(event) => setFrom(event.target.value)}
        />
        <Input label="To" type="date" value={to} onChange={(event) => setTo(event.target.value)} />
      </div>
      {rangeProblem ? (
        <p role="alert" className="text-sm text-danger">
          {rangeProblem}
        </p>
      ) : null}
      {unblock.error ? (
        <p role="alert" className="text-sm text-danger">
          {errorMessage(unblock.error, CALENDAR_ERRORS)}
        </p>
      ) : null}
      <PageState query={blocks} empty="No blocked time in these dates.">
        {(items) => (
          <ul className="divide-y divide-border rounded-card border border-border">
            {items.map((block) => (
              <li
                key={block.id}
                data-testid="blocked-time"
                className="flex flex-wrap items-center justify-between gap-2 p-3 text-sm"
              >
                <span className="min-w-0">
                  <span className="block font-medium text-text">
                    {block.member?.name ?? 'Whole firm'}
                    {block.reason ? ` · ${block.reason}` : ''}
                  </span>
                  <span className="block text-muted">
                    {when(block.startsAt)} – {when(block.endsAt)}
                  </span>
                  {block.createdBy ? (
                    <span className="block text-muted">Added by {block.createdBy.name}</span>
                  ) : null}
                </span>
                {mine(block) ? (
                  <Button
                    variant="ghost"
                    disabled={unblock.isPending}
                    onClick={() => unblock.mutate(block.id)}
                  >
                    Remove
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </PageState>
    </Card>
  );
}

function AddBlock({
  members,
  timeZone,
  me,
  manager,
}: {
  members: MemberAvailability[];
  timeZone: string;
  me: string;
  manager: boolean;
}) {
  const [today] = useState(() => todayIn(timeZone));
  const [who, setWho] = useState(manager ? WHOLE_FIRM : me);
  const [start, setStart] = useState({ date: today, time: '09:00' });
  const [end, setEnd] = useState({ date: today, time: '17:00' });
  const [reason, setReason] = useState('');
  const [problem, setProblem] = useState('');
  const [done, setDone] = useState('');
  /** The appointments a refused block would cover, while the choice is open. */
  const [clashes, setClashes] = useState<{
    body: CreateBlockedTimeRequest;
    items: BlockConflict[];
  } | null>(null);
  const block = useApiMutation((body: CreateBlockedTimeRequest) => api.availability.block(body), {
    invalidate: CALENDAR,
  });
  const freeSlots = useApiMutation(
    (body: CreateBlockedTimeRequest) => api.availability.blockFreeSlots(body),
    { invalidate: CALENDAR },
  );
  const when = (iso: string) =>
    `${dayLabel(localParts(iso, timeZone).date)}, ${timeLabel(iso, timeZone)}`;
  // Staff blocking their own time say why (guide items 6 and 9); the API asks the same.
  const reasonNeeded = !manager;

  const submit = () => {
    setDone('');
    setClashes(null);
    freeSlots.reset();
    if (![start.time, end.time].every(Boolean) || ![start.date, end.date].every(isCalendarDate)) {
      setProblem('Choose when the block starts and ends, from 2000 to 2100.');
      return;
    }
    if (reasonNeeded && !reason.trim()) {
      setProblem('Give a reason for blocking your time.');
      return;
    }
    const body = {
      userId: who === WHOLE_FIRM ? null : who,
      startsAt: toInstant(start.date, start.time, timeZone),
      endsAt: toInstant(end.date, end.time, timeZone),
      reason,
    };
    const checked = CreateBlockedTimeRequest.safeParse(body);
    // The API also refuses a block that has already ended; say so before asking it.
    const ended = Date.parse(body.endsAt) <= Date.now();
    setProblem(
      ended
        ? 'A block must end in the future.'
        : checked.success
          ? ''
          : (checked.error.issues[0]?.message ?? 'Check the times.'),
    );
    if (!checked.success || ended) return;
    block.mutate(body, {
      onSuccess: () => {
        setReason('');
        setDone('Blocked.');
      },
      // Booked appointments in the range: list them and offer the free time only (item 8).
      onError: (error) => {
        if (errorCode(error) !== 'BLOCKS_APPOINTMENT') return;
        void api.availability
          .blockConflicts({
            ...(body.userId ? { userId: body.userId } : {}),
            startsAt: body.startsAt,
            endsAt: body.endsAt,
          })
          .then((items) => setClashes({ body, items }))
          .catch(() => undefined);
      },
    });
  };

  const blockFree = () => {
    if (!clashes) return;
    freeSlots.mutate(clashes.body, {
      onSuccess: (result) => {
        setClashes(null);
        setReason('');
        block.reset();
        const kept = result.kept.length;
        setDone(
          `Blocked the free time around ${kept} ${kept === 1 ? 'appointment' : 'appointments'}, which stay as they are.`,
        );
      },
    });
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="grid gap-3 sm:grid-cols-2">
        {manager ? (
          <Select
            label="Who"
            value={who}
            onChange={(event) => setWho(event.target.value)}
            options={[
              { value: WHOLE_FIRM, label: 'Whole firm' },
              ...members.map(({ member }) => ({ value: member.userId, label: member.name })),
            ]}
          />
        ) : null}
        <Input
          label={reasonNeeded ? 'Reason' : 'Reason (optional)'}
          required={reasonNeeded}
          value={reason}
          onChange={(event) => setReason(event.target.value)}
        />
        <Input
          label="Starts on"
          type="date"
          value={start.date}
          onChange={(event) => setStart({ ...start, date: event.target.value })}
        />
        <Input
          label="Starts at"
          type="time"
          step={900}
          value={start.time}
          onChange={(event) => setStart({ ...start, time: event.target.value })}
        />
        <Input
          label="Ends on"
          type="date"
          value={end.date}
          onChange={(event) => setEnd({ ...end, date: event.target.value })}
        />
        <Input
          label="Ends at"
          type="time"
          step={900}
          value={end.time}
          onChange={(event) => setEnd({ ...end, time: event.target.value })}
        />
      </div>
      <Button className="self-start" onClick={submit} disabled={block.isPending}>
        {block.isPending ? 'Blocking…' : 'Block this time'}
      </Button>
      {clashes ? (
        <section
          aria-label="Booked appointments in this time"
          className="flex flex-col gap-3 rounded-card border border-border p-3 text-sm"
        >
          <p className="font-medium text-text">
            {clashes.items.length === 1
              ? 'An appointment is booked in this time.'
              : `${clashes.items.length} appointments are booked in this time.`}{' '}
            Nothing is cancelled.
          </p>
          <ul className="flex flex-col gap-1">
            {clashes.items.map((a) => (
              <li key={a.id}>
                <Link href={`/calendar/${a.id}`} className="text-link underline">
                  {when(a.startsAt)} – {timeLabel(a.endsAt, timeZone)}
                </Link>
                <span className="text-muted">
                  {' '}
                  · {a.member.name} with {a.clientName}
                </span>
              </li>
            ))}
          </ul>
          <div className="flex flex-wrap gap-2">
            <Button onClick={blockFree} disabled={freeSlots.isPending}>
              {freeSlots.isPending ? 'Blocking…' : 'Block available slots only'}
            </Button>
            <Button
              variant="secondary"
              onClick={() => {
                setClashes(null);
                block.reset();
              }}
            >
              Change the time
            </Button>
          </div>
          <p className="text-muted">
            To move or reassign an appointment first, open it from the list above.
          </p>
        </section>
      ) : null}
      {done ? (
        <p role="status" className="text-sm text-success">
          {done}
        </p>
      ) : null}
      {problem || (block.error && !clashes) || freeSlots.error ? (
        <p role="alert" className="text-sm text-danger">
          {problem || errorMessage(freeSlots.error ?? block.error, BLOCK_ERRORS)}
        </p>
      ) : null}
    </div>
  );
}
