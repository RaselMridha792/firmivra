import type { Metadata } from 'next';
import { draftParam } from '../_components/draft-param';
import { SettingsStep } from '../_components/settings-step';

export const metadata: Metadata = { title: 'Add platform integration: Settings & access' };

export default async function AdminIntegrationsPlatformNewSettingsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  // The draft saved on step 1 (`?draft=<id>`).
  const { draft } = await searchParams;
  return <SettingsStep draftId={draftParam(draft)} />;
}
