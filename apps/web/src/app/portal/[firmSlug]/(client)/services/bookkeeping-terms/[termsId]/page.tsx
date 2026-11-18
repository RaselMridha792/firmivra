import type { Metadata } from 'next';
import { TermsScreen } from '../_components/terms-screen';

export const metadata: Metadata = { title: 'Engagement Terms' };

export default function BookkeepingTermsVersionPage() {
  return <TermsScreen />;
}
