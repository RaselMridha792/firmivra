import type { Metadata } from 'next';
import { IntakePage } from '../_blocks/intake-flow';

export const metadata: Metadata = { title: 'Payroll' };

export default async function PayrollPage({ params }: { params: Promise<{ firmSlug: string }> }) {
  const { firmSlug } = await params;
  return <IntakePage firmSlug={firmSlug} form="PAYROLL" />;
}
