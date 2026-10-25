import { TaxReturnWorkflowStatus } from '@firmivra/types';
import type { Metadata } from 'next';
import { openedFromDashboard } from '../../../../lib/from-dashboard';
import { ReturnsScreen } from './_components/returns-screen';

export const metadata: Metadata = { title: 'Tax Returns' };

type Param = string | string[] | undefined;
const day = (v: Param) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : '');

/**
 * `?status=` a workflow status or IN_PROGRESS (the five in-progress ones), and
 * `&acceptedFrom=&acceptedTo=`: the dashboard's Returns In Progress and Accepted Returns (Octavia's
 * K4 and K5); `&back=dashboard` adds Back to Dashboard (K2).
 */
export default async function TaxReturnsPage({
  searchParams,
}: {
  searchParams: Promise<{
    status?: Param;
    acceptedFrom?: Param;
    acceptedTo?: Param;
    back?: Param;
  }>;
}) {
  const q = await searchParams;
  const status =
    q.status === 'IN_PROGRESS'
      ? 'IN_PROGRESS'
      : TaxReturnWorkflowStatus.safeParse(q.status).success
        ? String(q.status)
        : '';
  return (
    <ReturnsScreen
      initialStatus={status}
      accepted={{ from: day(q.acceptedFrom), to: day(q.acceptedTo) }}
      fromDashboard={openedFromDashboard(q.back)}
    />
  );
}
