import type { Metadata } from 'next';
import { openedFromDashboard } from '../../../../../lib/from-dashboard';
import { TodayScreen } from './_components/today-screen';

export const metadata: Metadata = { title: 'Appointments: Today' };

/** `?back=dashboard`: opened from the dashboard's Appointments Today (Octavia's K2 and K7). */
export default async function CalendarTodayPage({
  searchParams,
}: {
  searchParams: Promise<{ back?: string | string[] }>;
}) {
  const { back } = await searchParams;
  return <TodayScreen fromDashboard={openedFromDashboard(back)} />;
}
