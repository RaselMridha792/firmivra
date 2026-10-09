import { EsignRequestId } from '@firmivra/types';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { RequestDetail } from './_components/request-detail';

export const metadata: Metadata = { title: 'Signature request' };

export default async function SignatureRequestPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  // A mistyped link is not found, rather than an error that Try again can't fix.
  if (!EsignRequestId.safeParse(id).success) notFound();
  return <RequestDetail id={id} />;
}
