import type { Metadata } from 'next';
import { readListQuery } from '../../../../lib/list-query';
import { BookkeepingScreen } from './_components/bookkeeping-screen';
import { BOOKKEEPING_VIEW } from './_components/list-view';

export const metadata: Metadata = { title: 'Bookkeeping' };

/** The overview, opened with its view from the address (SH1: Back returns to the exact list). */
export default async function BookkeepingPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  return <BookkeepingScreen initial={readListQuery(await searchParams, BOOKKEEPING_VIEW)} />;
}
