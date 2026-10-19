import type { Metadata } from 'next';
import { Suspense } from 'react';
import { FirmsReport } from '../_components/firms-report';

export const metadata: Metadata = { title: 'Reports: Firms' };

export default function Page() {
  return (
    <Suspense>
      <FirmsReport />
    </Suspense>
  );
}
