import type { Metadata } from 'next';
import { PortalSettings } from './_components/portal-settings';

export const metadata: Metadata = { title: 'Client portal settings' };

export default function ClientPortalSettingsPage() {
  return <PortalSettings />;
}
