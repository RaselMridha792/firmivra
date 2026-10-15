import type { Metadata } from 'next';
import { TaxReturnScreen } from '../_components/tax-return-screen';

export const metadata: Metadata = { title: 'Tax Return Estimator' };

export default function TaxReturnPage() {
  return <TaxReturnScreen />;
}
