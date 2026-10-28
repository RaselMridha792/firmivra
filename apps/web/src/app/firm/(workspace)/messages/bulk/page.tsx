import type { Metadata } from 'next';
import { BulkMessageScreen } from './_components/bulk-message-screen';

export const metadata: Metadata = { title: 'Send Bulk Message' };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
type Param = string | string[] | undefined;

/**
 * /messages/bulk (MSG-F06): Send Bulk Message from Messages. `?id=` is the draft being built (a
 * Communications draft), `?step=` where the builder is, so Back and a reload keep the place.
 */
export default async function BulkMessagePage({
  searchParams,
}: {
  searchParams: Promise<{ id?: Param; step?: Param }>;
}) {
  const q = await searchParams;
  const id = typeof q.id === 'string' && UUID.test(q.id) ? q.id : undefined;
  const step = q.step === 'message' || q.step === 'sent' ? q.step : 'audience';
  return <BulkMessageScreen initialId={id} initialStep={step} />;
}
