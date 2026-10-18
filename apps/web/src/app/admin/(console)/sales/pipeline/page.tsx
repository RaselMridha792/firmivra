import { PageHeader } from '@firmivra/ui';
import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Sales pipeline' };

export default function AdminSalesPipelinePage() {
  return <PageHeader title="Sales Pipeline" />;
}
