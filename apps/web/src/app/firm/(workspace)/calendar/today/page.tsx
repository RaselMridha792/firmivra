import type { Metadata } from 'next';
import { TodayScreen } from '../_components/today-screen';

export const metadata: Metadata = { title: 'Appointments: Today' };

export default function CalendarTodayPage() {
  return <TodayScreen />;
}
