import type { Metadata } from 'next';
import { BroadcastScreen } from './_components/broadcast-screen';

export const metadata: Metadata = { title: 'Create broadcast: Basic information' };

export default function AdminCommunicationsBroadcastsNewPage() {
  return <BroadcastScreen />;
}
