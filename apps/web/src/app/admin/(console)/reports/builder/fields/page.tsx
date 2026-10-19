import type { Metadata } from 'next';
import { Suspense } from 'react';
import { ReportBuilder } from '../_components/report-builder';

export const metadata: Metadata = { title: 'Custom report builder: Data fields' };

export default function Page() {
  return (
    <Suspense>
      <ReportBuilder step={2} />
    </Suspense>
  );
}
