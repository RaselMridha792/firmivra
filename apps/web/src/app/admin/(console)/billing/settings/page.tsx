import type { Metadata } from 'next';
import { BillingSettingsScreen } from './_components/settings-screen';

export const metadata: Metadata = { title: 'Billing settings' };

/** Billing Settings: platform-wide billing defaults (firmivra-billing-settings-dashboard.jpg, docx §15). */
export default function AdminBillingSettingsPage() {
  return <BillingSettingsScreen />;
}
