import type { Metadata } from 'next';
import { PaymentsCenter } from './_components/payments-center';

export const metadata: Metadata = { title: 'Payments' };

/** Payments (firmivra-payments-dashboard.jpg, docx §12): payment details are a side panel. */
export default function AdminBillingPaymentsPage() {
  return <PaymentsCenter />;
}
