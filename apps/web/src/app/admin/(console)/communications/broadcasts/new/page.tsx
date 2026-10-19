import type { Metadata } from 'next';
import { BroadcastScreen } from './_components/broadcast-screen';

export const metadata: Metadata = { title: 'Create broadcast: Basic information' };

export default async function AdminCommunicationsBroadcastsNewPage({
  searchParams,
}: {
  searchParams: Promise<{ mockState?: string | string[] }>;
}) {
  const { mockState } = await searchParams;
  const requestedState = process.env.NEXT_PUBLIC_API_MOCK === 'all' ? mockState : undefined;
  const mockFixture =
    requestedState === 'empty' || requestedState === 'api-unavailable' ? requestedState : undefined;

  return <BroadcastScreen mockState={mockFixture} />;
}
