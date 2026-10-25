import type { Metadata } from 'next';
import { openedFromDashboard } from '../../../../lib/from-dashboard';
import { ClientsScreen } from './_components/clients-screen';

export const metadata: Metadata = { title: 'Clients' };

export default async function ClientsPage({
  searchParams,
}: {
  searchParams: Promise<{ search?: string | string[]; back?: string | string[] }>;
}) {
  const { search, back } = await searchParams;
  const text = typeof search === 'string' ? search : '';
  // Keyed by the search, so the header's search box opens a fresh list on this page too.
  return (
    <ClientsScreen key={text} initialSearch={text} fromDashboard={openedFromDashboard(back)} />
  );
}
