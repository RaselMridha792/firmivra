import type { Metadata } from 'next';
import { InvoiceDetail } from './_components/invoice-detail';

export const metadata: Metadata = { title: 'Invoice' };

export default function InvoicePage() {
  return <InvoiceDetail />;
}
