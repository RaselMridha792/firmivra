import type { Metadata } from 'next';
import { DetailScreen } from './_components/detail-screen';

export const metadata: Metadata = { title: 'Appointment details' };

export default async function CalendarIdPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <DetailScreen id={id} />;
}
