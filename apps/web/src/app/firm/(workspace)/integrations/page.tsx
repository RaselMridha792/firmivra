import type { Metadata } from 'next';
import { IntegrationsScreen } from './_components/integrations-screen';

export const metadata: Metadata = { title: 'Integrations' };

export default function IntegrationsPage() {
  return <IntegrationsScreen />;
}
