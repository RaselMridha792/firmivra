import type { Metadata } from 'next';
import { ListScreen } from './_components/list-screen';

export const metadata: Metadata = { title: 'Appointments: List' };

export default function CalendarListPage() {
  return <ListScreen />;
}
