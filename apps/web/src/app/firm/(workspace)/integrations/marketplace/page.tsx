import type { Metadata } from 'next';
import { readListQuery } from '../../../../../lib/list-query';
import { MarketplaceScreen, MARKETPLACE_VIEW } from './_components/marketplace-screen';

export const metadata: Metadata = { title: 'Add integration' };

export default async function IntegrationsMarketplacePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  return <MarketplaceScreen initial={readListQuery(await searchParams, MARKETPLACE_VIEW)} />;
}
