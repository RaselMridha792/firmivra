import type { Metadata } from 'next';
import { SettingsScreen } from './_components/settings-screen';

export const metadata: Metadata = { title: 'Intake form settings' };

export default function IntakeFormsSettingsPage() {
  return <SettingsScreen />;
}
