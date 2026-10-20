import type { Metadata } from 'next';
import { Suspense } from 'react';
import { InvoiceEditor } from '../_components/invoice-editor';

export const metadata: Metadata = { title: 'Create Invoice' };

export default function NewInvoicePage() {
  return (
    <Suspense>
      <InvoiceEditor />
    </Suspense>
  );
}
