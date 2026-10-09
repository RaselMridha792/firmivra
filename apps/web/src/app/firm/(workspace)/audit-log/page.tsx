import type { Metadata } from 'next';
import { AuditLogScreen } from './_components/audit-log-screen';

export const metadata: Metadata = { title: 'Audit log' };

export default function AuditLogPage() {
  return <AuditLogScreen />;
}
