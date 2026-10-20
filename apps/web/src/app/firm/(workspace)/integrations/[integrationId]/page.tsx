import type { Metadata } from 'next';
import { ManageIntegrationOverviewScreen } from './_components/manage-integration-overview-screen';

export const metadata: Metadata = { title: 'Manage integration' };

export default async function IntegrationsIntegrationIdPage({
  params,
}: {
  params: Promise<{ integrationId: string }>;
}) {
  const { integrationId } = await params;
  return <ManageIntegrationOverviewScreen integrationId={integrationId} />;
}
