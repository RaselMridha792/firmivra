import type { Metadata } from 'next';
import { ReportsScreen } from '../_components/reports-screen';

export const metadata: Metadata = { title: 'Bookkeeping Reports' };

export default function BookkeepingReportsPage() {
  return <ReportsScreen />;
}
