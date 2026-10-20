import type { Metadata } from 'next';
import { ReviewScreen } from './_components/review-screen';

export const metadata: Metadata = { title: 'Create broadcast: Review & send' };

/** Step 4 of the broadcast `?id=`. */
export default async function AdminCommunicationsBroadcastsNewReviewPage({
  searchParams,
}: {
  searchParams: Promise<{ id?: string | string[] }>;
}) {
  const { id } = await searchParams;
  const broadcastId = typeof id === 'string' && id ? id : undefined;
  return <ReviewScreen key={broadcastId ?? 'none'} broadcastId={broadcastId} />;
}
