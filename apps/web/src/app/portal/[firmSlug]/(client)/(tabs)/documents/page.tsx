import type { Metadata } from 'next';
import { DocumentsScreen } from './_components/documents-screen';

export const metadata: Metadata = { title: 'My Uploaded Documents' };

export default function MyUploadedDocumentsPage() {
  return <DocumentsScreen />;
}
