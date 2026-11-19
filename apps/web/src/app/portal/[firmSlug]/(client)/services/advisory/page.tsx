import type { Metadata } from 'next';
import { AdvisoryScreen } from './_components/advisory-screen';

export const metadata: Metadata = { title: 'Business Advisory' };

export default function MyAdvisoryPage() {
  return <AdvisoryScreen />;
}
