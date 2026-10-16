import type { Metadata } from 'next';
import { CreatedScreen } from './_components/created-screen';

export const metadata: Metadata = { title: 'Staff account created' };

export default async function TeamIdCreatedPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ documentsFailed?: string }>;
}) {
  // Step 4 opens this page after Submit & Send Invitation; documentsFailed counts files that
  // did not upload.
  const { id } = await params;
  const { documentsFailed } = await searchParams;
  const failed = Number(typeof documentsFailed === 'string' ? documentsFailed : 0);
  return <CreatedScreen id={id} documentsFailed={Number.isFinite(failed) ? failed : 0} />;
}
