import type { Metadata } from 'next';
import { IntakePage } from '../_blocks/intake-flow';

export const metadata: Metadata = { title: 'Business development' };

export default async function BusinessDevelopmentPage({
  params,
}: {
  params: Promise<{ firmSlug: string }>;
}) {
  const { firmSlug } = await params;
  return <IntakePage firmSlug={firmSlug} form="BUSINESS_DEVELOPMENT" />;
}
