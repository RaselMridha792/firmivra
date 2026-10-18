import type { Metadata } from 'next';
import { SupportSettingsScreen } from './_components/support-settings';

export const metadata: Metadata = { title: 'Support settings' };

export default function AdminSupportSettingsPage() {
  return <SupportSettingsScreen />;
}
