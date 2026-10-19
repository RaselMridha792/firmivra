import type { Metadata } from 'next';
import { Suspense } from 'react';
import { SupportReport } from '../_components/tab-reports';

export const metadata: Metadata = { title: 'Reports: Support' };

export default function Page() {
  return (
    <Suspense>
      <SupportReport />
    </Suspense>
  );
}
