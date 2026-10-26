import type { Metadata } from 'next';
import { openedFromDashboard } from '../../../../lib/from-dashboard';
import { IntakeFormsScreen } from './_components/intake-forms-screen';

export const metadata: Metadata = { title: 'Intake Forms' };

type Param = string | string[] | undefined;

/**
 * `?tab=open` opens the forms not finished yet (the dashboard's Intake stage, Octavia's C5);
 * `&back=dashboard` adds Back to Dashboard (K2).
 */
export default async function IntakeFormsPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: Param; back?: Param }>;
}) {
  const q = await searchParams;
  return (
    <IntakeFormsScreen notFinished={q.tab === 'open'} fromDashboard={openedFromDashboard(q.back)} />
  );
}
