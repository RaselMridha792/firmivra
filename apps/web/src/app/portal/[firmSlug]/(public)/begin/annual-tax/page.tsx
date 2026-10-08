import type { Metadata } from 'next';
import { AnnualTaxForm } from './_components/annual-tax-form';

export const metadata: Metadata = { title: 'Annual Tax Intake Form' };

export default async function AnnualTaxPreparationPage({
  params,
}: {
  params: Promise<{ firmSlug: string }>;
}) {
  const { firmSlug } = await params;
  const now = new Date();
  return (
    <AnnualTaxForm
      key={firmSlug}
      taxYear={now.getFullYear()}
      today={now.toISOString().slice(0, 10)}
    />
  );
}
