import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { MessagesScreen } from './_components/messages-screen';

export const metadata: Metadata = { title: 'Messages' };

type Param = string | string[] | undefined;
const one = (v: Param) => (typeof v === 'string' && v.length <= 200 ? v : undefined);

/**
 * `?new=1`: New Message (the dashboard's Q2 and Q11), now its own page (MSG-F09).
 * `?clientId=&service=` (SH5): a service workspace's Send Message: that client's conversations,
 * with New Message for that client and service.
 */
export default async function MessagesPage({
  searchParams,
}: {
  searchParams: Promise<{ new?: Param; clientId?: Param; service?: Param }>;
}) {
  const q = await searchParams;
  if (q.new === '1') redirect('/messages/new');
  return <MessagesScreen initialClientId={one(q.clientId)} service={one(q.service)} />;
}
