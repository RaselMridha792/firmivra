'use client';

import type { MemberAvailability } from '@firmivra/types';
import { Button, Select } from '@firmivra/ui';
import { ChevronLeft, ChevronRight } from 'lucide-react';

export type CalendarView = 'day' | 'week';

/** Moves through the calendar, switches Day and Week, and picks whose appointments to show. */
export function CalendarToolbar({
  view,
  label,
  staff,
  members,
  onView,
  onMove,
  onToday,
  onStaff,
  onNew,
}: {
  view: CalendarView;
  label: string;
  staff: string;
  members: MemberAvailability[];
  onView: (view: CalendarView) => void;
  onMove: (step: -1 | 1) => void;
  onToday: () => void;
  onStaff: (userId: string) => void;
  onNew: () => void;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3 rounded-card border border-border bg-surface p-4">
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="secondary" onClick={() => onMove(-1)} aria-label={`Previous ${view}`}>
          <ChevronLeft aria-hidden className="size-4" />
        </Button>
        <Button variant="secondary" onClick={onToday}>
          Today
        </Button>
        <Button variant="secondary" onClick={() => onMove(1)} aria-label={`Next ${view}`}>
          <ChevronRight aria-hidden className="size-4" />
        </Button>
        <p data-testid="calendar-range" className="font-semibold text-text">
          {label}
        </p>
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <div role="group" aria-label="View" className="flex gap-1">
          {(['day', 'week'] as const).map((option) => (
            <Button
              key={option}
              variant={view === option ? 'primary' : 'secondary'}
              aria-pressed={view === option}
              onClick={() => onView(option)}
            >
              {option === 'day' ? 'Day' : 'Week'}
            </Button>
          ))}
        </div>
        <Select
          label="Staff"
          value={staff}
          onChange={(event) => onStaff(event.target.value)}
          options={[
            { value: '', label: 'Everyone' },
            ...members.map(({ member }) => ({ value: member.userId, label: member.name })),
          ]}
        />
        <Button onClick={onNew}>New appointment</Button>
      </div>
    </div>
  );
}
