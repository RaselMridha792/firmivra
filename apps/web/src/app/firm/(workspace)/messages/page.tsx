import type { Metadata } from 'next';
import { MessagesScreen } from './_components/messages-screen';

export const metadata: Metadata = { title: 'Messages' };

export default function MessagesPage() {
  return <MessagesScreen />;
}
