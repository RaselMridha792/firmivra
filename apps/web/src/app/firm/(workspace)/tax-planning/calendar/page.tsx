import type { Metadata } from 'next';
import { PlanningCalendar } from '../_components/tp-lists';

export const metadata: Metadata = { title: 'Tax Calendar' };

export default function Page() {
  return <PlanningCalendar />;
}
