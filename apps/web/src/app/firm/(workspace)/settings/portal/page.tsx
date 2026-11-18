import type { Metadata } from 'next';
import { Suspense } from 'react';
import { PortalSettings } from './_components/portal-settings';

export const metadata: Metadata = { title: 'Client portal settings' };

export default function ClientPortalSettingsPage() {
  // The screen opens the panel the address names (?panel=features).
  return (
    <Suspense fallback={null}>
      <PortalSettings />
    </Suspense>
  );
}
