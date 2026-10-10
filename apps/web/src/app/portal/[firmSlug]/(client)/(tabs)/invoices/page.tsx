import type { Metadata } from 'next';
import { InvoicesScreen } from './_components/invoices-screen';

export const metadata: Metadata = { title: 'Receipts & Invoices' };

export default function ReceiptsInvoicesPage() {
  return <InvoicesScreen />;
}
