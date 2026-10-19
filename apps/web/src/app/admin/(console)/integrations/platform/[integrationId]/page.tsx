import type { Metadata } from 'next';
import { PlatformDetail } from './_components/platform-detail';

export const metadata: Metadata = { title: 'Platform integration' };

export default async function AdminIntegrationsPlatformIntegrationIdPage({
  params,
}: {
  params: Promise<{ integrationId: string }>;
}) {
  const { integrationId } = await params;
  // Keyed, so opening another integration starts on its Overview tab.
  return <PlatformDetail key={integrationId} integrationId={integrationId} />;
}
