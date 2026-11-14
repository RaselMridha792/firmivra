import type { Metadata } from 'next';
import { Suspense } from 'react';
import { ClientPortalScreen } from './_components/client-portal-screen';

export const metadata: Metadata = { title: 'Client Portal' };

/** /client-portal: the firm workspace's Client Portal module (Frame 1), one client at a time. */
export default function ClientPortalPage() {
  return (
    <Suspense>
      <ClientPortalScreen />
    </Suspense>
  );
}
