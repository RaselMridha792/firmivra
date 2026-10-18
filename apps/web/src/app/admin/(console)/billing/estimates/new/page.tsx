import { PageHeader } from '@firmivra/ui';
import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Create estimate' };

export default function AdminBillingEstimatesNewPage() {
  return <PageHeader title="Create Estimate" />;
}
