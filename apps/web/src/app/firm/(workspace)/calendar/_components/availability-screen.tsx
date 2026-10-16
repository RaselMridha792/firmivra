'use client';

import { ArrowLeft } from '@phosphor-icons/react';
import Link from 'next/link';
import { useState } from 'react';
import { api } from '../../../../../lib/api';
import { useApiQuery } from '../../../../../lib/query';
import { useOptions } from './ap-data';
import { todayIn } from './time';
import { DayPanel } from './availability-panel';
import { RulesEditor } from './availability-editor';
import { Segmented } from './form-parts';

/**
 * /calendar/availability: the Staff Availability panel on its own (one member's day, conflicts
 * shown for a proposed time) beside Edit My Availability. Owner and Admin may pick anyone.
 */
export function AvailabilityScreen() {
  const { options, timeZone } = useOptions();
  const me = useApiQuery(['me'], () => api.me());
  const staff = options?.staff ?? [];
  const mine = staff.find((s) => s.userId === me.data?.user.id)?.userId;
  const [picked, setPicked] = useState('');
  const staffId = picked || mine || staff[0]?.userId || '';
  const [date, setDate] = useState(() => todayIn(timeZone));
  const [which, setWhich] = useState<'hours' | 'day'>('hours');
  return (
    <div className="flex flex-col gap-5" data-testid="staff-availability">
      <header className="flex flex-col gap-2">
        <Link
          href="/calendar"
          className="flex w-fit items-center gap-2 text-sm font-medium text-link"
        >
          <ArrowLeft aria-hidden weight="bold" className="size-4" /> Back to Appointments
        </Link>
        <h1 className="font-display text-3xl font-bold text-heading">Staff Availability</h1>
        <p className="text-base text-muted">
          See when each person is free, and set the hours and time off clients can book.
        </p>
      </header>
      <div className="lg:hidden">
        <Segmented
          label="Section"
          value={which}
          onChange={setWhich}
          options={[
            { value: 'hours', label: 'Edit Availability' },
            { value: 'day', label: 'Day View' },
          ]}
        />
      </div>
      <div className="grid items-start gap-4 lg:grid-cols-[22rem_minmax(0,1fr)]">
        <section
          aria-label="Staff availability"
          className={`rounded-xl bg-surface p-4 shadow-md ${which === 'day' ? '' : 'hidden lg:block'}`}
          data-testid="availability-panel"
        >
          <h2 className="mb-3 text-lg font-bold text-heading">Staff Availability</h2>
          <DayPanel
            options={options}
            staffId={staffId}
            onStaff={setPicked}
            date={date}
            onDate={setDate}
            dateEditable
            range={null}
            timeZone={timeZone}
            onPick={() => undefined}
          />
        </section>
        <section
          aria-label="Edit availability"
          className={`rounded-xl bg-surface p-4 shadow-md ${which === 'hours' ? '' : 'hidden lg:block'}`}
        >
          <h2 className="mb-3 text-lg font-bold text-heading">
            {staffId && staffId === mine ? 'Edit My Availability' : 'Manage Staff Availability'}
          </h2>
          <RulesEditor userId={staffId} />
        </section>
      </div>
    </div>
  );
}
