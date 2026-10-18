import type { Metadata } from 'next';
import { NewCommunication } from '../_components/new-communication';

export const metadata: Metadata = { title: 'New Communication' };

export default async function NewCommunicationPage({
  searchParams,
}: {
  searchParams: Promise<{ channel?: string }>;
}) {
  const { channel } = await searchParams;
  return (
    <NewCommunication
      channel={channel === 'SMS' || channel === 'ANNOUNCEMENT' ? channel : 'EMAIL'}
    />
  );
}
