import type { Metadata } from 'next';
import { PlanningOverview } from './_components/overview-screen';

export const metadata: Metadata = { title: 'Tax Planning & Strategy' };

export default function TaxPlanningPage() {
  return <PlanningOverview />;
}
