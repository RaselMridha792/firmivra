import type { Metadata } from 'next';
import { AdvisoryPlanScreen } from '../../_components/advisory-plan-screen';

export const metadata: Metadata = { title: 'Business Plan' };

export default function MyAdvisoryPlanPage() {
  return <AdvisoryPlanScreen />;
}
