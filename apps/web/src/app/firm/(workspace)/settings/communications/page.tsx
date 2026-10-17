import type { Metadata } from 'next';
import { CommunicationsScreen } from './_components/communications-screen';

export const metadata: Metadata = { title: 'Communications settings' };

export default function SettingsCommunicationsPage() {
  return <CommunicationsScreen />;
}
