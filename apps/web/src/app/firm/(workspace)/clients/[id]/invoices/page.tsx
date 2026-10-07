import type { Metadata } from 'next';
import { Invoices } from '../../../../../../features/communications';

export const metadata: Metadata = { title: 'Client invoices' };

export default async function ClientInvoicesPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <Invoices clientId={id} />;
}
