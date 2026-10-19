import type { Metadata } from 'next';
import { Suspense } from 'react';
import { RevenueReport } from '../_components/tab-reports';

export const metadata: Metadata = { title: 'Reports: Revenue' };

export default function Page() {
  return (
    <Suspense>
      <RevenueReport />
    </Suspense>
  );
}
