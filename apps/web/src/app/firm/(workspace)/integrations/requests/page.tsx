import type { Metadata } from 'next';
import { Suspense } from 'react';
import { RequestsScreen } from './_components/requests-screen';

export const metadata: Metadata = { title: 'Integration requests' };

/** I-UA02 (Integrations Review Two): the firm's integration requests and where each stands. */
export default function IntegrationRequestsPage() {
  return (
    <Suspense fallback={null}>
      <RequestsScreen />
    </Suspense>
  );
}
