import { PageHeader } from '@firmivra/ui';
import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'System settings' };

export default function AdminSystemSettingsPage() {
  return <PageHeader title="System Settings" />;
}
