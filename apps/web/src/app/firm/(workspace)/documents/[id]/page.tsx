import type { Metadata } from 'next';
import { DocumentDetailsScreen } from './_components/document-details-screen';

export const metadata: Metadata = { title: 'Document Details' };

export default async function DocumentDetailsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <DocumentDetailsScreen id={id} />;
}
