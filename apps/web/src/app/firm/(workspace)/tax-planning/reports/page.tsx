import type { Metadata } from 'next';
import { PlanningReports } from '../_components/tp-lists';

export const metadata: Metadata = { title: 'Tax Planning Reports' };

export default function Page() {
  return <PlanningReports />;
}
