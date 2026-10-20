import type { Metadata } from 'next';
import { ClientPlanTab } from '../../../_components/client-tabs';

export const metadata: Metadata = { title: 'Advisory client: Business plan' };

export default async function BusinessAdvisoryClientsClientIdPlanPage({
  params,
}: {
  params: Promise<{ clientId: string }>;
}) {
  const { clientId } = await params;
  return <ClientPlanTab advisoryClientId={clientId} />;
}
