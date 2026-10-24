import type { Metadata } from 'next';
import { NewCommunication } from '../_components/new-communication';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const metadata: Metadata = { title: 'New Communication' };

export default async function NewCommunicationPage({
  searchParams,
}: {
  searchParams: Promise<{ channel?: string; template?: string }>;
}) {
  const { channel, template } = await searchParams;
  return (
    <NewCommunication
      channel={channel === 'SMS' || channel === 'ANNOUNCEMENT' ? channel : 'EMAIL'}
      // A template's Use (Templates module): the draft starts as a copy of it.
      templateId={template && UUID.test(template) ? template : undefined}
    />
  );
}
