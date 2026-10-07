import type { Metadata } from 'next';
import { Messages } from '../../../../../../features/communications';

export const metadata: Metadata = { title: 'Client messages' };

export default async function ClientMessagesPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <Messages clientId={id} />;
}
