import type { Metadata } from 'next';
import { TaxPlansScreen } from './_components/tax-plans-screen';

export const metadata: Metadata = { title: 'Tax Plans' };

export default function TaxPlansPage() {
  return <TaxPlansScreen />;
}
