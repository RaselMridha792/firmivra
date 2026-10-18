import type { Metadata } from 'next';
import { ReportsDashboard } from './_components/reports-dashboard';

export const metadata: Metadata = { title: 'Reports' };

export default function ReportsPage() {
  return <ReportsDashboard />;
}
