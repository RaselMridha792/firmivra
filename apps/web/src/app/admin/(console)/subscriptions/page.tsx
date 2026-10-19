import type { Metadata } from 'next';
import { SubscriptionsScreen } from './_components/subscriptions-screen';

export const metadata: Metadata = { title: 'Subscriptions' };

export default function AdminSubscriptionsPage() {
  return <SubscriptionsScreen />;
}
