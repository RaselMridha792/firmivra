import type { Metadata } from 'next';
import { Suspense } from 'react';
import { InvoiceEditor } from '../../_components/invoice-editor';

export const metadata: Metadata = { title: 'Edit Invoice' };

export default async function EditInvoicePage({
  params,
}: {
  params: Promise<{ invoiceId: string }>;
}) {
  const { invoiceId } = await params;
  return (
    <Suspense>
      <InvoiceEditor invoiceId={invoiceId} />
    </Suspense>
  );
}
