import { PageHeader } from '@firmivra/ui';
import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Integration logs' };

export default function AdminIntegrationsLogsPage() {
  return <PageHeader title="Integration Logs" />;
}
