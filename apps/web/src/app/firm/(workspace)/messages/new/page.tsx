import type { Metadata } from 'next';
import { ComposeScreen } from './_components/compose-screen';

export const metadata: Metadata = { title: 'New Message' };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
type Param = string | string[] | undefined;
const uuid = (v: Param) => (typeof v === 'string' && UUID.test(v) ? v : undefined);

/**
 * /messages/new (MSG-F09, F10, F14; Frame 2): New Message. `?id=` reopens a draft or a scheduled
 * message; `?clientId=` and `?subject=` start one for a client (a service workspace's Send
 * Message, SH5).
 */
export default async function NewMessagePage({
  searchParams,
}: {
  searchParams: Promise<{ id?: Param; clientId?: Param; subject?: Param; fresh?: Param }>;
}) {
  const q = await searchParams;
  const subject = typeof q.subject === 'string' && q.subject.length <= 200 ? q.subject : undefined;
  return (
    <ComposeScreen
      // Another draft, or a new one after a send, starts the page afresh.
      key={uuid(q.id) ?? `new-${String(q.fresh ?? '')}`}
      initialId={uuid(q.id)}
      initialClientId={uuid(q.clientId)}
      initialSubject={subject}
    />
  );
}
