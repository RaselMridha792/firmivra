import type { Metadata } from 'next';
import { InvoicesOverview } from './_components/invoices-overview';

export const metadata: Metadata = { title: 'Invoices & Payments' };

export default function InvoicesPage() {
  return <InvoicesOverview />;
}
