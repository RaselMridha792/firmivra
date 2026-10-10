import type { Metadata } from 'next';
import { InvoicesScreen } from '../../../invoices/_components/invoices-screen';

export const metadata: Metadata = { title: 'Client invoices' };

export default async function ClientInvoicesPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <InvoicesScreen clientId={id} />;
}
