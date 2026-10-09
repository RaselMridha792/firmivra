'use client';

import { Card } from '@firmivra/ui';
import {
  CalendarClock,
  CalendarPlus,
  ChevronRight,
  CircleX,
  Clock,
  Headset,
  Lightbulb,
  type LucideIcon,
  MessageCircleMore,
} from 'lucide-react';
import Link from 'next/link';

/** The right-hand column: Quick Actions, Need Help? and Be Prepared. */
export function SideCards({
  slug,
  onSchedule,
  onReschedule,
  onCancel,
  onHistory,
}: {
  slug: string;
  onSchedule: () => void;
  onReschedule: () => void;
  onCancel: () => void;
  onHistory: () => void;
}) {
  const actions: [string, LucideIcon, () => void][] = [
    ['Schedule an Appointment', CalendarPlus, onSchedule],
    ['Reschedule an Appointment', CalendarClock, onReschedule],
    ['Cancel an Appointment', CircleX, onCancel],
    ['View Appointment History', Clock, onHistory],
  ];
  return (
    <div className="flex flex-col gap-4">
      <Card variant="elevated" className="py-4">
        <h2 className="mb-1 font-display text-xl font-bold 2xl:text-2xl text-heading">
          Quick Actions
        </h2>
        <ul className="flex flex-col divide-y divide-border">
          {actions.map(([label, Icon, onClick]) => (
            <li key={label}>
              <button
                type="button"
                onClick={onClick}
                className="flex w-full items-center gap-3 py-3 text-left text-sm text-text hover:text-link"
              >
                <Icon aria-hidden className="size-5 shrink-0 text-link" />
                {label}
                <ChevronRight aria-hidden className="ml-auto size-4 shrink-0 text-heading" />
              </button>
            </li>
          ))}
        </ul>
      </Card>
      <section className="rounded-card bg-info-soft p-5 shadow-md">
        <div className="mb-4 flex items-center gap-3">
          <span className="flex size-12 shrink-0 items-center justify-center rounded-pill bg-surface text-link">
            <Headset aria-hidden className="size-6" />
          </span>
          <div>
            <h2 className="font-display text-xl font-bold text-heading">Need Help?</h2>
            <p className="text-sm text-text">Our team is here for you.</p>
          </div>
        </div>
        <Link
          href={`/${slug}/messages`}
          className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-control border border-action bg-surface px-4 py-2 text-sm font-medium text-action hover:bg-accent-soft"
        >
          <MessageCircleMore aria-hidden className="size-5" />
          Send a Message
        </Link>
      </section>
      <section className="flex gap-3 rounded-card bg-warning-soft p-5 shadow-md">
        <Lightbulb aria-hidden className="size-6 shrink-0 text-warning" />
        <div>
          <h2 className="font-display text-xl font-bold text-heading">Be Prepared</h2>
          <p className="text-sm text-text">
            Have your documents ready for your appointment to make the most of your time.
          </p>
        </div>
      </section>
    </div>
  );
}
