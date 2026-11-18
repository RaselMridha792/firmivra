import type { Metadata } from 'next';
import { TaxPlanScreen } from '../_components/tax-plan-screen';

export const metadata: Metadata = { title: 'Tax Plan' };

export default function TaxPlanPage() {
  return <TaxPlanScreen />;
}
