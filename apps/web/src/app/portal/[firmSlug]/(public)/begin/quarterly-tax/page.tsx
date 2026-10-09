import type { Metadata } from 'next';
import { IntakePage } from '../_blocks/intake-flow';

export const metadata: Metadata = { title: 'Quarterly tax' };

export default async function QuarterlyTaxPage({
  params,
}: {
  params: Promise<{ firmSlug: string }>;
}) {
  const { firmSlug } = await params;
  return <IntakePage firmSlug={firmSlug} form="QUARTERLY_TAX" />;
}
