import type { Metadata } from 'next';
import { draftParam } from './_components/draft-param';
import { ServiceStep } from './_components/service-step';

export const metadata: Metadata = { title: 'Add platform integration: General information' };

export default async function AdminIntegrationsPlatformNewPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  // `?draft=<id>` continues a saved draft; without it, step 1 starts a new integration.
  const { draft } = await searchParams;
  return <ServiceStep draftId={draftParam(draft)} />;
}
