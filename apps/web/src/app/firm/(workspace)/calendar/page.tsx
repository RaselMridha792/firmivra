import type { Metadata } from 'next';
import { CalendarScreen } from './_components/calendar-screen';

export const metadata: Metadata = { title: 'Calendar' };

/** `?date=2026-09-21` opens the calendar on that day (the small month on the List and Today views). */
export default async function CalendarPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string | string[]; view?: string | string[] }>;
}) {
  const { date, view } = await searchParams;
  return (
    <CalendarScreen
      date={typeof date === 'string' ? date : undefined}
      view={typeof view === 'string' ? view : undefined}
    />
  );
}
