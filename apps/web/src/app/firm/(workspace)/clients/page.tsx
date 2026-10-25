import type { Metadata } from 'next';
import { ClientsScreen } from './_components/clients-screen';

export const metadata: Metadata = { title: 'Clients' };

export default async function ClientsPage({
  searchParams,
}: {
  searchParams: Promise<{ search?: string | string[]; new?: string | string[] }>;
}) {
  const { search, new: adding } = await searchParams;
  const text = typeof search === 'string' ? search : '';
  // Keyed by the search, so the header's search box opens a fresh list on this page too.
  // `?new=1`: the dashboard's Add Client and + New > Client open the form itself (Q1, Q7).
  return <ClientsScreen key={text} initialSearch={text} initialAdding={adding === '1'} />;
}
