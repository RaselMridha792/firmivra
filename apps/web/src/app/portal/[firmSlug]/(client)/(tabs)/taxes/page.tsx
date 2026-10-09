import type { Metadata } from 'next';
import { TaxesScreen } from './_components/taxes-screen';

export const metadata: Metadata = { title: 'Tax Returns' };

export default function TaxReturnsPage() {
  return <TaxesScreen />;
}
