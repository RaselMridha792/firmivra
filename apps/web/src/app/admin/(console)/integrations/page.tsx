import { PageHeader } from '@firmivra/ui';
import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Integrations' };

export default function AdminIntegrationsPage() {
  return <PageHeader title="Integrations" />;
}
