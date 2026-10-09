'use client';

import {
  type MemberAvailability,
  SetWorkingHoursRequest,
  type WorkingHoursRange,
} from '@firmivra/types';
import { Button, Card, Input } from '@firmivra/ui';
import { useState } from 'react';
import { api } from '../../../../../../lib/api';
import { errorMessage } from '../../../../../../lib/errors';
import { useApiMutation } from '../../../../../../lib/query';
import { CALENDAR, CALENDAR_ERRORS } from '../../../calendar/_components/shared';

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
/** Monday first; Weekday 0 is Sunday. */
const WEEK = [1, 2, 3, 4, 5, 6, 0];

const clock = (time: string) => {
  const hour = Number(time.slice(0, 2));
  return `${hour % 12 || 12}:${time.slice(3)} ${hour < 12 ? 'AM' : 'PM'}`;
};

/**
 * One person's regular week, in the firm's time zone and 15-minute steps. Saving replaces the
 * whole week; an empty week means no hours. Owner and Admin edit anyone, Staff themselves.
 */
export function WorkingHours({
  member,
  editable,
}: {
  member: MemberAvailability;
  editable: boolean;
}) {
  const [hours, setHours] = useState<WorkingHoursRange[]>(member.hours);
  const [problem, setProblem] = useState('');
  const save = useApiMutation(
    (body: SetWorkingHoursRequest) => api.availability.setWorkingHours(member.member.userId, body),
    { invalidate: CALENDAR },
  );
  const change = (index: number, patch: Partial<WorkingHoursRange>) =>
    setHours(hours.map((range, i) => (i === index ? { ...range, ...patch } : range)));
  const submit = () => {
    const checked = SetWorkingHoursRequest.safeParse({ hours });
    setProblem(checked.success ? '' : (checked.error.issues[0]?.message ?? 'Check the hours.'));
    if (checked.success) save.mutate({ hours });
  };

  return (
    <Card title={member.member.name} data-testid="member-hours">
      <ul className="flex flex-col gap-3">
        {WEEK.map((weekday) => {
          const day = DAYS[weekday] ?? '';
          const ranges = hours.flatMap((range, index) =>
            range.weekday === weekday ? [{ range, index }] : [],
          );
          return (
            <li
              key={weekday}
              className="flex flex-col gap-2 border-t border-border pt-3 sm:flex-row"
            >
              <span className="w-28 shrink-0 text-sm font-medium text-text">{day}</span>
              <div className="flex flex-1 flex-col gap-2">
                {ranges.length === 0 ? (
                  <span className="text-sm text-muted">Not working</span>
                ) : null}
                {ranges.map(({ range, index }) =>
                  editable ? (
                    <div key={index} className="flex flex-wrap items-end gap-2">
                      <Input
                        label="From"
                        aria-label={`${day} from`}
                        type="time"
                        step={900}
                        value={range.startsAt}
                        onChange={(event) => change(index, { startsAt: event.target.value })}
                      />
                      <Input
                        label="To"
                        aria-label={`${day} to`}
                        type="time"
                        step={900}
                        value={range.endsAt}
                        onChange={(event) => change(index, { endsAt: event.target.value })}
                      />
                      <Button
                        variant="ghost"
                        onClick={() => setHours(hours.filter((_, i) => i !== index))}
                      >
                        Remove
                      </Button>
                    </div>
                  ) : (
                    <span key={index} className="text-sm text-text">
                      {clock(range.startsAt)} – {clock(range.endsAt)}
                    </span>
                  ),
                )}
                {editable ? (
                  <Button
                    variant="ghost"
                    className="self-start"
                    aria-label={`Add hours on ${day}`}
                    onClick={() =>
                      setHours([...hours, { weekday, startsAt: '09:00', endsAt: '17:00' }])
                    }
                  >
                    Add hours
                  </Button>
                ) : null}
              </div>
            </li>
          );
        })}
      </ul>
      {editable ? (
        <div className="mt-4 flex flex-col items-start gap-2 border-t border-border pt-4">
          <Button onClick={submit} disabled={save.isPending}>
            {save.isPending ? 'Saving…' : 'Save working hours'}
          </Button>
          {save.isSuccess && !problem ? (
            <p role="status" className="text-sm text-success">
              Working hours saved.
            </p>
          ) : null}
          {problem || save.error ? (
            <p role="alert" className="text-sm text-danger">
              {problem || errorMessage(save.error, CALENDAR_ERRORS)}
            </p>
          ) : null}
        </div>
      ) : null}
    </Card>
  );
}
