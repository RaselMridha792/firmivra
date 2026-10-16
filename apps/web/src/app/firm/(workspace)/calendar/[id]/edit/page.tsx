import type { Metadata } from 'next';
import { ScheduleScreen } from '../../_components/schedule-screen';

export const metadata: Metadata = { title: 'Edit appointment' };

type Props = { params: Promise<{ id: string }> };

export default async function CalendarIdEditPage({ params }: Props) {
  const { id } = await params;
  return <ScheduleScreen id={id} />;
}
