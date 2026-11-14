import type { Metadata } from 'next';
import { Suspense } from 'react';
import { LeadsReport } from './_components/leads-report';

export const metadata: Metadata = { title: 'Leads Funnel & Aging' };

export default function LeadsReportPage() {
  // The report keeps its dates and filters in the address, so a link from Leads opens it as set.
  return (
    <Suspense fallback={null}>
      <LeadsReport />
    </Suspense>
  );
}
