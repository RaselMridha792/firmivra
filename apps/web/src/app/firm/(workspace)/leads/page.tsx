import type { Metadata } from 'next';
import { LeadsScreen } from './_components/leads-screen';

export const metadata: Metadata = { title: 'Leads' };

export default function LeadsPage() {
  return <LeadsScreen />;
}
