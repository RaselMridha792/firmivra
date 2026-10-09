'use client';

import type { MySlot } from '@firmivra/types';
import { Button, Input } from '@firmivra/ui';
import { useState } from 'react';
import { PageState } from '../../../../../../components/page-state';
import { api } from '../../../../../../lib/api';
import { useApiQuery } from '../../../../../../lib/query';
import { myAppointmentsKey, slotLabel } from './shared';

/**
 * A day's free times for a kind of appointment. `round` asks again: after a time was taken, the
 * caller bumps it so the list no longer offers it. The firm picks the staff member. When moving
 * an appointment, `current` is its start: shown, but not offered.
 */
export function FreeTimes({
  slug,
  typeId,
  excludeAppointmentId,
  current,
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
  current?: string;
  date: string;
  min: string;
  picked: MySlot | null;
  round: number;
  onDate: (date: string) => void;
  onPick: (slot: MySlot | null) => void;
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

  // What the day input shows while someone types. Only a whole date, from `min` to 2100, is
  // asked about: a date input reports half-typed years such as 0202-10-12. Until the day is
  // usable, no times show and none stays picked, so the box and the list never disagree.
  const [typed, setTyped] = useState(date);
  const usable = (value: string) =>
    /^\d{4}-\d{2}-\d{2}$/.test(value) && value >= min && value <= '2100-12-31';
  const isCurrent = (slot: MySlot) =>
    current !== undefined && Date.parse(slot.startsAt) === Date.parse(current);

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
          else onPick(null);
        }}
      />
      {usable(typed) ? (
        <PageState query={slots}>
          {({ slots: free }) =>
            free.length ? (
              <div role="group" aria-label="Free times" className="flex flex-wrap gap-2">
                {free.map((slot) => (
                  <Button
                    key={slot.startsAt}
                    variant={picked?.startsAt === slot.startsAt ? 'primary' : 'outline'}
                    aria-pressed={picked?.startsAt === slot.startsAt}
                    disabled={isCurrent(slot)}
                    onClick={() => onPick(slot)}
                  >
                    {slotLabel(slot.startsAt, date)}
                    {isCurrent(slot) ? ' (current)' : ''}
                  </Button>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted">No free times on this day. Try another day.</p>
            )
          }
        </PageState>
      ) : (
        <p className="text-sm text-muted">Choose a day to see its free times.</p>
      )}
    </div>
  );
}
