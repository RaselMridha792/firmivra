import type { Metadata } from 'next';
import { AvailabilityScreen } from './_components/availability-screen';

export const metadata: Metadata = { title: 'Staff availability' };

export default function CalendarAvailabilityPage() {
  return <AvailabilityScreen />;
}
