import type { Metadata } from 'next';
import { Suspense } from 'react';
import { ComplianceScreen } from './_components/compliance-screen';

export const metadata: Metadata = { title: 'Compliance & Deadlines' };

export default function CompliancePage() {
  // The view, range and filters live in the address (CD-F03, F05).
  return (
    <Suspense fallback={null}>
      <ComplianceScreen />
    </Suspense>
  );
}
