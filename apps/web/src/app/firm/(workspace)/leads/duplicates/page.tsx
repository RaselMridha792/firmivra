import type { Metadata } from 'next';
import { DuplicatesScreen } from './_components/duplicates-screen';

export const metadata: Metadata = { title: 'Review Duplicates' };

export default function LeadDuplicatesPage() {
  return <DuplicatesScreen />;
}
