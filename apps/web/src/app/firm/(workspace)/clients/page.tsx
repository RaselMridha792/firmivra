import type { Metadata } from 'next';
import { ClientsScreen } from './_components/clients-screen';

export const metadata: Metadata = { title: 'Clients' };

export default async function ClientsPage({
  searchParams,
}: {
  searchParams: Promise<{ search?: string | string[] }>;
}) {
  const { search } = await searchParams;
  return <ClientsScreen initialSearch={typeof search === 'string' ? search : ''} />;
}
