'use client';

import {
  type BlockedTime,
  CreateBlockedTimeRequest,
  type MemberAvailability,
} from '@firmivra/types';
import { Button, Card, Input, Select } from '@firmivra/ui';
import { useState } from 'react';
import { PageState } from '../../../../../../components/page-state';
import { api } from '../../../../../../lib/api';
import { errorMessage } from '../../../../../../lib/errors';
import { useApiMutation, useApiQuery } from '../../../../../../lib/query';
import { AVAILABILITY, CALENDAR_ERRORS } from '../../../calendar/_components/shared';
import {
  dayLabel,
  isCalendarDate,
  localParts,
  timeLabel,
  todayIn,
  toInstant,
} from '../../../calendar/_components/time';

const WHOLE_FIRM = 'firm';
const DAY_MS = 86_400_000;

/**
 * Time away (holiday, training) for one person or the whole firm, for the next three months.
 * Owner and Admin block anyone or the firm; Staff block and unblock only their own time.
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
  const [range] = useState(() => {
    const now = Date.now();
    return { from: new Date(now).toISOString(), to: new Date(now + 92 * DAY_MS).toISOString() };
  });
  const blocks = useApiQuery([...AVAILABILITY, 'blocked', range.from], () =>
    api.availability.blockedTimes(range),
  );
  const unblock = useApiMutation((id: string) => api.availability.unblock(id), {
    invalidate: AVAILABILITY,
  });
  const when = (iso: string) =>
    `${dayLabel(localParts(iso, timeZone).date)}, ${timeLabel(iso, timeZone)}`;
  const mine = (block: BlockedTime) => manager || block.member?.userId === me;

  return (
    <Card title="Blocked time" className="flex flex-col gap-4">
      <AddBlock members={members} timeZone={timeZone} me={me} manager={manager} />
      {unblock.error ? (
        <p role="alert" className="text-sm text-danger">
          {errorMessage(unblock.error, CALENDAR_ERRORS)}
        </p>
      ) : null}
      <PageState query={blocks} empty="No blocked time in the next three months.">
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
  const block = useApiMutation((body: CreateBlockedTimeRequest) => api.availability.block(body), {
    invalidate: AVAILABILITY,
  });
  const submit = () => {
    if (![start.time, end.time].every(Boolean) || ![start.date, end.date].every(isCalendarDate)) {
      setProblem('Choose when the block starts and ends, from 2000 to 2100.');
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
    if (checked.success && !ended) block.mutate(body, { onSuccess: () => setReason('') });
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
          label="Reason (optional)"
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
      {problem || block.error ? (
        <p role="alert" className="text-sm text-danger">
          {problem || errorMessage(block.error, CALENDAR_ERRORS)}
        </p>
      ) : null}
    </div>
  );
}
