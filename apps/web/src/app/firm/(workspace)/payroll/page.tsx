import type { Metadata } from 'next';
import { readListQuery } from '../../../../lib/list-query';
import { PayrollScreen } from './_components/payroll-screen';
import { PAYROLL_VIEW } from './_components/list-view';

export const metadata: Metadata = { title: 'Payroll' };

/** The overview, opened with its view from the address (SH1: Back returns to the exact list). */
export default async function PayrollPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  return <PayrollScreen initial={readListQuery(await searchParams, PAYROLL_VIEW)} />;
}
