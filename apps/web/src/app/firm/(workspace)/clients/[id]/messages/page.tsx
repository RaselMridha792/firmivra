import type { Metadata } from 'next';
import { MessagesScreen } from './_components/messages-screen';

export const metadata: Metadata = { title: 'Client messages' };

export default async function ClientMessagesPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <MessagesScreen clientId={id} />;
}
