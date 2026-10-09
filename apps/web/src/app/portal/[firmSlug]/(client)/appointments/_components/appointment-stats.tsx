'use client';

import type { MyAppointment } from '@firmivra/types';
import { useState } from 'react';
import { CalendarDays, Check, Clock, type LucideIcon, X } from 'lucide-react';

/** The card's tint, and the icon circle's: tinted for the first two, solid for the last two. */
const tones = {
  info: ['bg-info-soft text-info', 'bg-surface'],
  warning: ['bg-warning-soft text-warning', 'bg-surface'],
  success: ['bg-success-soft', 'bg-success text-on-action'],
  danger: ['bg-danger-soft', 'bg-danger text-on-action'],
} as const;

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
      Check,
      'success',
    ],
    [count(past, (a) => a.status === 'CANCELLED'), 'Cancelled', X, 'danger'],
  ];
  return (
    <>
      {stats.map(([value, label, Icon, tone]) => (
        <div
          key={label}
          data-testid="appointment-stat"
          className={`flex items-center gap-4 rounded-card p-4 shadow-sm xl:min-w-0 xl:flex-1 ${tones[tone][0]}`}
        >
          <span
            className={`flex size-12 shrink-0 items-center justify-center rounded-pill ${tones[tone][1]}`}
          >
            <Icon aria-hidden className="size-6" />
          </span>
          <span className="flex flex-col">
            <span className="font-display text-3xl leading-none font-bold text-heading">
              {value}
            </span>
            <span className="mt-1 max-w-28 text-sm text-text">{label}</span>
          </span>
        </div>
      ))}
    </>
  );
}
