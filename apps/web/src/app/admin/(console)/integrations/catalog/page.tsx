import type { Metadata } from 'next';
import { CatalogList } from './_components/catalog-list';

export const metadata: Metadata = { title: 'Customer integration catalog' };

export default async function AdminIntegrationsCatalogPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  // The filters in the address (?status=ENABLED&plan=…), so a filtered view opens as it was left.
  const address = await searchParams;
  return <CatalogList address={address} />;
}
