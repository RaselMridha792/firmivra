import type { Metadata } from 'next';
import { DocumentsScreen } from './_components/documents-screen';

export const metadata: Metadata = { title: 'Client documents' };

export default async function ClientDocumentsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <DocumentsScreen clientId={id} />;
}
