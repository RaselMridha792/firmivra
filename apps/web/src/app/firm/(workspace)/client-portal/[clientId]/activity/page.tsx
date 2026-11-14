import type { Metadata } from 'next';
import { ActivityTab } from '../../_components/manage/tabs';

export const metadata: Metadata = { title: 'Portal Activity' };

export default async function Page({ params }: { params: Promise<{ clientId: string }> }) {
  const { clientId } = await params;
  return <ActivityTab clientId={clientId} />;
}
