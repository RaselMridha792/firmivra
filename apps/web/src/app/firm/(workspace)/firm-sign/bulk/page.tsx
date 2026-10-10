import { EsignBulkBatch } from '@firmivra/types';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { BulkSend } from './_components/bulk-send';

export const metadata: Metadata = { title: 'Bulk send' };

export default async function BulkSendPage({
  searchParams,
}: {
  searchParams: Promise<{ batch?: string }>;
}) {
  // After sending, ?batch= shows that batch's progress.
  const { batch } = await searchParams;
  if (batch !== undefined && !EsignBulkBatch.shape.id.safeParse(batch).success) notFound();
  return <BulkSend batchId={batch as string | undefined} />;
}
