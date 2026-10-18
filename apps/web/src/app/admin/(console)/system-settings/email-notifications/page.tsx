import { PageHeader } from '@firmivra/ui';
import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Email & notifications' };

export default function AdminSystemSettingsEmailNotificationsPage() {
  return <PageHeader title="Email & Notifications" />;
}
