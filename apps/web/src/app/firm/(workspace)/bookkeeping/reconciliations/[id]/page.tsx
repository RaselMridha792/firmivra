import type { Metadata } from 'next';
import { ReconciliationScreen } from '../../_components/reconciliation-screen';

export const metadata: Metadata = { title: 'Bookkeeping Reconciliation' };

export default async function BookkeepingReconciliationPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <ReconciliationScreen id={id} />;
}
