import type { Metadata } from 'next';
import { Suspense } from 'react';
import { ReportsDashboard } from './_components/reports-dashboard';

export const metadata: Metadata = { title: 'Reports' };

export default function ReportsPage() {
  // The overview keeps its range and comparison in the address (RP-F01).
  return (
    <Suspense fallback={null}>
      <ReportsDashboard />
    </Suspense>
  );
}
