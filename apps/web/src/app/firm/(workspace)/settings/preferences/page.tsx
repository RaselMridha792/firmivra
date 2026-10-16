import type { Metadata } from 'next';
import { PreferencesScreen } from './_components/preferences-screen';

export const metadata: Metadata = { title: 'System preferences' };

export default function SettingsPreferencesPage() {
  return <PreferencesScreen />;
}
