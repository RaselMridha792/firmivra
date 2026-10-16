import type { Metadata } from 'next';
import { ScheduleScreen } from '../_components/schedule-screen';

export const metadata: Metadata = { title: 'Schedule appointment' };

type Props = { searchParams: Promise<{ date?: string; time?: string; draft?: string }> };

export default async function CalendarNewPage({ searchParams }: Props) {
  const { date, time, draft } = await searchParams;
  return <ScheduleScreen prefill={{ date, time, draft }} />;
}
