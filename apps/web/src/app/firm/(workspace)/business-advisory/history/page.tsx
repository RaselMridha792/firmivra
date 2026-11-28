import type { Metadata } from 'next';
import { AdvisoryHistory } from '../_components/history-screen';

export const metadata: Metadata = { title: 'Business advisory: View History' };

export default function BusinessAdvisoryHistoryPage() {
  return <AdvisoryHistory />;
}
