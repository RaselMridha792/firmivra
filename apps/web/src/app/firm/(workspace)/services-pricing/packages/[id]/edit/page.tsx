import type { Metadata } from 'next';
import { PackageEditScreen } from '../../../_components/package-edit-screen';

export const metadata: Metadata = { title: 'Edit package' };

type Props = { params: Promise<{ id: string }> };

export default async function ServicesPricingPackageEditPage({ params }: Props) {
  const { id } = await params;
  return <PackageEditScreen id={id} />;
}
