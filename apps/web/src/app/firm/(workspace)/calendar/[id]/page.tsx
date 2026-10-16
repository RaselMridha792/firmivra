import type { Metadata } from 'next';
import { DetailScreen } from '../_components/detail-screen';

export const metadata: Metadata = { title: 'Appointment details' };

type Props = { params: Promise<{ id: string }> };

export default async function CalendarIdPage({ params }: Props) {
  const { id } = await params;
  return <DetailScreen id={id} />;
}
