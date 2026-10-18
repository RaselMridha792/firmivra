import type { Metadata } from 'next';
import { Suspense } from 'react';
import { ReportsLibrary } from '../_components/reports-library';

export const metadata: Metadata = { title: 'Report Library' };

export default function ReportsLibraryPage() {
  return (
    <Suspense fallback={null}>
      <ReportsLibrary />
    </Suspense>
  );
}
