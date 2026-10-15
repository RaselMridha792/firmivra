import type { Metadata } from 'next';
import { RolesScreen } from './_components/roles-screen';

export const metadata: Metadata = { title: 'Roles & permissions' };

export default function TeamRolesPage() {
  return <RolesScreen />;
}
