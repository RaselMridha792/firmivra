import type { Metadata } from 'next';
import { InvoiceDetails } from '../_components/invoice-details';

export const metadata: Metadata = { title: 'Invoice' };

/** Invoice Details (firmivra-invoice-dashboard.jpg, docx §8). `?saved=` names the save just made. */
export default async function AdminBillingInvoicesInvoiceIdPage({
  params,
  searchParams,
}: {
  params: Promise<{ invoiceId: string }>;
  searchParams: Promise<{ saved?: string | string[] }>;
}) {
  const [{ invoiceId }, { saved }] = await Promise.all([params, searchParams]);
  return <InvoiceDetails invoiceId={invoiceId} saved={typeof saved === 'string' ? saved : null} />;
}
