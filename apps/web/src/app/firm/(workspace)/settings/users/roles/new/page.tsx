import type { Metadata } from 'next';
import { NewRoleScreen } from './_components/new-role-screen';

export const metadata: Metadata = { title: 'Create custom role' };

export default async function SettingsNewRolePage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string | string[] }>;
}) {
  const { from } = await searchParams;
  return <NewRoleScreen from={typeof from === 'string' ? from : undefined} />;
}
