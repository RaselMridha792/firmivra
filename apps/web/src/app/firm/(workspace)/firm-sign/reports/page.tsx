import type { Metadata } from 'next';
import { SigningReports } from './_components/signing-reports';

export const metadata: Metadata = { title: 'Signing reports' };

export default function SigningReportsPage() {
  return <SigningReports />;
}
