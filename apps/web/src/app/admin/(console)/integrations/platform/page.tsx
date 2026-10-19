import type { Metadata } from 'next';
import { PlatformList, type AddressQuery } from './_components/platform-list';

export const metadata: Metadata = { title: 'Platform integrations' };

export default async function AdminIntegrationsPlatformPage({
  searchParams,
}: {
  searchParams: Promise<AddressQuery>;
}) {
  // The filters in the address (?status=ERROR&q=…), so a filtered list opens as it was left.
  const address = await searchParams;
  return <PlatformList address={address} />;
}
