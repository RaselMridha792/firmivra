import type { Metadata } from 'next';
import { AudienceStep } from './_components/audience-step';

export const metadata: Metadata = { title: 'Create broadcast: Audience' };

export default async function AdminCommunicationsBroadcastsNewAudiencePage({
  searchParams,
}: {
  searchParams: Promise<{ mockState?: string | string[] }>;
}) {
  const { mockState } = await searchParams;
  const mockMode = process.env.NEXT_PUBLIC_API_MOCK === 'all';

  return (
    <AudienceStep
      initialSegments={mockMode && mockState === 'empty' ? [] : undefined}
      hasLoadError={mockMode && mockState === 'api-unavailable'}
    />
  );
}
