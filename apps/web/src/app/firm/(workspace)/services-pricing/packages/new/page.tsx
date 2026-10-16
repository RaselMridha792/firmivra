import type { Metadata } from 'next';
import { PackageBuilder } from './_components/package-builder';

export const metadata: Metadata = { title: 'Create package' };

export default function ServicesPricingPackagesNewPage() {
  return <PackageBuilder />;
}
