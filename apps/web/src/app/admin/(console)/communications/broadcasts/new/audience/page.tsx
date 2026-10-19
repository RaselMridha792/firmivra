import type { Metadata } from 'next';
import { AudienceStep } from './_components/audience-step';

export const metadata: Metadata = { title: 'Create broadcast: Audience' };

export default function AdminCommunicationsBroadcastsNewAudiencePage() {
  return <AudienceStep />;
}
