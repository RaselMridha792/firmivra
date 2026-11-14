import type { Metadata } from 'next';
import { PortalContentTab } from '../../_components/manage/tabs';

export const metadata: Metadata = { title: 'Portal Content' };

export default async function Page({ params }: { params: Promise<{ clientId: string }> }) {
  const { clientId } = await params;
  return <PortalContentTab clientId={clientId} />;
}
