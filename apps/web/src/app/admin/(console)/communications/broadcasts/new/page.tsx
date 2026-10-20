import type { Metadata } from 'next';
import { BroadcastScreen } from './_components/broadcast-screen';

export const metadata: Metadata = { title: 'Create broadcast: Basic information' };

/** Step 1; `?id=` opens a saved draft (the steps carry the broadcast's id). */
export default async function AdminCommunicationsBroadcastsNewPage({
  searchParams,
}: {
  searchParams: Promise<{ id?: string | string[] }>;
}) {
  const { id } = await searchParams;
  const broadcastId = typeof id === 'string' && id ? id : undefined;
  return <BroadcastScreen key={broadcastId ?? 'new'} broadcastId={broadcastId} />;
}
