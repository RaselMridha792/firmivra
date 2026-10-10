import type { Metadata } from 'next';
import { ClientMessagesScreen } from './_components/client-messages-screen';

export const metadata: Metadata = { title: 'Client messages' };

export default function ClientMessagesPage() {
  return <ClientMessagesScreen />;
}
