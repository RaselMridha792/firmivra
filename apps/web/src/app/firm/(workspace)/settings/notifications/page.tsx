import type { Metadata } from 'next';
import { NotificationsScreen } from './_components/notifications-screen';

export const metadata: Metadata = { title: 'Notification settings' };

export default function SettingsNotificationsPage() {
  return <NotificationsScreen />;
}
