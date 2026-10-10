import type { Metadata } from 'next';
import { ClientsScreen } from './_components/clients-screen';

export const metadata: Metadata = { title: 'Clients' };

export default function ClientsPage() {
  return <ClientsScreen />;
}
