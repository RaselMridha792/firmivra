import type { Metadata } from 'next';
import { TroubleshootingTab } from './_components/troubleshooting-tab';

export const metadata: Metadata = { title: 'Integration: Troubleshooting' };

export default async function IntegrationsIntegrationIdTroubleshootingPage({
  params,
}: {
  params: Promise<{ integrationId: string }>;
}) {
  const { integrationId } = await params;
  return <TroubleshootingTab integrationId={integrationId} />;
}
