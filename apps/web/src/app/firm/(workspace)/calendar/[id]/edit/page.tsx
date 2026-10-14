import { PageHeader } from '@firmivra/ui';
import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Edit appointment' };

export default function CalendarIdEditPage() {
  return <PageHeader title="Schedule Appointment" />;
}
