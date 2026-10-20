import type { Metadata } from 'next';
import { AudienceStep } from './_components/audience-step';

export const metadata: Metadata = { title: 'Create broadcast: Audience' };

/** Step 2 of the broadcast `?id=` (made in step 1). */
export default async function AdminCommunicationsBroadcastsNewAudiencePage({
  searchParams,
}: {
  searchParams: Promise<{ id?: string | string[] }>;
}) {
  const { id } = await searchParams;
  const broadcastId = typeof id === 'string' && id ? id : undefined;
  return <AudienceStep key={broadcastId ?? 'none'} broadcastId={broadcastId} />;
}
