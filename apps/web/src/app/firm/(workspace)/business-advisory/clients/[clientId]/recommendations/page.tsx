import type { Metadata } from 'next';
import { ClientRecommendationsTab } from '../../../_components/client-tabs';

export const metadata: Metadata = { title: 'Advisory client: Recommendations' };

export default async function BusinessAdvisoryClientsClientIdRecommendationsPage({
  params,
}: {
  params: Promise<{ clientId: string }>;
}) {
  const { clientId } = await params;
  return <ClientRecommendationsTab advisoryClientId={clientId} />;
}
