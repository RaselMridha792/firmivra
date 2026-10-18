import type { Metadata } from 'next';
import { IntegrationLogs } from './_components/integration-logs';

export const metadata: Metadata = { title: 'Integration logs' };

export default async function AdminIntegrationsLogsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  // The filters in the address (?integration=…&severity=…) and an open record (?log=…).
  const address = await searchParams;
  return <IntegrationLogs address={address} />;
}
