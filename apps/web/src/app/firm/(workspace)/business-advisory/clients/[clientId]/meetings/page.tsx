import type { Metadata } from 'next';
import { ClientMeetingsTab } from '../../../_components/client-tabs-r1';

export const metadata: Metadata = { title: 'Advisory client: Meetings' };

export default async function BusinessAdvisoryClientsClientIdMeetingsPage({
  params,
}: {
  params: Promise<{ clientId: string }>;
}) {
  const { clientId } = await params;
  return <ClientMeetingsTab advisoryClientId={clientId} />;
}
