import type { Metadata } from 'next';
import { PackageDetailScreen } from '../../_components/package-detail-screen';

export const metadata: Metadata = { title: 'Package' };

type Props = { params: Promise<{ id: string }> };

export default async function ServicesPricingPackagePage({ params }: Props) {
  const { id } = await params;
  return <PackageDetailScreen id={id} />;
}
