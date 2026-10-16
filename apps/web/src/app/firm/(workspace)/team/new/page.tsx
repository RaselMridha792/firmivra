import type { Metadata } from 'next';
import { AccountStep } from './_components/account-step';

export const metadata: Metadata = { title: 'Create staff: Account information' };

export default async function TeamNewPage({
  searchParams,
}: {
  searchParams: Promise<{ draft?: string }>;
}) {
  // Save as Draft and Back from step 2 open this step with the draft.
  const { draft } = await searchParams;
  return <AccountStep draftId={typeof draft === 'string' ? draft : undefined} />;
}
