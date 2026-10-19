import type { Metadata } from 'next';
import { EstimateEditor } from '../../_components/estimate-form';

export const metadata: Metadata = { title: 'Edit estimate' };

/** Edit Estimate: Create Estimate in edit mode (docx §10.2, §11), same id and history. */
export default async function AdminBillingEstimatesEstimateIdEditPage({
  params,
}: {
  params: Promise<{ estimateId: string }>;
}) {
  const { estimateId } = await params;
  return <EstimateEditor mode="edit" estimateId={estimateId} />;
}
