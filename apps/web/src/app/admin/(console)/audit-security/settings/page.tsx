import type { Metadata } from 'next';
import { SecuritySettingsForm } from './_components/security-settings';

export const metadata: Metadata = { title: 'Security settings & policies' };

export default function AdminAuditSecuritySettingsPage() {
  return <SecuritySettingsForm />;
}
