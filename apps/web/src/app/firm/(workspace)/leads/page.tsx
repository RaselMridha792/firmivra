import { LeadPipelineStatus } from '@firmivra/types';
import type { Metadata } from 'next';
import { openedFromDashboard } from '../../../../lib/from-dashboard';
import { LeadsScreen } from './_components/leads-screen';

export const metadata: Metadata = { title: 'Leads' };

type Param = string | string[] | undefined;
const day = (v: Param) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : '');

/**
 * `?stage=SUBMITTED&from=2026-10-01&to=2026-10-25` opens Leads with those filters (the dashboard's
 * New Leads, Octavia's K3); `&back=dashboard` adds Back to Dashboard (K2); `?new=1` opens Add New
 * Lead (+ New > Lead, Q6).
 */
export default async function LeadsPage({
  searchParams,
}: {
  searchParams: Promise<{ stage?: Param; from?: Param; to?: Param; back?: Param; new?: Param }>;
}) {
  const q = await searchParams;
  const stage = LeadPipelineStatus.safeParse(q.stage);
  return (
    <LeadsScreen
      initial={{ stage: stage.success ? stage.data : '', from: day(q.from), to: day(q.to) }}
      fromDashboard={openedFromDashboard(q.back)}
      initialCreate={q.new === '1'}
    />
  );
}
