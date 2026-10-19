import type { Metadata } from 'next';
import { Suspense } from 'react';
import { PlanWizard } from '../../_components/plan-wizard';

export const metadata: Metadata = { title: 'Create business plan: Business profile' };

export default function BusinessAdvisoryPlansNewPage() {
  return (
    <Suspense fallback={null}>
      <PlanWizard step={1} />
    </Suspense>
  );
}
