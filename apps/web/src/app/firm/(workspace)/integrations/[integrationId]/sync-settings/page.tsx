import type { Metadata } from 'next';
import { SyncSettingsScreen } from './_components/sync-settings-screen';

export const metadata: Metadata = { title: 'Integration: Sync settings' };

export default async function IntegrationsIntegrationIdSyncSettingsPage({
  params,
}: {
  params: Promise<{ integrationId: string }>;
}) {
  const { integrationId } = await params;
  return <SyncSettingsScreen key={integrationId} integrationId={integrationId} />;
}
