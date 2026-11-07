import type { Metadata } from 'next';
import { RecurringDetailScreen } from '../../_components/recurring-screens';

export const metadata: Metadata = { title: 'Recurring Invoice' };

/** IP-F18: one recurring invoice, its invoices, next send days and history. */
export default async function RecurringInvoicePage({
  params,
}: {
  params: Promise<{ recurringId: string }>;
}) {
  const { recurringId } = await params;
  return <RecurringDetailScreen id={recurringId} />;
}
