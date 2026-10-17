import type { Metadata } from 'next';
import { BillingScreen } from './_components/billing-screen';

export const metadata: Metadata = { title: 'Billing & subscriptions' };

export default function SettingsBillingPage() {
  return <BillingScreen />;
}
