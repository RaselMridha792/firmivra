import type { Metadata } from 'next';
import { NewRoleScreen } from './_components/new-role-screen';

export const metadata: Metadata = { title: 'Create custom role' };

export default async function SettingsNewRolePage({
  searchParams,
}: {
  searchParams: Promise<{ template?: string | string[] }>;
}) {
  // `?template=`: the role chosen on Users & Roles. `from` is the way back (lib/origin.ts).
  const { template } = await searchParams;
  return <NewRoleScreen from={typeof template === 'string' ? template : undefined} />;
}
