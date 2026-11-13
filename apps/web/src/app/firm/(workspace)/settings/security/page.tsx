import type { Metadata } from 'next';
import { Suspense } from 'react';
import { SecurityScreen } from './_components/security-screen';

export const metadata: Metadata = { title: 'Security & access' };

export default function SettingsSecurityPage() {
  // View Alerts and the Settings badge open it with ?alerts=open.
  return (
    <Suspense fallback={null}>
      <SecurityScreen />
    </Suspense>
  );
}
