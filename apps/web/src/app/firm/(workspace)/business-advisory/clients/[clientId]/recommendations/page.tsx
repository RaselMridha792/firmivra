import type { Metadata } from 'next';
import { ClientRecommendationsTab } from '../../../_components/client-tabs-r1';

export const metadata: Metadata = { title: 'Advisory client: Recommendations' };

export default async function BusinessAdvisoryClientsClientIdRecommendationsPage({
  params,
}: {
  params: Promise<{ clientId: string }>;
}) {
  const { clientId } = await params;
  return <ClientRecommendationsTab advisoryClientId={clientId} />;
}
