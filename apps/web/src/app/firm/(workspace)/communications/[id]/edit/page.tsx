import type { Metadata } from 'next';
import { Composer } from '../../_components/composer';

export const metadata: Metadata = { title: 'Edit Communication' };

export default async function EditCommunicationPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <Composer id={id} />;
}
