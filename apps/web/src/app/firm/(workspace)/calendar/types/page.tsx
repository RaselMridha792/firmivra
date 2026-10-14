import { PageHeader } from '@firmivra/ui';
import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Appointment types' };

export default function CalendarTypesPage() {
  return <PageHeader title="Appointment Types" />;
}
