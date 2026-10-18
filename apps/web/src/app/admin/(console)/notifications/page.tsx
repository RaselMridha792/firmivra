import type { Metadata } from 'next';
import { NotificationsScreen } from './_components/notifications-screen';

export const metadata: Metadata = { title: 'Notifications' };

export default function AdminNotificationsPage() {
  return <NotificationsScreen />;
}
