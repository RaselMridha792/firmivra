import type { Metadata } from 'next';
import { Suspense } from 'react';
import { PlanWizard } from '../../../_components/plan-wizard';

export const metadata: Metadata = { title: 'Edit business plan: Business profile' };

export default async function BusinessAdvisoryPlansPlanIdEditPage({
  params,
}: {
  params: Promise<{ planId: string }>;
}) {
  const { planId } = await params;
  return (
    <Suspense fallback={null}>
      <PlanWizard planId={planId} step={1} />
    </Suspense>
  );
}
