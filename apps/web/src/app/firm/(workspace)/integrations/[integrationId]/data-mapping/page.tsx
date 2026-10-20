import type { Metadata } from 'next';
import { DataMappingTab } from './_components/data-mapping-tab';

export const metadata: Metadata = { title: 'Integration: Data mapping' };

export default async function IntegrationsIntegrationIdDataMappingPage({
  params,
}: {
  params: Promise<{ integrationId: string }>;
}) {
  const { integrationId } = await params;
  return <DataMappingTab integrationId={integrationId} />;
}
