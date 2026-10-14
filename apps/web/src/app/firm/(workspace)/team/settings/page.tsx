import { PageHeader } from '@firmivra/ui';
import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Staff settings' };

export default function TeamSettingsPage() {
  return <PageHeader title="Staff Settings" />;
}
