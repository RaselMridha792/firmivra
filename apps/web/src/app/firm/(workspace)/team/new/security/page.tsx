import type { Metadata } from 'next';
import { SecurityStep } from './_components/security-step';

export const metadata: Metadata = { title: 'Create staff: Access & security' };

export default async function TeamNewSecurityPage({
  searchParams,
}: {
  searchParams: Promise<{ draft?: string }>;
}) {
  // Step 2's Next and step 4's Back open this step with the draft.
  const { draft } = await searchParams;
  return <SecurityStep draftId={typeof draft === 'string' ? draft : undefined} />;
}
