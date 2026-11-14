import type { Metadata } from 'next';
import { PortalPreview } from '../../_components/manage/preview';

export const metadata: Metadata = { title: 'Portal Preview' };

/** Open Client Portal: the read-only staff preview of this client's portal. */
export default async function Page({ params }: { params: Promise<{ clientId: string }> }) {
  const { clientId } = await params;
  return <PortalPreview clientId={clientId} />;
}
