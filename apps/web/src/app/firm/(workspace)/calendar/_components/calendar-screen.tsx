'use client';

import type { Availability } from '@firmivra/types';
import { Modal } from '@firmivra/ui';
import Link from 'next/link';
import { useState } from 'react';
import { PageState } from '../../../../../components/page-state';
import { api } from '../../../../../lib/api';
import { useApiQuery } from '../../../../../lib/query';
import { AppointmentDetail } from './appointment-detail';
import { DayGrid, WeekGrid } from './calendar-grid';
import { CalendarToolbar, type CalendarView } from './calendar-toolbar';
import { APPOINTMENTS, AVAILABILITY } from './shared';
import { addDays, dayLabel, todayIn, toInstant, weekStart } from './time';

/**
 * /calendar: the firm's appointments by week or day, in the firm's time zone. Everyone at the
 * firm sees it; Staff see other people's appointments as Busy (the API decides).
 */
export function CalendarScreen() {
  // Availability gives the firm's time zone and the staff list, and every role may read it.
  const availability = useApiQuery(AVAILABILITY, () => api.availability.get());
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 data-testid="page-title" className="text-2xl font-semibold text-text">
            Calendar
          </h1>
          <p className="text-sm text-muted">Appointments, in your firm&apos;s time zone.</p>
        </div>
        <Link href="/settings/availability" className="text-sm font-medium text-link">
          Working hours and blocked time
        </Link>
      </div>
      <PageState query={availability}>{(data) => <Calendar availability={data} />}</PageState>
    </div>
  );
}

function Calendar({ availability }: { availability: Availability }) {
  const timeZone = availability.timezone;
  const [view, setView] = useState<CalendarView>('week');
  const [today] = useState(() => todayIn(timeZone));
  const [anchor, setAnchor] = useState(today);
  const [staff, setStaff] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);
  const from = view === 'week' ? weekStart(anchor) : anchor;
  const days = view === 'week' ? 7 : 1;
  const appointments = useApiQuery([...APPOINTMENTS, from, days, staff], () =>
    api.appointments.list({
      from: toInstant(from, '00:00', timeZone),
      to: toInstant(addDays(from, days), '00:00', timeZone),
      ...(staff ? { staffUserId: staff } : {}),
    }),
  );
  const label =
    view === 'week' ? `${dayLabel(from)} – ${dayLabel(addDays(from, 6))}` : dayLabel(anchor);
  const grid = { timeZone, showStaff: staff === '', onOpen: setOpenId };

  return (
    <>
      <CalendarToolbar
        view={view}
        label={label}
        staff={staff}
        members={availability.members}
        onView={setView}
        onMove={(step) => setAnchor(addDays(anchor, step * days))}
        onToday={() => setAnchor(today)}
        onStaff={setStaff}
      />
      <PageState query={appointments}>
        {(items) =>
          view === 'week' ? (
            <WeekGrid
              {...grid}
              items={items}
              from={from}
              today={today}
              onOpenDay={(date) => {
                setAnchor(date);
                setView('day');
              }}
            />
          ) : (
            <DayGrid {...grid} items={items} />
          )
        }
      </PageState>
      <Modal open={openId !== null} title="Appointment" onClose={() => setOpenId(null)}>
        {openId ? (
          <AppointmentDetail id={openId} timeZone={timeZone} members={availability.members} />
        ) : null}
      </Modal>
    </>
  );
}
