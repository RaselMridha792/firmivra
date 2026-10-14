import { PageHeader } from '@firmivra/ui';
import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Appointments: List' };

export default function CalendarListPage() {
  return <PageHeader title="Appointments" />;
}
