import { PageHeader } from '@firmivra/ui';
import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Staff availability' };

export default function CalendarAvailabilityPage() {
  return <PageHeader title="Staff Availability" />;
}
