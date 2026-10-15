import type { Metadata } from 'next';
import { MessagesInbox } from './_components/messages-inbox';

export const metadata: Metadata = { title: 'Messages' };

export default function MessagesPage() {
  return <MessagesInbox />;
}
