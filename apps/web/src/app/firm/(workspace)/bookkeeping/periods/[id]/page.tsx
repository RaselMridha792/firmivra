import type { Metadata } from 'next';
import { PeriodScreen } from '../../_components/period-screen';

export const metadata: Metadata = { title: 'Bookkeeping Close' };

export default async function BookkeepingPeriodPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <PeriodScreen id={id} />;
}
