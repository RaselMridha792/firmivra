import { PageHeader } from '@firmivra/ui';
import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Security settings & policies' };

export default function AdminAuditSecuritySettingsPage() {
  return <PageHeader title="Security Settings & Policies" />;
}
