import type { Metadata } from 'next';
import { ClientNotesTab } from '../../../_components/client-tabs';

export const metadata: Metadata = { title: 'Advisory client: Notes' };

export default async function BusinessAdvisoryClientsClientIdNotesPage({
  params,
}: {
  params: Promise<{ clientId: string }>;
}) {
  const { clientId } = await params;
  return <ClientNotesTab advisoryClientId={clientId} />;
}
