import type { Metadata } from 'next';
import { LeadsScreen } from './_components/leads-screen';

export const metadata: Metadata = { title: 'Leads' };

/** `?new=1`: opens Add New Lead (+ New > Lead, Q6). */
export default async function LeadsPage({
  searchParams,
}: {
  searchParams: Promise<{ new?: string | string[] }>;
}) {
  const q = await searchParams;
  return <LeadsScreen initialCreate={q.new === '1'} />;
}
