import { PageHeader } from '@firmivra/ui';
import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Recurring invoices' };

export default function AdminBillingRecurringPage() {
  return <PageHeader title="Recurring Invoices" />;
}
