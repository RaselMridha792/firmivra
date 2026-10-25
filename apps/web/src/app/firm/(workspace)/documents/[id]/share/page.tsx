import type { Metadata } from 'next';
import { ShareScreen } from './_components/share-screen';

export const metadata: Metadata = { title: 'Share Document' };

export default async function ShareDocumentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  // The portal's address comes from config (PORTAL_BASE_URL), read on the server.
  return <ShareScreen id={id} portalBase={process.env['PORTAL_BASE_URL'] ?? ''} />;
}
