import type { Metadata } from 'next';
import { AdvisoryReportsView } from '../_components/reports-screen';

export const metadata: Metadata = { title: 'Business advisory: Reports' };

export default function BusinessAdvisoryReportsPage() {
  return <AdvisoryReportsView />;
}
