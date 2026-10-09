'use client';

import type { MySlot } from '@firmivra/types';
import { Button, Input } from '@firmivra/ui';
import { useState } from 'react';
import { PageState } from '../../../../../../components/page-state';
import { api } from '../../../../../../lib/api';
import { useApiQuery } from '../../../../../../lib/query';
import { clock, myAppointmentsKey } from './shared';

/**
 * A day's free times for a kind of appointment. `round` asks again: after a time was taken, the
 * caller bumps it so the list no longer offers it. The firm picks the staff member.
 */
export function FreeTimes({
  slug,
  typeId,
  excludeAppointmentId,
  date,
  min,
  picked,
  round,
  onDate,
  onPick,
}: {
  slug: string;
  typeId: string;
  excludeAppointmentId?: string;
  date: string;
  min: string;
  picked: MySlot | null;
  round: number;
  onDate: (date: string) => void;
  onPick: (slot: MySlot) => void;
}) {
  const slots = useApiQuery(
    [...myAppointmentsKey(slug), 'slots', typeId, excludeAppointmentId, date, round],
    () =>
      api.myAppointments(slug).slots({
        typeId,
        from: date,
        to: date,
        ...(excludeAppointmentId ? { excludeAppointmentId } : {}),
      }),
  );

  // What the day input shows while someone types. Only a whole date, from today to 2100, is
  // asked about: a date input reports half-typed years such as 0202-10-12.
  const [typed, setTyped] = useState(date);
  const usable = (value: string) =>
    /^\d{4}-\d{2}-\d{2}$/.test(value) && value >= min && value <= '2100-12-31';

  return (
    <div className="flex flex-col gap-3">
      <Input
        label="Day"
        type="date"
        min={min}
        value={typed}
        onChange={(event) => {
          setTyped(event.target.value);
          if (usable(event.target.value)) onDate(event.target.value);
        }}
      />
      <PageState query={slots}>
        {({ slots: free }) =>
          free.length ? (
            <div role="group" aria-label="Free times" className="flex flex-wrap gap-2">
              {free.map((slot) => (
                <Button
                  key={slot.startsAt}
                  variant={picked?.startsAt === slot.startsAt ? 'primary' : 'outline'}
                  aria-pressed={picked?.startsAt === slot.startsAt}
                  onClick={() => onPick(slot)}
                >
                  {clock(slot.startsAt)}
                </Button>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted">No free times on this day. Try another day.</p>
          )
        }
      </PageState>
    </div>
  );
}
