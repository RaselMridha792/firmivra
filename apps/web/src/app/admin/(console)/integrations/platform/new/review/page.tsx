import type { Metadata } from 'next';
import { draftParam } from '../_components/draft-param';
import { ReviewStep } from '../_components/review-step';

export const metadata: Metadata = { title: 'Add platform integration: Review & save' };

export default async function AdminIntegrationsPlatformNewReviewPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  // The draft saved on step 1 (`?draft=<id>`).
  const { draft } = await searchParams;
  return <ReviewStep draftId={draftParam(draft)} />;
}
