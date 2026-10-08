'use client';

import type { CalendarAppointment } from '@firmivra/types';
import { timeLabel } from './time';

/**
 * One appointment on the grid. Staff see someone else's appointment only as Busy (no client or
 * type: the API's Staff rule). A cancelled one stays, struck through.
 */
export function AppointmentChip({
  item,
  timeZone,
  showStaff,
}: {
  item: CalendarAppointment;
  timeZone: string;
  showStaff: boolean;
}) {
  const time = timeLabel(item.startsAt, timeZone);
  if (item.restricted) {
    return (
      <li
        data-testid="appointment"
        className="rounded-control bg-subtle px-2 py-1 text-xs text-muted"
      >
        <span className="block font-semibold">{time}</span>
        Busy · {item.staff.name}
      </li>
    );
  }
  const cancelled = item.status === 'CANCELLED';
  return (
    <li
      data-testid="appointment"
      className={`rounded-control border-l-4 px-2 py-1 text-xs ${cancelled ? 'border-border bg-subtle text-muted line-through' : 'border-action bg-info-soft text-text'}`}
    >
      <span className="block font-semibold">{time}</span>
      <span className="block">{item.client.displayName}</span>
      <span className="block text-muted">
        {item.type?.name ?? 'Appointment'}
        {showStaff ? ` · ${item.staff.name}` : ''}
      </span>
    </li>
  );
}
