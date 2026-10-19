import type { Metadata } from 'next';
import { RecurringInvoices } from './_components/recurring-invoices';

export const metadata: Metadata = { title: 'Recurring invoices' };

/**
 * Recurring Invoices (firmivra-recurring-invoices-dashboard.jpg, docx §9). `?create=1` opens the
 * recurring drawer for a new schedule (the Billing dashboard's "Set Up Recurring Invoice").
 */
export default async function AdminBillingRecurringPage({
  searchParams,
}: {
  searchParams: Promise<{ create?: string | string[] }>;
}) {
  const { create } = await searchParams;
  return <RecurringInvoices create={create === '1'} />;
}
