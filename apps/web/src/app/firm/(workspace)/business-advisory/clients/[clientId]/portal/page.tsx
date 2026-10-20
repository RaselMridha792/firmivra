import type { Metadata } from 'next';
import { ClientPortalTab } from '../../../_components/client-docs-portal';

export const metadata: Metadata = { title: 'Advisory client: Client portal' };

export default async function BusinessAdvisoryClientsClientIdPortalPage({
  params,
}: {
  params: Promise<{ clientId: string }>;
}) {
  const { clientId } = await params;
  return <ClientPortalTab advisoryClientId={clientId} />;
}
