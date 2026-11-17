import type { Metadata } from 'next';
import { AdvisoryReportsView } from '../_components/reports-screen';

export const metadata: Metadata = { title: 'Business advisory: Reports' };

/** Advisory A-09: `?client=` is the advisory client a client's Generate Report came from. */
export default async function BusinessAdvisoryReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ client?: string | string[] }>;
}) {
  const { client } = await searchParams;
  const id = typeof client === 'string' && /^[0-9a-f-]{36}$/i.test(client) ? client : undefined;
  return <AdvisoryReportsView {...(id ? { advisoryClientId: id } : {})} />;
}
