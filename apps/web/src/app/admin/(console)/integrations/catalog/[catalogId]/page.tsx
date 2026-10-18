import type { Metadata } from 'next';
import { CatalogEdit } from './_components/catalog-edit';

export const metadata: Metadata = { title: 'Customer integration' };

export default async function AdminIntegrationsCatalogCatalogIdPage({
  params,
}: {
  params: Promise<{ catalogId: string }>;
}) {
  const { catalogId } = await params;
  // Keyed, so opening another entry starts a fresh form on its General tab.
  return <CatalogEdit key={catalogId} catalogId={catalogId} />;
}
