import type { Metadata } from 'next';
import { MessagesScreen } from './_components/messages-screen';

export const metadata: Metadata = { title: 'Messages and Notes' };

export default function MessagesAndNotesPage() {
  return <MessagesScreen />;
}
