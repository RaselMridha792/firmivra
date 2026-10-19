import type { Metadata } from 'next';
import { Suspense } from 'react';
import { SavedReports } from './_components/saved-reports';

export const metadata: Metadata = { title: 'Saved reports' };

export default function Page() {
  return (
    <Suspense>
      <SavedReports />
    </Suspense>
  );
}
