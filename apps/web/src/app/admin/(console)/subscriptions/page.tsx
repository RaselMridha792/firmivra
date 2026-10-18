import { PageHeader } from '@firmivra/ui';
import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Subscriptions' };

export default function AdminSubscriptionsPage() {
  return <PageHeader title="Subscriptions" />;
}
