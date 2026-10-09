'use client';

import type { AppointmentDetail, MemberAvailability, Slot } from '@firmivra/types';
import { Button, Select } from '@firmivra/ui';
import { useState } from 'react';
import { api } from '../../../../../lib/api';
import { errorCode, errorMessage } from '../../../../../lib/errors';
import { useApiMutation } from '../../../../../lib/query';
import { CALENDAR, CALENDAR_ERRORS, GONE } from './shared';
import { SlotPicker } from './slot-picker';
import { localParts, timeLabel } from './time';

/**
 * Moves an appointment to a free time, with the same or another staff member (same length).
 * If someone takes the time first (409 SLOT_TAKEN), it says so and lists the free times again.
 */
export function RescheduleForm({
  appointment,
  timeZone,
  members,
  onDone,
  onStale,
}: {
  appointment: AppointmentDetail;
  timeZone: string;
  members: MemberAvailability[];
  onDone: () => void;
  /** Reloads the appointment after someone else changed it. */
  onStale: () => void;
}) {
  const [date, setDate] = useState(() => localParts(appointment.startsAt, timeZone).date);
  // The same person by default, unless they are no longer on the team (not in the list).
  const [staff, setStaff] = useState(() =>
    members.some(({ member }) => member.userId === appointment.staff.userId)
      ? appointment.staff.userId
      : (members[0]?.member.userId ?? ''),
  );
  const [picked, setPicked] = useState<Slot | null>(null);
  const [round, setRound] = useState(0);
  const move = useApiMutation(
    (slot: Slot) =>
      api.appointments.reschedule(appointment.id, {
        startsAt: slot.startsAt,
        staffUserId: slot.staff.userId,
      }),
    { invalidate: CALENDAR },
  );

  if (!appointment.type) {
    return (
      <p className="text-sm text-muted">An appointment without a type can&apos;t move here yet.</p>
    );
  }
  const taken = () => {
    setPicked(null);
    setRound(round + 1);
  };

  return (
    <div className="flex flex-col items-start gap-3 rounded-card border border-border p-4">
      <Select
        label="Staff"
        value={staff}
        onChange={(event) => {
          setStaff(event.target.value);
          setPicked(null);
        }}
        options={members.map(({ member }) => ({ value: member.userId, label: member.name }))}
      />
      <SlotPicker
        typeId={appointment.type.id}
        staffUserId={staff}
        excludeAppointmentId={appointment.id}
        timeZone={timeZone}
        date={date}
        picked={picked}
        round={round}
        onDate={(next) => {
          setDate(next);
          setPicked(null);
        }}
        onPick={setPicked}
      />
      <Button
        disabled={!picked || move.isPending}
        onClick={() =>
          picked &&
          move.mutate(picked, {
            onSuccess: onDone,
            onError: (error) => {
              if (errorCode(error) === 'SLOT_TAKEN') taken();
              if (GONE.has(errorCode(error) ?? '')) onStale();
            },
          })
        }
      >
        {move.isPending
          ? 'Moving…'
          : picked
            ? `Move to ${timeLabel(picked.startsAt, timeZone)}`
            : 'Pick a free time'}
      </Button>
      {move.error ? (
        <p role="alert" className="text-sm text-danger">
          {errorMessage(move.error, CALENDAR_ERRORS)}
        </p>
      ) : null}
    </div>
  );
}
