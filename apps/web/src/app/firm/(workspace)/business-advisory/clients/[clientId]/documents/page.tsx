import type { Metadata } from 'next';
import { Suspense } from 'react';
import { ClientDocumentsTab } from '../../../_components/client-docs-portal';

export const metadata: Metadata = { title: 'Advisory client: Documents' };

export default async function BusinessAdvisoryClientsClientIdDocumentsPage({
  params,
}: {
  params: Promise<{ clientId: string }>;
}) {
  const { clientId } = await params;
  return (
    <Suspense fallback={null}>
      <ClientDocumentsTab advisoryClientId={clientId} />
    </Suspense>
  );
}
