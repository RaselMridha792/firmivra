import type { Metadata } from 'next';
import { PackageLinkScreen } from './_components/package-link-screen';

export const metadata: Metadata = { title: 'Package' };

type Props = { params: Promise<{ packageId: string }> };

/**
 * /{firm}/packages/{packageId} (Client Portal Review One SP-1, Services & Pricing S7, S12): the
 * page behind a package's booking link and its website button.
 */
export default async function PackageLinkPage({ params }: Props) {
  const { packageId } = await params;
  return <PackageLinkScreen packageId={packageId} />;
}
