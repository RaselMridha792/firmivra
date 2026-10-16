import type { Metadata } from 'next';
import { PermissionsStep } from './_components/permissions-step';

export const metadata: Metadata = { title: 'Create staff: Role & permissions' };

export default async function TeamNewPermissionsPage({
  searchParams,
}: {
  searchParams: Promise<{ draft?: string }>;
}) {
  // Step 1's Next and step 3's Back open this step with the draft.
  const { draft } = await searchParams;
  return <PermissionsStep draftId={typeof draft === 'string' ? draft : undefined} />;
}
