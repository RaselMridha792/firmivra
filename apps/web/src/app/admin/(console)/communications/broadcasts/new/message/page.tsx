import { PageHeader } from '@firmivra/ui';
import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Broadcast message' };

export default function AdminCommunicationsBroadcastsNewMessagePage() {
  return (
    <PageHeader
      title="Broadcast Message"
      subtitle="Create the message content for this broadcast."
    />
  );
}
