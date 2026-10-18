import type { Metadata } from 'next';
import { AuditDashboard } from './_components/audit-dashboard';

export const metadata: Metadata = { title: 'Audit & Security' };

export default function AdminAuditSecurityPage() {
  return <AuditDashboard />;
}
