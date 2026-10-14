import { PageHeader } from '@firmivra/ui';
import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Notification settings' };

export default function SettingsNotificationsPage() {
  return <PageHeader title="Notifications" />;
}
