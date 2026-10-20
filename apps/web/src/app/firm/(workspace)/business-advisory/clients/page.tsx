import type { Metadata } from 'next';
import { AdvisoryClients } from '../_components/clients-screen';

export const metadata: Metadata = { title: 'Business advisory: Advisory clients' };

export default function BusinessAdvisoryClientsPage() {
  return <AdvisoryClients />;
}
