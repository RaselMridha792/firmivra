import type { Metadata } from 'next';
import { BusinessPlans } from '../_components/plans-screen';

export const metadata: Metadata = { title: 'Business advisory: Business plans' };

export default function BusinessAdvisoryPlansPage() {
  return <BusinessPlans />;
}
