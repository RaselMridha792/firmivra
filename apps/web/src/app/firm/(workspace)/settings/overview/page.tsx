import type { Metadata } from 'next';
import { OverviewScreen } from './_components/overview-screen';

export const metadata: Metadata = { title: 'Settings overview' };

export default function SettingsOverviewPage() {
  return <OverviewScreen />;
}
