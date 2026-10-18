import { PageHeader } from '@firmivra/ui';
import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'System configuration & maintenance' };

export default function AdminSystemSettingsConfigurationPage() {
  return <PageHeader title="System Configuration & Maintenance" />;
}
