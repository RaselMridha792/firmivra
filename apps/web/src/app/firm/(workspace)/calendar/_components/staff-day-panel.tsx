'use client';

import type { AvailabilityBlock, MemberRef } from '@firmivra/types';
import { Input, Select, Skeleton } from '@firmivra/ui';
import { CheckCircle, WarningCircle } from '@phosphor-icons/react';
import { api } from '../../../../../lib/api';
import { useApiQuery } from '../../../../../lib/query';
import { NOT_LOADED, SCHEDULING } from './appointments-parts';

const KIND_LOOKS: Record<AvailabilityBlock['kind'], { label: string; tone: string }> = {
  AVAILABLE: { label: 'Available', tone: 'bg-success-soft text-success' },
  APPOINTMENT: { label: 'Booked', tone: 'bg-danger-soft text-danger' },
  CALENDAR_BUSY: { label: 'Busy', tone: 'bg-disabled text-muted' },
  BLOCKED: { label: 'Blocked', tone: 'bg-disabled text-muted' },
  TIME_OFF: { label: 'Time off', tone: 'bg-disabled text-muted' },
  BUFFER: { label: 'Buffer', tone: 'bg-warning-soft text-gold' },
  OUTSIDE_HOURS: { label: 'Outside working hours', tone: 'bg-subtle text-muted' },
};

const hour = (iso: string, timeZone: string) =>
  new Date(iso).toLocaleTimeString('en-US', { timeZone, hour: 'numeric', minute: '2-digit' });

const overlaps = (b: AvailabilityBlock, from?: string, to?: string) =>
  Boolean(from && to) &&
  Date.parse(b.startsAt) < Date.parse(to ?? '') &&
  Date.parse(b.endsAt) > Date.parse(from ?? '');

/**
 * The Staff Availability panel (appointments-overview-and-calendar.jpg): a staff member and a
 * date, the day's hour rows (`api.scheduling.staffDay`) with the chosen time marked "Selected
 * Time", and "No Conflicts" or the conflicts. Used by Schedule Appointment and Staff
 * Availability.
 */
export function StaffDayPanel({
  staff,
  staffUserId,
  date,
  startsAt,
  endsAt,
  excludeAppointmentId,
  onStaff,
  onDate,
}: {
  staff: MemberRef[];
  staffUserId: string;
  date: string;
  /** The proposed time, to check and to mark. */
  startsAt?: string;
  endsAt?: string;
  excludeAppointmentId?: string;
  onStaff: (userId: string) => void;
  onDate: (date: string) => void;
}) {
  const query = {
    staffUserId,
    date,
    ...(startsAt && endsAt ? { startsAt, endsAt } : {}),
    ...(excludeAppointmentId ? { excludeAppointmentId } : {}),
  };
  const day = useApiQuery([...SCHEDULING, 'staff-day', query], () =>
    staffUserId && date ? api.scheduling.staffDay(query) : Promise.resolve(null),
  );
  const d = day.data;
  const name = staff.find((s) => s.userId === staffUserId)?.name ?? 'This staff member';
  return (
    <div className="flex flex-col gap-3" data-testid="staff-day">
      <div className="grid grid-cols-2 gap-2">
        <Select
          label="Staff member"
          hideLabel
          options={
            staff.length
              ? staff.map((s) => ({ value: s.userId, label: s.name }))
              : [{ value: '', label: 'No staff' }]
          }
          value={staffUserId}
          onChange={(e) => onStaff(e.target.value)}
        />
        <Input
          label="Date"
          hideLabel
          type="date"
          value={date}
          onChange={(e) => onDate(e.target.value)}
        />
      </div>
      {day.isPending ? (
        <Skeleton className="h-72" />
      ) : !d ? (
        <p className="rounded-lg bg-subtle p-4 text-sm text-muted">
          {day.isError ? NOT_LOADED : 'Choose a staff member and a date.'}
        </p>
      ) : (
        <ol className="flex flex-col gap-1.5">
          {d.blocks.map((b) => {
            const selected = overlaps(b, startsAt, endsAt);
            const look = KIND_LOOKS[b.kind];
            return (
              <li key={b.startsAt} className="grid grid-cols-[4.5rem_1fr] items-center gap-2">
                <span className="text-xs text-muted">{hour(b.startsAt, d.timezone)}</span>
                <span
                  className={`rounded-lg px-3 py-2 text-sm ${selected ? 'border-2 border-dashed border-action bg-info-soft font-semibold text-action' : look.tone}`}
                >
                  {selected ? 'Selected Time' : (b.label ?? look.label)}
                </span>
              </li>
            );
          })}
        </ol>
      )}
      {d?.conflict ? (
        d.conflict.ok ? (
          <p
            role="status"
            data-testid="no-conflicts"
            className="flex items-start gap-2 rounded-lg bg-success-soft p-3 text-sm text-success"
          >
            <CheckCircle aria-hidden weight="fill" className="mt-0.5 size-5 shrink-0" />
            <span>
              <span className="block font-bold">No Conflicts</span>
              {name} is available at this time.
            </span>
          </p>
        ) : (
          <div
            role="alert"
            data-testid="conflicts"
            className="flex items-start gap-2 rounded-lg bg-danger-soft p-3 text-sm text-danger"
          >
            <WarningCircle aria-hidden weight="fill" className="mt-0.5 size-5 shrink-0" />
            <div>
              <p className="font-bold">Conflict</p>
              <ul>
                {d.conflict.conflicts.map((c) => (
                  <li key={`${c.kind}-${c.startsAt}`}>{c.message}</li>
                ))}
              </ul>
            </div>
          </div>
        )
      ) : null}
    </div>
  );
}
