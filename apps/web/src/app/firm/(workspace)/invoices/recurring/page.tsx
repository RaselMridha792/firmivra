import type { Metadata } from 'next';
import { RecurringInvoicesScreen } from '../_components/invoice-routes';

export const metadata: Metadata = { title: 'Recurring Invoices' };

export default function RecurringInvoicesPage() {
  return <RecurringInvoicesScreen />;
}
