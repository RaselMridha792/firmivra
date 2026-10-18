import { PageHeader } from '@firmivra/ui';
import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Billing' };

export default function AdminBillingPage() {
  return <PageHeader title="Billing" />;
}
