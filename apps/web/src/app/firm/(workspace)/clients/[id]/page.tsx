import type { Metadata } from 'next';
import { ClientOverview } from './_components/client-overview';

export const metadata: Metadata = { title: 'Client overview' };

export default function ClientOverviewPage() {
  return <ClientOverview />;
}
