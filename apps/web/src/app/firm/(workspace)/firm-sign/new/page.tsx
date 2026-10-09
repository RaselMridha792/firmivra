import type { Metadata } from 'next';
import { NewRequest } from './_components/new-request';

export const metadata: Metadata = { title: 'New signature request' };

export default async function NewSignatureRequestPage({
  searchParams,
}: {
  searchParams: Promise<{ clientId?: string }>;
}) {
  // Send for Signature on a client record opens this page with the client chosen.
  const { clientId } = await searchParams;
  return <NewRequest clientId={typeof clientId === 'string' ? clientId : undefined} />;
}
