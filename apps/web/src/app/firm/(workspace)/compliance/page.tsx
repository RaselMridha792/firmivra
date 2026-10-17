import type { Metadata } from 'next';
import { ComplianceScreen } from './_components/compliance-screen';

export const metadata: Metadata = { title: 'Compliance & Deadlines' };

export default function CompliancePage() {
  return <ComplianceScreen />;
}
