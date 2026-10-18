import { PageHeader } from '@firmivra/ui';
import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Payments' };

export default function AdminBillingPaymentsPage() {
  return <PageHeader title="Payments" />;
}
