import { PageHeader } from '@firmivra/ui';
import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Appointment details' };

export default function CalendarIdPage() {
  return <PageHeader title="Appointment Details" />;
}
