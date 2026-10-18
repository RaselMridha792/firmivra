import { PageHeader } from '@firmivra/ui';
import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Notifications' };

export default function AdminNotificationsPage() {
  return <PageHeader title="Notifications" />;
}
