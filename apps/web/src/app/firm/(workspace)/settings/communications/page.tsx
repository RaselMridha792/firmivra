import { PageHeader } from '@firmivra/ui';
import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Communications settings' };

export default function SettingsCommunicationsPage() {
  return <PageHeader title="Communications" />;
}
