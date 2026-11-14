import { OUTBOUND_RELATED_TYPES } from '@firmivra/types';
import type { Metadata } from 'next';
import { ComposeScreen } from './_components/compose-screen';

export const metadata: Metadata = { title: 'New Message' };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
type Param = string | string[] | undefined;
const uuid = (v: Param) => (typeof v === 'string' && UUID.test(v) ? v : undefined);
/** `?clientIds=a,b`: the Clients list's Bulk Send Message (Clients Review 2, G7), at most 100. */
const uuids = (v: Param) => {
  if (typeof v !== 'string') return undefined;
  const ids = [...new Set(v.split(',').filter((id) => UUID.test(id)))].slice(0, 100);
  return ids.length ? ids : undefined;
};
/** `?related=appointment:{id}`: one of the client's records, as Related To holds it. */
const related = (v: Param) => {
  if (typeof v !== 'string') return undefined;
  const [type = '', id = ''] = v.split(':');
  return (OUTBOUND_RELATED_TYPES as readonly string[]).includes(type) && UUID.test(id)
    ? `${type}:${id}`
    : undefined;
};

/**
 * /messages/new (MSG-F09, F10, F14; Frame 2): New Message. `?id=` reopens a draft or a scheduled
 * message; `?clientId=` and `?subject=` start one for a client (a service workspace's Send
 * Message, SH5). `?related=` (with `?clientId=`) puts one of that client's records in Related To:
 * an appointment's Send Message (MSG-F21). `?clientIds=` starts one for the clients selected on
 * the Clients list.
 */
export default async function NewMessagePage({
  searchParams,
}: {
  searchParams: Promise<{
    id?: Param;
    clientId?: Param;
    clientIds?: Param;
    subject?: Param;
    related?: Param;
    fresh?: Param;
  }>;
}) {
  const q = await searchParams;
  const subject = typeof q.subject === 'string' && q.subject.length <= 200 ? q.subject : undefined;
  return (
    <ComposeScreen
      // Another draft, or a new one after a send, starts the page afresh.
      key={uuid(q.id) ?? `new-${String(q.fresh ?? '')}`}
      initialId={uuid(q.id)}
      initialClientId={uuid(q.clientId)}
      initialClientIds={uuids(q.clientIds)}
      initialSubject={subject}
      initialRelated={related(q.related)}
    />
  );
}
