import type { Metadata } from 'next';
import { AvailabilityScreen } from './_components/availability-screen';

export const metadata: Metadata = { title: 'Availability' };

export default function AvailabilityPage() {
  return <AvailabilityScreen />;
}
