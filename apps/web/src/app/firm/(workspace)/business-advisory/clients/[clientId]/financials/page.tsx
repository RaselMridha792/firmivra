import type { Metadata } from 'next';
import { ClientFinancialsTab } from '../../../_components/client-tabs-r1';

export const metadata: Metadata = { title: 'Advisory client: Financials' };

export default async function BusinessAdvisoryClientsClientIdFinancialsPage({
  params,
}: {
  params: Promise<{ clientId: string }>;
}) {
  const { clientId } = await params;
  return <ClientFinancialsTab advisoryClientId={clientId} />;
}
