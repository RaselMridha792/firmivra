import type { Metadata } from 'next';
import { Suspense } from 'react';
import { DeadlineFormScreen } from '../_components/deadline-form';

export const metadata: Metadata = { title: 'New deadline' };

export default function NewDeadlinePage() {
  // Cancel reads where it was opened from (CD-F05).
  return (
    <Suspense fallback={null}>
      <DeadlineFormScreen />
    </Suspense>
  );
}
