import type { Metadata } from 'next';
import { PortalDocuments } from '../../_components/documents-tab';

export const metadata: Metadata = { title: 'Portal Documents' };

/** Frame 3: the client's portal documents (documents-tab.jpg). */
export default async function Page({ params }: { params: Promise<{ clientId: string }> }) {
  const { clientId } = await params;
  return <PortalDocuments clientId={clientId} />;
}
