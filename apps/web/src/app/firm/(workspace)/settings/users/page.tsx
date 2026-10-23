import type { Metadata } from 'next';
import { UsersScreen } from './_components/users-screen';

export const metadata: Metadata = { title: 'Users & roles' };

export default async function SettingsUsersPage({
  searchParams,
}: {
  searchParams: Promise<{ role?: string | string[] }>;
}) {
  // `?role=custom:<id>`: the custom role just created, shown in Role Permissions.
  const { role } = await searchParams;
  return <UsersScreen initialRole={typeof role === 'string' ? role : undefined} />;
}
