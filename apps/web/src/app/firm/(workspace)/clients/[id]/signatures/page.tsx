import type { Metadata } from 'next';
import { ClientId } from '@firmivra/types';
import { notFound } from 'next/navigation';
import { ClientSignatures } from './_components/client-signatures';

export const metadata: Metadata = { title: 'Client signatures' };

export default async function ClientSignaturesPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  if (!ClientId.safeParse(id).success) notFound();
  return <ClientSignatures clientId={id} />;
}
