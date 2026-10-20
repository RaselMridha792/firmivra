import type { Metadata } from 'next';
import { SyncSettingsTab } from './_components/sync-settings-tab';

export const metadata: Metadata = { title: 'Integration: Sync settings' };

export default async function IntegrationsIntegrationIdSyncSettingsPage({
  params,
}: {
  params: Promise<{ integrationId: string }>;
}) {
  const { integrationId } = await params;
  return <SyncSettingsTab integrationId={integrationId} />;
}
