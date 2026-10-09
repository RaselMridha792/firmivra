import type { Metadata } from 'next';
import { IntakePage } from '../_blocks/intake-flow';

export const metadata: Metadata = { title: 'Bookkeeping' };

export default async function BookkeepingPage({
  params,
}: {
  params: Promise<{ firmSlug: string }>;
}) {
  const { firmSlug } = await params;
  return <IntakePage firmSlug={firmSlug} form="BOOKKEEPING" />;
}
