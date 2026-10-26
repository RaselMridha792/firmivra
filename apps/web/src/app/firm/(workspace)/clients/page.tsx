import type { Metadata } from 'next';
import { clientsPlaceFrom } from '../../../../lib/clients-place';
import { openedFromDashboard } from '../../../../lib/from-dashboard';
import { ClientsScreen } from './_components/clients-screen';

export const metadata: Metadata = { title: 'Clients' };

export default async function ClientsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const place = clientsPlaceFrom(params);
  // Keyed by the search, so the header's search box opens a fresh list on this page too. The
  // other filters, the page and its size come back from the address (Octavia's E7).
  // `?new=1`: the dashboard's Add Client and + New > Client open the form itself (Q1, Q7);
  // `&back=dashboard` adds Back to Dashboard (K2).
  return (
    <ClientsScreen
      key={place.search}
      initialSearch={place.search}
      initialPlace={place}
      initialAdding={params['new'] === '1'}
      fromDashboard={openedFromDashboard(params['back'])}
    />
  );
}
