import type { Metadata } from 'next';
import { ActionPlans } from '../_components/action-plans-screen';

export const metadata: Metadata = { title: 'Business advisory: Action plans' };

export default function BusinessAdvisoryActionPlansPage() {
  return <ActionPlans />;
}
