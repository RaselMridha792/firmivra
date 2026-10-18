import { PageHeader } from '@firmivra/ui';
import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'General settings' };

export default function AdminSystemSettingsGeneralPage() {
  return <PageHeader title="General Settings" />;
}
