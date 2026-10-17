import type { Metadata } from 'next';
import { PackagesScreen } from '../_components/packages-screen';

export const metadata: Metadata = { title: 'Services & pricing: Package builder' };

export default function ServicesPricingPackagesPage() {
  return <PackagesScreen />;
}
