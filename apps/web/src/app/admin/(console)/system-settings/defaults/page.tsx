import { PageHeader } from '@firmivra/ui';
import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Default user & firm settings' };

export default function AdminSystemSettingsDefaultsPage() {
  return <PageHeader title="Default User & Firm Settings" />;
}
