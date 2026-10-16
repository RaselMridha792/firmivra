import type { Metadata } from 'next';
import { ScheduleForm } from '../_components/schedule-form';

export const metadata: Metadata = { title: 'Schedule appointment' };

export default function CalendarNewPage() {
  return <ScheduleForm />;
}
