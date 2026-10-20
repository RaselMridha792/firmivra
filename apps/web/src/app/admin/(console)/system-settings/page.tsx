import type { Metadata } from 'next';
import { SystemSettingsScreen } from './_components/system-settings-screen';

export const metadata: Metadata = { title: 'System settings' };

export default function AdminSystemSettingsPage() {
  return <SystemSettingsScreen />;
}
