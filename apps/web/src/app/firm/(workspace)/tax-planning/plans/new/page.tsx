import type { Metadata } from 'next';
import { Suspense } from 'react';
import { PlanEditor } from '../../_components/plan-editor';

export const metadata: Metadata = { title: 'Create Planning Plan' };

export default function Page() {
  return (
    <Suspense fallback={null}>
      <PlanEditor step={1} />
    </Suspense>
  );
}
