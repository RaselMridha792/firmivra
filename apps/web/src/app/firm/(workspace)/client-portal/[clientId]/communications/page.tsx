import type { Metadata } from 'next';
import { PortalMessages } from '../../_components/record-tabs';

export const metadata: Metadata = { title: 'Communications' };

/** The client's conversations with the firm (developer instructions 24). */
export default async function Page({ params }: { params: Promise<{ clientId: string }> }) {
  const { clientId } = await params;
  return <PortalMessages clientId={clientId} communications />;
}
