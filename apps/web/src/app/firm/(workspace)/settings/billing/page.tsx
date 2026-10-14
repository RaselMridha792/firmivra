import { PageHeader } from '@firmivra/ui';
import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Billing & subscriptions' };

export default function SettingsBillingPage() {
  return <PageHeader title="Billing & Subscriptions" />;
}
