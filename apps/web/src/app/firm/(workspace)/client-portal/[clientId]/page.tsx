import type { Metadata } from 'next';
import { ManagementOverview } from '../_components/manage/overview';

export const metadata: Metadata = { title: 'Portal Management' };

/** Frame 2's Overview: pending actions, visibility, quick actions, link, notes and activity. */
export default async function Page({ params }: { params: Promise<{ clientId: string }> }) {
  const { clientId } = await params;
  return <ManagementOverview clientId={clientId} />;
}
