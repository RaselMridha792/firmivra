import type { Metadata } from 'next';
import { ScheduleForm } from '../_components/schedule-form';
import { isCalendarDate } from '../_components/time';

export const metadata: Metadata = { title: 'Schedule appointment' };

/** `?date=2026-09-20&time=08:00`: the empty hour picked on the calendar. */
export default async function CalendarNewPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string | string[]; time?: string | string[] }>;
}) {
  const { date, time } = await searchParams;
  const at =
    typeof date === 'string' &&
    isCalendarDate(date) &&
    typeof time === 'string' &&
    /^([01]\d|2[0-3]):[0-5]\d$/.test(time)
      ? { date, time }
      : undefined;
  return <ScheduleForm at={at} />;
}
