'use client';

import type { AvailabilityBlock, MemberRef } from '@firmivra/types';
import { Input, Select, Skeleton } from '@firmivra/ui';
import { CheckCircle, WarningCircle } from '@phosphor-icons/react';
import Link from 'next/link';
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

interface Row {
  startsAt: string;
  label: string;
  tone: string;
  selected: boolean;
}

/** Kinds that only colour the day; the selected time is cut out of them. */
const BACKGROUND = new Set<AvailabilityBlock['kind']>(['AVAILABLE', 'OUTSIDE_HOURS']);

/**
 * The day's rows with the proposed time as its own row at its own start. Working and
 * non-working hours are split around it; appointments, buffers, blocks and time off stay, so a
 * conflict is still visible next to the selection.
 */
export function dayRows(blocks: AvailabilityBlock[], from?: string, to?: string): Row[] {
  const row = (b: AvailabilityBlock, startsAt = b.startsAt): Row => ({
    startsAt,
    label: b.label ?? KIND_LOOKS[b.kind].label,
    tone: KIND_LOOKS[b.kind].tone,
    selected: false,
  });
  const start = from ? Date.parse(from) : NaN;
  const end = to ? Date.parse(to) : NaN;
  if (!(end > start)) return blocks.map((b) => row(b));
  const rows: Row[] = [];
  for (const b of blocks) {
    const s = Date.parse(b.startsAt);
    const e = Date.parse(b.endsAt);
    if (!BACKGROUND.has(b.kind) || e <= start || s >= end) {
      rows.push(row(b));
      continue;
    }
    if (s < start) rows.push(row(b));
    if (e > end) rows.push(row(b, new Date(end).toISOString()));
  }
  rows.push({
    startsAt: new Date(start).toISOString(),
    label: 'Selected Time',
    tone: '',
    selected: true,
  });
  return rows.sort(
    (a, b) =>
      Date.parse(a.startsAt) - Date.parse(b.startsAt) || Number(a.selected) - Number(b.selected),
  );
}

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
  // No working range on the day: every time is outside hours until hours are set.
  const noHours = Boolean(d?.blocks.length) && d?.blocks.every((b) => b.kind === 'OUTSIDE_HOURS');
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
        <>
          <ol className="flex flex-col gap-1.5">
            {dayRows(d.blocks, startsAt, endsAt).map((r) => (
              <li
                key={`${r.startsAt}-${r.label}`}
                className="grid grid-cols-[4.5rem_1fr] items-center gap-2"
              >
                <span className="text-xs text-muted">{hour(r.startsAt, d.timezone)}</span>
                <span
                  data-testid={r.selected ? 'selected-time' : undefined}
                  className={`rounded-lg px-3 py-2 text-sm ${r.selected ? 'border-2 border-dashed border-action bg-info-soft font-semibold text-action' : r.tone}`}
                >
                  {r.label}
                </span>
              </li>
            ))}
          </ol>
          <p className="text-xs text-muted">Times are in {d.timezone}.</p>
          {noHours ? (
            <p data-testid="no-hours" className="rounded-lg bg-subtle p-3 text-sm text-text">
              {name} has no working hours on{' '}
              {new Date(`${d.date}T12:00:00Z`).toLocaleDateString('en-US', {
                weekday: 'long',
                month: 'long',
                day: 'numeric',
                timeZone: 'UTC',
              })}
              , so any time that day is outside availability.{' '}
              <Link
                href="/calendar/availability"
                className="font-semibold text-link hover:underline"
              >
                Set working hours
              </Link>
            </p>
          ) : null}
        </>
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
