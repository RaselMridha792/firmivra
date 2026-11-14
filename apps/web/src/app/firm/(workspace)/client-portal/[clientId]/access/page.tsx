import type { Metadata } from 'next';
import { AccessSecurityTab } from '../../_components/manage/tabs';

export const metadata: Metadata = { title: 'Access & Security' };

export default async function Page({ params }: { params: Promise<{ clientId: string }> }) {
  const { clientId } = await params;
  return <AccessSecurityTab clientId={clientId} />;
}
