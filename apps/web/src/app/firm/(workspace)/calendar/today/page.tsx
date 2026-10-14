import { PageHeader } from '@firmivra/ui';
import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Appointments: Today' };

export default function CalendarTodayPage() {
  return <PageHeader title="Appointments" />;
}
