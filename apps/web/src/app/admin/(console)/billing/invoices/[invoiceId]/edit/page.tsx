import type { Metadata } from 'next';
import { InvoiceEditor } from '../../_components/invoice-form';

export const metadata: Metadata = { title: 'Edit invoice' };

/** Edit Invoice: Create Invoice in edit mode (docx §7, §8.2), same id and history. */
export default async function AdminBillingInvoicesInvoiceIdEditPage({
  params,
}: {
  params: Promise<{ invoiceId: string }>;
}) {
  const { invoiceId } = await params;
  return <InvoiceEditor mode="edit" invoiceId={invoiceId} />;
}
