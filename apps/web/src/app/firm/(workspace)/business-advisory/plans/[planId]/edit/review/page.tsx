import type { Metadata } from 'next';
import { Suspense } from 'react';
import { PlanWizard } from '../../../../_components/plan-wizard';

export const metadata: Metadata = { title: 'Edit business plan: Review & save' };

export default async function BusinessAdvisoryPlansPlanIdEditReviewPage({
  params,
}: {
  params: Promise<{ planId: string }>;
}) {
  const { planId } = await params;
  return (
    <Suspense fallback={null}>
      <PlanWizard planId={planId} step={5} />
    </Suspense>
  );
}
