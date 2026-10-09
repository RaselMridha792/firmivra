'use client';

import { Button, Modal } from '@firmivra/ui';
import { Plus } from 'lucide-react';
import { useParams } from 'next/navigation';
import { useState } from 'react';
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

  const ask = (kind: ActionRequest['kind']) => {
    if (upcoming.data && !targetOf(upcoming.data, kind)) {
      setNotice({
        text: 'You have no appointment that can be changed online. Please contact us.',
        failed: true,
      });
      return;
    }
    setNotice(null);
    setRequest({ kind, n: (request?.n ?? 0) + 1 });
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
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-[repeat(4,minmax(0,1fr))_auto]">
        <AppointmentStats upcoming={upcoming.data} past={past.data} />
        <Button
          className="min-h-14 self-center px-6 text-base sm:col-span-2 xl:col-span-1"
          onClick={() => setSchedule({})}
        >
          <Plus aria-hidden className="size-5" />
          Schedule an Appointment
        </Button>
      </div>
      <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-2 xl:grid-cols-[minmax(0,5fr)_minmax(0,6fr)_minmax(0,4fr)]">
        <MonthCalendar
          appointments={[...(upcoming.data ?? []), ...(past.data ?? [])]}
          onPickDay={(date) => setSchedule({ date })}
        />
        <UpcomingAppointments
          slug={slug}
          upcoming={upcoming}
          past={past}
          notice={notice}
          onNotice={setNotice}
          request={request}
          onViewAll={() => setHistory(true)}
        />
        <div className="lg:col-span-2 xl:col-span-1">
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
