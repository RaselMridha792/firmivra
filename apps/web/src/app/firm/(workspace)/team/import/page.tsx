import type { Metadata } from 'next';
import { ImportScreen } from './_components/import-screen';

export const metadata: Metadata = { title: 'Bulk upload staff' };

export default function TeamImportPage() {
  return <ImportScreen />;
}
