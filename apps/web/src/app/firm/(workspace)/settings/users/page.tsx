import { PageHeader } from '@firmivra/ui';
import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Users & roles' };

export default function SettingsUsersPage() {
  return <PageHeader title="Users & Roles" />;
}
