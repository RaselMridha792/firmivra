import type { Metadata } from 'next';
import { Suspense } from 'react';
import { AuditLogScreen } from './_components/audit-log-screen';

export const metadata: Metadata = { title: 'Audit log' };

export default function AuditLogPage() {
  // The screen reads its first filters from the address.
  return (
    <Suspense fallback={null}>
      <AuditLogScreen />
    </Suspense>
  );
}
