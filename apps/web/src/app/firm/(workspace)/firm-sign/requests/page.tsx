import { EsignRequestStatus } from '@firmivra/types';
import type { Metadata } from 'next';
import { AllRequests } from './_components/all-requests';

export const metadata: Metadata = { title: 'Signature requests' };

export default async function SignatureRequestsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  // A dashboard counter opens the list filtered by its status. Delivered is shown as Sent (and
  // the API's Sent includes it).
  const parsed = EsignRequestStatus.safeParse((await searchParams).status);
  const status = parsed.success ? (parsed.data === 'DELIVERED' ? 'SENT' : parsed.data) : undefined;
  return <AllRequests status={status} />;
}
