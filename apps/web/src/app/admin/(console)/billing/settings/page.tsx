import { PageHeader } from '@firmivra/ui';
import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Billing settings' };

export default function AdminBillingSettingsPage() {
  return <PageHeader title="Billing Settings" />;
}
