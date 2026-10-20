import type { Metadata } from 'next';
import { ClientOverview } from '../../_components/client-overview';

export const metadata: Metadata = { title: 'Advisory client' };

export default async function BusinessAdvisoryClientsClientIdPage({
  params,
}: {
  params: Promise<{ clientId: string }>;
}) {
  const { clientId } = await params;
  return <ClientOverview advisoryClientId={clientId} />;
}
