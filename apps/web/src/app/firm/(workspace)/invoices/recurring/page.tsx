import type { Metadata } from 'next';
import { RecurringInvoicesScreen } from '../_components/recurring-screens';

export const metadata: Metadata = { title: 'Recurring Invoices' };

export default function RecurringInvoicesPage() {
  return <RecurringInvoicesScreen />;
}
