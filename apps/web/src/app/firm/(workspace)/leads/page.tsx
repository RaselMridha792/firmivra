import type { Metadata } from 'next';
import { openedFromDashboard } from '../../../../lib/from-dashboard';
import { LeadsScreen } from './_components/leads-screen';

export const metadata: Metadata = { title: 'Leads' };

type Param = string | string[] | undefined;

/**
 * The list's place is in its address (Leads R2 1: search, filters, page and size; the screen reads
 * it, lib/leads-place.ts). `?stage=SUBMITTED&from=2026-10-01&to=2026-10-25` is the dashboard's New
 * Leads (Octavia's K3); `&back=dashboard` adds Back to Dashboard (K2); `?new=1` opens Add New Lead
 * (+ New > Lead, Q6).
 */
export default async function LeadsPage({
  searchParams,
}: {
  searchParams: Promise<{ back?: Param; new?: Param }>;
}) {
  const q = await searchParams;
  return <LeadsScreen fromDashboard={openedFromDashboard(q.back)} initialCreate={q.new === '1'} />;
}
