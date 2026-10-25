import type { Metadata } from 'next';
import { openedFromDashboard } from '../../../../lib/from-dashboard';
import { InvoicesOverview } from './_components/invoices-overview';

export const metadata: Metadata = { title: 'Invoices & Payments' };

type Param = string | string[] | undefined;

/**
 * `?status=OUTSTANDING` opens the list on every unpaid invoice (the dashboard's Outstanding
 * Invoices, Octavia's K6); `&back=dashboard` adds Back to Dashboard (K2).
 */
export default async function InvoicesPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: Param; back?: Param }>;
}) {
  const q = await searchParams;
  return (
    <InvoicesOverview
      initialStatus={q.status === 'OUTSTANDING' ? 'OUTSTANDING' : ''}
      fromDashboard={openedFromDashboard(q.back)}
    />
  );
}
