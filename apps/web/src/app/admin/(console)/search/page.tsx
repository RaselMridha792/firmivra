import type { Metadata } from 'next';
import { SearchResults } from './_components/search-results';

export const metadata: Metadata = { title: 'Search' };

export default async function Search({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const q = (await searchParams)['q'];
  return <SearchResults q={typeof q === 'string' ? q.slice(0, 100) : ''} />;
}
