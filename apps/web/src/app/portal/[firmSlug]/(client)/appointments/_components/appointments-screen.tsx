'use client';

import { useParams } from 'next/navigation';
import { BookAppointment } from './book-appointment';
import { UpcomingAppointments } from './upcoming-appointments';

/**
 * The client's appointments with their firm, in the firm's branding (the portal theme): book a
 * kind of appointment at a free time, and change or cancel upcoming ones until the cutoff.
 */
export function AppointmentsScreen() {
  const { firmSlug } = useParams<{ firmSlug: string }>();
  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-6">
      <div>
        <h1 data-testid="page-title" className="font-display text-3xl font-bold text-heading">
          Appointments
        </h1>
        <p className="text-sm text-muted">Book a time with us, or change one you have.</p>
      </div>
      <UpcomingAppointments slug={firmSlug} />
      <BookAppointment slug={firmSlug} />
    </div>
  );
}
