import { PageHeader } from '@firmivra/ui';
import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Customer integration catalog' };

export default function AdminIntegrationsCatalogPage() {
  return <PageHeader title="Customer Integration Catalog" />;
}
