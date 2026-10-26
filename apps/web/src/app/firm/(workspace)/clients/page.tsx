import type { Metadata } from 'next';
import { openedFromDashboard } from '../../../../lib/from-dashboard';
import { ClientsScreen } from './_components/clients-screen';

export const metadata: Metadata = { title: 'Clients' };

export default async function ClientsPage({
  searchParams,
}: {
  searchParams: Promise<{
    search?: string | string[];
    new?: string | string[];
    back?: string | string[];
  }>;
}) {
  const { search, new: adding, back } = await searchParams;
  const text = typeof search === 'string' ? search : '';
  // Keyed by the search, so the header's search box opens a fresh list on this page too.
  // `?new=1`: the dashboard's Add Client and + New > Client open the form itself (Q1, Q7);
  // `&back=dashboard` adds Back to Dashboard (K2).
  return (
    <ClientsScreen
      key={text}
      initialSearch={text}
      initialAdding={adding === '1'}
      fromDashboard={openedFromDashboard(back)}
    />
  );
}
