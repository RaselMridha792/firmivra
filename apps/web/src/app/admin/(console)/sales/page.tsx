import { PageHeader } from '@firmivra/ui';
import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Sales' };

export default function AdminSalesPage() {
  return <PageHeader title="Sales" />;
}
