import type { Metadata } from 'next';
import { Suspense } from 'react';
import { ReportsOverview } from './_components/overview';

export const metadata: Metadata = { title: 'Reports & Analytics' };

export default function Page() {
  return (
    <Suspense>
      <ReportsOverview />
    </Suspense>
  );
}
