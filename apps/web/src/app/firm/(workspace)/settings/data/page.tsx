import { PageHeader } from '@firmivra/ui';
import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Data & backups' };

export default function SettingsDataPage() {
  return <PageHeader title="Data & Backups" />;
}
