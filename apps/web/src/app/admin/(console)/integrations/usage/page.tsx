import { PageHeader } from '@firmivra/ui';
import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Integration usage & analytics' };

export default function AdminIntegrationsUsagePage() {
  return <PageHeader title="Usage & Analytics" />;
}
