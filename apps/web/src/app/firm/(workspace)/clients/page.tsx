import type { Metadata } from 'next';
import { ClientsScreen } from './_components/clients-screen';

export const metadata: Metadata = { title: 'Clients' };

export default async function ClientsPage({
  searchParams,
}: {
  searchParams: Promise<{ search?: string | string[] }>;
}) {
  const { search } = await searchParams;
  const text = typeof search === 'string' ? search : '';
  // Keyed by the search, so the header's search box opens a fresh list on this page too.
  return <ClientsScreen key={text} initialSearch={text} />;
}
