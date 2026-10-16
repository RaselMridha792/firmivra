import { PageHeader } from '@firmivra/ui';
import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Add new service' };

export default function ServicesPricingNewPage() {
  return <PageHeader title="Add New Service" />;
}
