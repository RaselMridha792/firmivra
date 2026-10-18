import type { Metadata } from 'next';
import { SettingsScreen } from '../_components/settings-screen';

export const metadata: Metadata = { title: 'Bookkeeping Settings' };

export default function BookkeepingSettingsPage() {
  return <SettingsScreen />;
}
