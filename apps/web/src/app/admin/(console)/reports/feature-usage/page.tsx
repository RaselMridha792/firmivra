import type { Metadata } from 'next';
import { Suspense } from 'react';
import { FeatureUsageReport } from '../_components/tab-reports';

export const metadata: Metadata = { title: 'Reports: Feature Usage' };

export default function Page() {
  return (
    <Suspense>
      <FeatureUsageReport />
    </Suspense>
  );
}
