import { PageHeader } from '@firmivra/ui';
import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'System preferences' };

export default function SettingsPreferencesPage() {
  return <PageHeader title="System Preferences" />;
}
