import type { Metadata } from 'next';
import { InvoiceEditor } from '../_components/invoice-form';

export const metadata: Metadata = { title: 'Create invoice' };

/**
 * Create Invoice (firmivra-create-invoice-dashboard.jpg, docx §7). `?estimate=<id>` converts an
 * estimate: the form opens filled from it (docx §10.2).
 */
export default async function AdminBillingInvoicesNewPage({
  searchParams,
}: {
  searchParams: Promise<{ estimate?: string | string[] }>;
}) {
  const { estimate } = await searchParams;
  return (
    <InvoiceEditor mode="create" estimateId={typeof estimate === 'string' ? estimate : null} />
  );
}
