import { PageHeader } from '@firmivra/ui';
import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Create invoice' };

export default function AdminBillingInvoicesNewPage() {
  return <PageHeader title="Create Invoice" />;
}
