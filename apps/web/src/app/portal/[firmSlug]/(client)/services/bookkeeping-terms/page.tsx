import type { Metadata } from 'next';
import { TermsListScreen } from './_components/terms-list-screen';

export const metadata: Metadata = { title: 'Engagement Terms' };

export default function BookkeepingTermsPage() {
  return <TermsListScreen />;
}
