import type { Metadata } from 'next';
import { openedFromDashboard } from '../../../../../lib/from-dashboard';
import { AllPaymentsScreen } from '../_components/invoice-routes';

export const metadata: Metadata = { title: 'All Payments' };

type Param = string | string[] | undefined;
const day = (v: Param) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : undefined);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * `?start=&end=` the days (a dashboard revenue bar, Dashboard Review 2 C2), `&service=` one
 * service's payments or NONE (a Service Breakdown segment, C4), `&back=dashboard` adds Back to
 * Dashboard.
 */
export default async function AllPaymentsPage({
  searchParams,
}: {
  searchParams: Promise<{ start?: Param; end?: Param; service?: Param; back?: Param }>;
}) {
  const q = await searchParams;
  const service =
    q.service === 'NONE' || (typeof q.service === 'string' && UUID.test(q.service))
      ? q.service
      : undefined;
  const from = day(q.start);
  const to = day(q.end);
  return (
    <AllPaymentsScreen
      initial={{
        ...(from ? { from } : {}),
        ...(to ? { to } : {}),
        ...(service ? { serviceId: service } : {}),
      }}
      fromDashboard={openedFromDashboard(q.back)}
    />
  );
}
