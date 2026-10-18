import type { Metadata } from 'next';
import { BillingDashboard } from './_components/billing-dashboard';

export const metadata: Metadata = { title: 'Billing' };

/** Billing: the invoice hub (modern-saas-billing-dashboard.jpg, docx §6). */
export default function AdminBillingPage() {
  return <BillingDashboard />;
}
