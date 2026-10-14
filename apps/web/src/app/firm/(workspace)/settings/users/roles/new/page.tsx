import { PageHeader } from '@firmivra/ui';
import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Create custom role' };

export default function SettingsUsersRolesNewPage() {
  return <PageHeader title="Create Custom Role" />;
}
