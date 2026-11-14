import type { Metadata } from 'next';
import { DocumentsScreen } from './_components/documents-screen';

export const metadata: Metadata = { title: 'Documents' };

type Param = string | string[] | undefined;
const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const id = (v: Param) => (typeof v === 'string' && ID.test(v) ? v : undefined);
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const day = (v: Param) => (typeof v === 'string' && DAY.test(v) ? v : undefined);
/** The period's name for its chip: short plain text ("September 2026"). */
const label = (v: Param) =>
  typeof v === 'string' && v.trim() && v.length <= 60 ? v.trim() : undefined;

/**
 * `?clientId=` opens on that client's documents, and `&serviceId=` (the engagement) on one of their
 * services: a workspace's Documents and View All (Review 2, Bookkeeping N02). From Bookkeeping,
 * `&uploadedFrom=&uploadedTo=&period=` adds the current period: the documents uploaded within it,
 * named in a chip the user can clear.
 */
export default async function DocumentsPage({
  searchParams,
}: {
  searchParams: Promise<{
    clientId?: Param;
    serviceId?: Param;
    uploadedFrom?: Param;
    uploadedTo?: Param;
    period?: Param;
  }>;
}) {
  const q = await searchParams;
  const clientId = id(q.clientId);
  const serviceId = clientId ? id(q.serviceId) : undefined;
  const from = day(q.uploadedFrom);
  const to = day(q.uploadedTo);
  const period =
    clientId && from && to && from <= to
      ? { from, to, label: label(q.period) ?? `${from} to ${to}` }
      : undefined;
  return (
    <DocumentsScreen
      {...(clientId ? { initialClientId: clientId } : {})}
      {...(serviceId ? { initialServiceId: serviceId } : {})}
      {...(period ? { initialPeriod: period } : {})}
    />
  );
}
