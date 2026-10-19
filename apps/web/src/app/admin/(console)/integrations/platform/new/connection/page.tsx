import type { Metadata } from 'next';
import { ConnectionStep } from '../_components/connection-step';
import { draftParam } from '../_components/draft-param';

export const metadata: Metadata = { title: 'Add platform integration: Connection details' };

export default async function AdminIntegrationsPlatformNewConnectionPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  // The draft saved on step 1 (`?draft=<id>`).
  const { draft } = await searchParams;
  return <ConnectionStep draftId={draftParam(draft)} />;
}
