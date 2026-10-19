import type { Metadata } from 'next';
import { MessageComposer } from './_components/message-composer';

export const metadata: Metadata = { title: 'New message' };

export default function AdminCommunicationsBroadcastsNewMessagePage() {
  return <MessageComposer />;
}
