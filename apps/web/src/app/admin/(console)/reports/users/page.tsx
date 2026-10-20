import type { Metadata } from 'next';
import { Suspense } from 'react';
import { UsersReport } from '../_components/tab-reports';

export const metadata: Metadata = { title: 'Reports: Users' };

export default function Page() {
  return (
    <Suspense>
      <UsersReport />
    </Suspense>
  );
}
