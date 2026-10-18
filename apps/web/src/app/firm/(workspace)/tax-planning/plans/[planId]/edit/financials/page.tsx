import type { Metadata } from 'next';
import { Suspense } from 'react';
import { PlanEditor } from '../../../../_components/plan-editor';

export const metadata: Metadata = { title: 'Planning Plan' };

export default async function Page({ params }: { params: Promise<{ planId: string }> }) {
  const { planId } = await params;
  return (
    <Suspense fallback={null}>
      <PlanEditor id={planId} step={2} />
    </Suspense>
  );
}
