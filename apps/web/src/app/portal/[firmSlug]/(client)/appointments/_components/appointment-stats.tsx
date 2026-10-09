'use client';

import type { MyAppointment } from '@firmivra/types';
import { useState } from 'react';
import { CalendarDays, CircleCheck, CircleX, Clock, type LucideIcon } from 'lucide-react';

const tones = {
  info: 'bg-info-soft text-info',
  warning: 'bg-warning-soft text-warning',
  success: 'bg-success-soft text-success',
  danger: 'bg-danger-soft text-danger',
};

/**
 * The four counts above the calendar. The API has no appointment requests yet (a booking is
 * scheduled at once), so "Request Pending" is 0 until it does.
 */
export function AppointmentStats({
  upcoming,
  past,
}: {
  upcoming: MyAppointment[] | undefined;
  past: MyAppointment[] | undefined;
}) {
  const [year] = useState(() => new Date().getFullYear());
  const count = (list: MyAppointment[] | undefined, keep: (a: MyAppointment) => boolean) =>
    list ? String(list.filter(keep).length) : '–';
  const stats: [string, string, LucideIcon, keyof typeof tones][] = [
    [upcoming ? String(upcoming.length) : '–', 'Upcoming Appointments', CalendarDays, 'info'],
    [upcoming ? '0' : '–', 'Appointment Request Pending', Clock, 'warning'],
    [
      count(past, (a) => a.status === 'COMPLETED' && new Date(a.startsAt).getFullYear() === year),
      'Completed This Year',
      CircleCheck,
      'success',
    ],
    [count(past, (a) => a.status === 'CANCELLED'), 'Cancelled', CircleX, 'danger'],
  ];
  return (
    <>
      {stats.map(([value, label, Icon, tone]) => (
        <div
          key={label}
          data-testid="appointment-stat"
          className={`flex items-center gap-4 rounded-card p-4 shadow-sm ${tones[tone]}`}
        >
          <span className="flex size-12 shrink-0 items-center justify-center rounded-pill bg-surface">
            <Icon aria-hidden className="size-6" />
          </span>
          <span className="flex flex-col">
            <span className="font-display text-3xl leading-none font-bold text-heading">
              {value}
            </span>
            <span className="mt-1 text-sm text-text">{label}</span>
          </span>
        </div>
      ))}
    </>
  );
}
