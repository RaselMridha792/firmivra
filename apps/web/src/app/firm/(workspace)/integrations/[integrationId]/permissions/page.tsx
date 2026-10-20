import type { Metadata } from 'next';
import { PermissionsTab } from './_components/permissions-tab';

export const metadata: Metadata = { title: 'Integration: Permissions' };

export default async function IntegrationsIntegrationIdPermissionsPage({
  params,
}: {
  params: Promise<{ integrationId: string }>;
}) {
  const { integrationId } = await params;
  return <PermissionsTab integrationId={integrationId} />;
}
