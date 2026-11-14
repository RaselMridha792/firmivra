import { TaxReturnWorkflowStatus } from '@firmivra/types';
import type { Metadata } from 'next';
import { openedFromDashboard } from '../../../../lib/from-dashboard';
import { readListQuery } from '../../../../lib/list-query';
import { ReturnsScreen } from './_components/returns-screen';
import { RETURNS_VIEW } from './_components/returns-view';

export const metadata: Metadata = { title: 'Tax Returns' };

type Param = string | string[] | undefined;
const day = (v: Param) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : '');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * `?status=` a workflow status or IN_PROGRESS (the five in-progress ones), and
 * `&acceptedFrom=&acceptedTo=`: the dashboard's Returns In Progress and Accepted Returns (Octavia's
 * K4 and K5); `&serviceId=` the returns of one tax service (D4, a dashboard service card);
 * `&asOf=` a past period's card: the returns as they stood at the end of that day (Review 2, K4);
 * `&back=dashboard` adds Back to Dashboard (K2).
 */
export default async function TaxReturnsPage({
  searchParams,
}: {
  searchParams: Promise<{
    [key: string]: Param;
    status?: Param;
    acceptedFrom?: Param;
    acceptedTo?: Param;
    serviceId?: Param;
    asOf?: Param;
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
      serviceId={typeof q.serviceId === 'string' && UUID.test(q.serviceId) ? q.serviceId : ''}
      asOf={day(q.asOf)}
      fromDashboard={openedFromDashboard(q.back)}
      view={readListQuery(q, RETURNS_VIEW)}
    />
  );
}
