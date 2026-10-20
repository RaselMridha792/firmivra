import type { Metadata } from 'next';
import { IntegrationsDashboard } from './_components/integrations-dashboard';

export const metadata: Metadata = { title: 'Integrations' };

export default function AdminIntegrationsPage() {
  return <IntegrationsDashboard />;
}
