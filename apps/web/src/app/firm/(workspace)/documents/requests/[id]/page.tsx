import type { Metadata } from 'next';
import { RequestDetailScreen } from './_components/request-detail-screen';

export const metadata: Metadata = { title: 'Document Request' };

export default async function DocumentRequestPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <RequestDetailScreen id={id} />;
}
