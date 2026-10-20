import type { Metadata } from 'next';
import { Suspense } from 'react';
import { SyncHistoryTab } from './_components/sync-history-tab';

export const metadata: Metadata = { title: 'Integration: Sync history' };

export default async function IntegrationsIntegrationIdSyncHistoryPage({
  params,
}: {
  params: Promise<{ integrationId: string }>;
}) {
  const { integrationId } = await params;
  return (
    <Suspense>
      <SyncHistoryTab integrationId={integrationId} />
    </Suspense>
  );
}
