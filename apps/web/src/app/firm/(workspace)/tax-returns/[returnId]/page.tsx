import type { Metadata } from 'next';
import { ReturnWorkspace } from './_components/return-workspace';

export const metadata: Metadata = { title: 'Tax Return' };

export default async function TaxReturnPage({ params }: { params: Promise<{ returnId: string }> }) {
  const { returnId } = await params;
  return <ReturnWorkspace returnId={returnId} />;
}
