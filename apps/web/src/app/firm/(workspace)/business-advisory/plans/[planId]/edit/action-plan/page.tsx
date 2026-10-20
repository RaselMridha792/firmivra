import type { Metadata } from 'next';
import { Suspense } from 'react';
import { PlanWizard } from '../../../../_components/plan-wizard';

export const metadata: Metadata = { title: 'Edit business plan: Action plan' };

export default async function BusinessAdvisoryPlansPlanIdEditActionPlanPage({
  params,
}: {
  params: Promise<{ planId: string }>;
}) {
  const { planId } = await params;
  return (
    <Suspense fallback={null}>
      <PlanWizard planId={planId} step={4} />
    </Suspense>
  );
}
