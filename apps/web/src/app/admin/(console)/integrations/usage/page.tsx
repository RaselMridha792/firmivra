import type { Metadata } from 'next';
import { UsageAnalytics } from './_components/usage-analytics';

export const metadata: Metadata = { title: 'Integration usage & analytics' };

export default async function AdminIntegrationsUsagePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  // The view in the address (?scope=…&subject=…&range=7, or ?integration=… from a platform page).
  const address = await searchParams;
  return <UsageAnalytics address={address} />;
}
