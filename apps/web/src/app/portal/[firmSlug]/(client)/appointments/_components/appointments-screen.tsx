'use client';

import { Button, Modal } from '@firmivra/ui';
import { Plus } from 'lucide-react';
import { useParams } from 'next/navigation';
import { useRef, useState } from 'react';
import { api } from '../../../../../../lib/api';
import { useApiQuery } from '../../../../../../lib/query';
import { usePortal } from '../../../layout';
import { AppointmentStats } from './appointment-stats';
import { ScheduleModal } from './book-appointment';
import { MonthCalendar } from './month-calendar';
import { myAppointmentsKey } from './shared';
import { SideCards } from './side-cards';
import {
  type ActionRequest,
  AppointmentHistory,
  type Notice,
  targetOf,
  UpcomingAppointments,
} from './upcoming-appointments';

/**
 * The client's appointments with their firm, in the firm's branding (the portal theme), laid out
 * as Octavia's mockup (Mockup_CC2406D8): counts, the month calendar, upcoming and recent
 * appointments, and Quick Actions. Booking happens in the "Schedule an Appointment" modal;
 * each upcoming row's menu reschedules or cancels it until the cutoff.
 */
export function AppointmentsScreen() {
  const { firmSlug: slug } = useParams<{ firmSlug: string }>();
  const { business } = usePortal();
  const upcoming = useApiQuery([...myAppointmentsKey(slug), 'upcoming'], () =>
    api.myAppointments(slug).list({ when: 'upcoming' }),
  );
  const past = useApiQuery([...myAppointmentsKey(slug), 'past'], () =>
    api.myAppointments(slug).list({ when: 'past' }),
  );
  const [schedule, setSchedule] = useState<{ date?: string } | null>(null);
  const [history, setHistory] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [request, setRequest] = useState<ActionRequest | null>(null);
  // Counts every Quick Actions ask, so a repeat ask on the same row opens it again.
  const asksRef = useRef(0);

  const ask = (kind: ActionRequest['kind']) => {
    // Pin the row once, by id: after a cancel the list changes, and nothing else may open.
    if (!upcoming.data) return;
    const target = targetOf(upcoming.data, kind);
    if (!target) {
      setNotice({
        text: 'You have no appointment that can be changed online. Please contact us.',
        failed: true,
      });
      return;
    }
    setNotice(null);
    asksRef.current += 1;
    setRequest({ kind, id: target.id, n: asksRef.current });
  };

  return (
    <div className="flex w-full flex-col gap-6">
      <div>
        <h1
          data-testid="page-title"
          className="font-display text-4xl font-bold text-heading md:text-5xl"
        >
          Appointments
        </h1>
        <p className="mt-1 text-lg text-text">
          Schedule, view, and manage your appointments with {business.name}.
        </p>
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:flex">
        <AppointmentStats upcoming={upcoming.data} past={past.data} />
        <Button
          className="min-h-14 self-center px-6 text-base sm:col-span-2 xl:shrink-0"
          onClick={() => setSchedule({})}
        >
          <Plus aria-hidden className="size-5" />
          Schedule an Appointment
        </Button>
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 xl:grid-cols-15">
        <div className="xl:col-span-5">
          <MonthCalendar
            appointments={[...(upcoming.data ?? []), ...(past.data ?? [])]}
            onPickDay={(date) => setSchedule({ date })}
          />
        </div>
        <div className="xl:col-span-6">
          <UpcomingAppointments
            slug={slug}
            upcoming={upcoming}
            past={past}
            notice={notice}
            onNotice={setNotice}
            request={request}
            onRequestDone={() => setRequest(null)}
            onViewAll={() => setHistory(true)}
          />
        </div>
        <div className="lg:col-span-2 xl:col-span-4">
          <SideCards
            slug={slug}
            onSchedule={() => setSchedule({})}
            onReschedule={() => ask('reschedule')}
            onCancel={() => ask('cancel')}
            onHistory={() => setHistory(true)}
          />
        </div>
      </div>
      <ScheduleModal
        slug={slug}
        open={schedule !== null}
        date={schedule?.date}
        onClose={() => setSchedule(null)}
        onBooked={(text) => {
          setSchedule(null);
          setNotice({ text, failed: false });
        }}
      />
      <Modal open={history} title="Appointment History" onClose={() => setHistory(false)}>
        {history ? <AppointmentHistory past={past} /> : null}
      </Modal>
    </div>
  );
}
