import type { Metadata } from 'next';
import { AnnualTaxPage } from './_components/annual-tax-page';

export const metadata: Metadata = { title: 'Annual tax preparation' };

export default async function AnnualTaxPreparationPage({
  params,
}: {
  params: Promise<{ firmSlug: string }>;
}) {
  const { firmSlug } = await params;
  return <AnnualTaxPage firmSlug={firmSlug} />;
}
