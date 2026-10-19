import type { Metadata } from 'next';
import { EstimateEditor } from '../_components/estimate-form';

export const metadata: Metadata = { title: 'Create estimate' };

/** Create Estimate (modern-estimate-creation-dashboard.jpg, docx §11). */
export default function AdminBillingEstimatesNewPage() {
  return <EstimateEditor mode="create" />;
}
