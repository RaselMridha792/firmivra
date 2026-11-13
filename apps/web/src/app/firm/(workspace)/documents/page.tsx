import type { Metadata } from 'next';
import { DocumentsScreen } from './_components/documents-screen';

export const metadata: Metadata = { title: 'Documents' };

type Param = string | string[] | undefined;
const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const id = (v: Param) => (typeof v === 'string' && ID.test(v) ? v : undefined);

/**
 * `?clientId=` opens on that client's documents, and `&serviceId=` (the engagement) on one of their
 * services: a workspace's Documents and View All (Review 2, Bookkeeping N02).
 */
export default async function DocumentsPage({
  searchParams,
}: {
  searchParams: Promise<{ clientId?: Param; serviceId?: Param }>;
}) {
  const q = await searchParams;
  const clientId = id(q.clientId);
  const serviceId = clientId ? id(q.serviceId) : undefined;
  return (
    <DocumentsScreen
      {...(clientId ? { initialClientId: clientId } : {})}
      {...(serviceId ? { initialServiceId: serviceId } : {})}
    />
  );
}
