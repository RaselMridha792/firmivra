import type { Metadata } from 'next';
import { ClientTasksTab } from '../../../_components/client-tabs';

export const metadata: Metadata = { title: 'Advisory client: Tasks' };

export default async function BusinessAdvisoryClientsClientIdTasksPage({
  params,
}: {
  params: Promise<{ clientId: string }>;
}) {
  const { clientId } = await params;
  return <ClientTasksTab advisoryClientId={clientId} />;
}
