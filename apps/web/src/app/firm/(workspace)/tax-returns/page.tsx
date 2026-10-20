import type { Metadata } from 'next';
import { ReturnsScreen } from './_components/returns-screen';

export const metadata: Metadata = { title: 'Tax Returns' };

export default function TaxReturnsPage() {
  return <ReturnsScreen />;
}
