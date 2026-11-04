import type { Metadata } from 'next';
import { Suspense } from 'react';
import { ReportBuilder } from '../_components/report-builder';

export const metadata: Metadata = { title: 'Custom Report Builder' };

export default function ReportBuilderPage() {
  // The builder's work is in the address, for Back from Run Report (RP-F14).
  return (
    <Suspense fallback={null}>
      <ReportBuilder />
    </Suspense>
  );
}
