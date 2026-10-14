import type { Metadata } from 'next';
import { DocumentsScreen } from './_components/documents-screen';

export const metadata: Metadata = { title: 'Documents' };

export default function DocumentsPage() {
  return <DocumentsScreen />;
}
