import type { Metadata } from 'next';
import { ClientGoalsTab } from '../../../_components/client-tabs';

export const metadata: Metadata = { title: 'Advisory client: Goals & milestones' };

export default async function BusinessAdvisoryClientsClientIdGoalsPage({
  params,
}: {
  params: Promise<{ clientId: string }>;
}) {
  const { clientId } = await params;
  return <ClientGoalsTab advisoryClientId={clientId} />;
}
