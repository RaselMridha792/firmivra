import type { Metadata } from 'next';
import { readListQuery } from '../../../../lib/list-query';
import { ApplicationList } from './_components/application-list';
import { LIST_DEFAULTS } from './_components/list-view';

export const metadata: Metadata = { title: 'Firm Applications' };

export default async function Applications({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  // SA-APP-F11: the list opens as its address says (tab, status, date range, search, page).
  return <ApplicationList initial={readListQuery(await searchParams, LIST_DEFAULTS)} />;
}
