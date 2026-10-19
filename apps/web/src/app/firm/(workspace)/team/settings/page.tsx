import type { Metadata } from 'next';
import { StaffSettingsScreen } from './_components/staff-settings-screen';

export const metadata: Metadata = { title: 'Staff settings' };

export default function TeamSettingsPage() {
  return <StaffSettingsScreen />;
}
