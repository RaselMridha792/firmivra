import type { Metadata } from 'next';
import { Documents } from '../../../../../../features/documents';

export const metadata: Metadata = { title: 'Client documents' };

export default async function ClientDocumentsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <Documents clientId={id} />;
}
