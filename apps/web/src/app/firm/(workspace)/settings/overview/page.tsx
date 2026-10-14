import { PageHeader } from '@firmivra/ui';
import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Settings overview' };

export default function SettingsOverviewPage() {
  return <PageHeader title="Settings" />;
}
