import { PageHeader } from '@firmivra/ui';
import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Data & retention' };

export default function AdminSystemSettingsDataRetentionPage() {
  return <PageHeader title="Data & Retention" />;
}
