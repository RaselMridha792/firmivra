import type { Metadata } from 'next';
import { TypesScreen } from '../_components/types-screen';

export const metadata: Metadata = { title: 'Appointment types' };

export default function CalendarTypesPage() {
  return <TypesScreen />;
}
