import type { Metadata } from 'next';
import { ClientDeliverablesTab } from '../../../_components/client-deliverables';

export const metadata: Metadata = { title: 'Advisory client: Services & Deliverables' };

export default async function BusinessAdvisoryClientsClientIdServicesPage({
  params,
}: {
  params: Promise<{ clientId: string }>;
}) {
  const { clientId } = await params;
  return <ClientDeliverablesTab advisoryClientId={clientId} />;
}
