import type { Metadata } from 'next';
import { MessagesScreen } from './_components/messages-screen';

export const metadata: Metadata = { title: 'Messages' };

/** `?new=1`: opens New Message, with the client to choose (the dashboard's Q2 and Q11). */
export default async function MessagesPage({
  searchParams,
}: {
  searchParams: Promise<{ new?: string | string[] }>;
}) {
  const q = await searchParams;
  return <MessagesScreen initialComposing={q.new === '1'} />;
}
