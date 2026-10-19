import type { Metadata } from 'next';
import { AdvisoryOverview } from './_components/overview-screen';

export const metadata: Metadata = { title: 'Business Advisory & Development' };

export default function BusinessAdvisoryPage() {
  return <AdvisoryOverview />;
}
