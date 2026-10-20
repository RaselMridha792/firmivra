import type { Metadata } from 'next';
import { BroadcastMessageStep } from './_components/broadcast-message-step';

export const metadata: Metadata = { title: 'Create broadcast: Message' };

/** Step 3 of the broadcast `?id=`. */
export default async function AdminCommunicationsBroadcastsNewMessagePage({
  searchParams,
}: {
  searchParams: Promise<{ id?: string | string[] }>;
}) {
  const { id } = await searchParams;
  const broadcastId = typeof id === 'string' && id ? id : undefined;
  return <BroadcastMessageStep key={broadcastId ?? 'none'} broadcastId={broadcastId} />;
}
