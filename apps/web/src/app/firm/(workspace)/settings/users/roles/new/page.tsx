import type { Metadata } from 'next';
import { NewRoleScreen } from './_components/new-role-screen';

export const metadata: Metadata = { title: 'Create custom role' };

export default function SettingsNewRolePage() {
  return <NewRoleScreen />;
}
