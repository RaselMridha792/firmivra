import type { Metadata } from 'next';
import { Suspense } from 'react';
import { ClientWorkspace } from '../../_components/client-workspace';

export const metadata: Metadata = { title: 'Bookkeeping Client' };

export default async function BookkeepingClientPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return (
    <Suspense fallback={null}>
      <ClientWorkspace id={id} />
    </Suspense>
  );
}
