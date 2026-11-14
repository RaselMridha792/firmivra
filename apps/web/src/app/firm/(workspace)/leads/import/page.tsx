import type { Metadata } from 'next';
import { LeadsImportScreen } from './_components/leads-import-screen';

export const metadata: Metadata = { title: 'Import Leads' };

export default function LeadsImportPage() {
  return <LeadsImportScreen />;
}
