import type { Metadata } from 'next';
import { UsersScreen } from './_components/users-screen';

export const metadata: Metadata = { title: 'Users & roles' };

export default function SettingsUsersPage() {
  return <UsersScreen />;
}
