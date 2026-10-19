import type { Metadata } from 'next';
import { EstimatesDashboard } from './_components/estimates-dashboard';

export const metadata: Metadata = { title: 'Estimates' };

/**
 * Estimates (firmivra-estimates-dashboard.jpg, docx §10); the details are a panel on this page.
 * `?estimate=` opens the details on an estimate and `?saved=` names the save just made.
 */
export default async function AdminBillingEstimatesPage({
  searchParams,
}: {
  searchParams: Promise<{ estimate?: string | string[]; saved?: string | string[] }>;
}) {
  const { estimate, saved } = await searchParams;
  return (
    <EstimatesDashboard
      estimateId={typeof estimate === 'string' ? estimate : null}
      saved={typeof saved === 'string' ? saved : null}
    />
  );
}
