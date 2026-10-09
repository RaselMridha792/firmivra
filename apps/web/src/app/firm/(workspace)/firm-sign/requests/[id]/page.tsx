import type { Metadata } from 'next';
import { RequestDetail } from './_components/request-detail';

export const metadata: Metadata = { title: 'Signature request' };

export default async function SignatureRequestPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <RequestDetail id={id} />;
}
