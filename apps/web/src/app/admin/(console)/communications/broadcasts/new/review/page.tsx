import type { Metadata } from 'next';
import { ReviewScreen } from './_components/review-screen';

export const metadata: Metadata = { title: 'Create broadcast: Review & send' };

export default function AdminCommunicationsBroadcastsNewReviewPage() {
  return <ReviewScreen />;
}
