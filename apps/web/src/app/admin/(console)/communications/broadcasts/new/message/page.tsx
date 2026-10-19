import type { Metadata } from 'next';
import { BroadcastMessageStep } from './_components/broadcast-message-step';

export const metadata: Metadata = { title: 'Create broadcast: Message' };

export default function AdminCommunicationsBroadcastsNewMessagePage() {
  return <BroadcastMessageStep />;
}
