import type { Metadata } from 'next';
import { IntakeLinkScreen } from './_components/intake-link-screen';

export const metadata: Metadata = { title: 'Your form' };

export default async function IntakeLinkPage({
  params,
}: {
  params: Promise<{ firmSlug: string }>;
}) {
  const { firmSlug } = await params;
  return <IntakeLinkScreen firmSlug={firmSlug} />;
}
