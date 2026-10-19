import type { Metadata } from 'next';
import { BroadcastsDashboard } from './_components/broadcasts-dashboard';

export const metadata: Metadata = { title: 'Broadcasts' };

export default function AdminCommunicationsBroadcastsPage() {
  return <BroadcastsDashboard />;
}
