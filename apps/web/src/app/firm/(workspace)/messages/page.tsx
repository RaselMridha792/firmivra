import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { MessagesScreen } from './_components/messages-screen';
import { readView } from './_components/messages-view';

export const metadata: Metadata = { title: 'Messages' };

type Param = string | string[] | undefined;
const one = (v: Param) => (typeof v === 'string' && v.length <= 2000 ? v : undefined);

/**
 * `?new=1`: New Message (the dashboard's Q2 and Q11), now its own page (MSG-F09).
 * `?clientId=&service=` (SH5): a service workspace's Send Message: that client's conversations,
 * with New Message for that client and service.
 * `?tab=&q=&thread=&since=&replies=&started=` (MSG-F08): the view a Back to Messages returns to.
 */
export default async function MessagesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, Param>>;
}) {
  const q = await searchParams;
  const params = Object.fromEntries(Object.entries(q).map(([k, v]) => [k, one(v)]));
  if (q['new'] === '1') redirect('/messages/new');
  return <MessagesScreen initialView={readView(params)} />;
}
