import { PageHeader } from '@firmivra/ui';
import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Schedule appointment' };

export default function CalendarNewPage() {
  return <PageHeader title="Schedule Appointment" />;
}
