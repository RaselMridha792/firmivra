import type { Metadata } from 'next';
import { AuditDashboard } from './_components/audit-dashboard';

export const metadata: Metadata = { title: 'Audit & Security' };

export default async function AdminAuditSecurityPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  // The filters in the address (?view=login&user=…), so a filtered view opens as it was left.
  const address = await searchParams;
  return <AuditDashboard address={address} />;
}
