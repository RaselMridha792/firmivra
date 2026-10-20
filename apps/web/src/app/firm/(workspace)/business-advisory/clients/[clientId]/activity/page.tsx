import type { Metadata } from 'next';
import { ClientActivityTab } from '../../../_components/client-tabs';

export const metadata: Metadata = { title: 'Advisory client: Activity log' };

export default async function BusinessAdvisoryClientsClientIdActivityPage({
  params,
}: {
  params: Promise<{ clientId: string }>;
}) {
  const { clientId } = await params;
  return <ClientActivityTab advisoryClientId={clientId} />;
}
