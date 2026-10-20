import type { Metadata } from 'next';
import { MarketplaceScreen } from './_components/marketplace-screen';

export const metadata: Metadata = { title: 'Add integration' };

export default function IntegrationsMarketplacePage() {
  return <MarketplaceScreen />;
}
