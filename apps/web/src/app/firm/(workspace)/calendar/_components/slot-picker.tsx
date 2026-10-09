'use client';

import type { Slot } from '@firmivra/types';
import { Button, Input } from '@firmivra/ui';
import { PageState } from '../../../../../components/page-state';
import { api } from '../../../../../lib/api';
import { useApiQuery } from '../../../../../lib/query';
import { APPOINTMENTS } from './shared';
import { timeLabel } from './time';

/**
 * A day's free times for an appointment type (the API's slots). `round` asks again: after
 * SLOT_TAKEN the caller bumps it, so the list no longer offers the time someone just took.
 */
export function SlotPicker({
  typeId,
  staffUserId,
  excludeAppointmentId,
  timeZone,
  date,
  picked,
  round,
  onDate,
  onPick,
}: {
  typeId: string;
  staffUserId?: string;
  excludeAppointmentId?: string;
  timeZone: string;
  date: string;
  picked: Slot | null;
  round: number;
  onDate: (date: string) => void;
  onPick: (slot: Slot) => void;
}) {
  const slots = useApiQuery(
    [...APPOINTMENTS, 'slots', typeId, staffUserId, excludeAppointmentId, date, round],
    () =>
      api.appointments.slots({
        typeId,
        from: date,
        to: date,
        ...(staffUserId ? { staffUserId } : {}),
        ...(excludeAppointmentId ? { excludeAppointmentId } : {}),
      }),
  );
  const same = (slot: Slot) =>
    picked?.startsAt === slot.startsAt && picked.staff.userId === slot.staff.userId;

  return (
    <div className="flex flex-col gap-3">
      <Input
        label="Date"
        type="date"
        value={date}
        onChange={(event) => onDate(event.target.value)}
      />
      <PageState query={slots}>
        {({ slots: free }) =>
          free.length ? (
            <div role="group" aria-label="Free times" className="flex flex-wrap gap-2">
              {free.map((slot) => (
                <Button
                  key={`${slot.startsAt}-${slot.staff.userId}`}
                  variant={same(slot) ? 'primary' : 'secondary'}
                  aria-pressed={same(slot)}
                  onClick={() => onPick(slot)}
                >
                  {timeLabel(slot.startsAt, timeZone)}
                  {staffUserId ? '' : ` · ${slot.staff.name}`}
                </Button>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted">No free times on this day.</p>
          )
        }
      </PageState>
    </div>
  );
}
