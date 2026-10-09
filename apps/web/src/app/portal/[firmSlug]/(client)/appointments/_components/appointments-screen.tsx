'use client';

import { useParams } from 'next/navigation';
import { BookAppointment } from './book-appointment';

/**
 * The client's appointments with their firm, in the firm's branding (the portal theme): book a
 * kind of appointment at a free time.
 */
export function AppointmentsScreen() {
  const { firmSlug } = useParams<{ firmSlug: string }>();
  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-6">
      <div>
        <h1 data-testid="page-title" className="font-display text-3xl font-bold text-heading">
          Appointments
        </h1>
        <p className="text-sm text-muted">Book a time with us.</p>
      </div>
      <BookAppointment slug={firmSlug} />
    </div>
  );
}
