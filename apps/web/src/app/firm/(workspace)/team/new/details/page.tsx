import type { Metadata } from 'next';
import { DetailsStep } from './_components/details-step';

export const metadata: Metadata = { title: 'Create staff: Additional details' };

export default async function TeamNewDetailsPage({
  searchParams,
}: {
  searchParams: Promise<{ draft?: string }>;
}) {
  // Step 3's Next opens this step with the draft.
  const { draft } = await searchParams;
  return <DetailsStep draftId={typeof draft === 'string' ? draft : undefined} />;
}
