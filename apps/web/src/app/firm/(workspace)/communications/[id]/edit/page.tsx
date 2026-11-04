import type { Metadata } from 'next';
import { Composer } from '../../_components/composer';

export const metadata: Metadata = { title: 'Edit Communication' };

export default async function EditCommunicationPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ recipients?: string }>;
}) {
  const { id } = await params;
  // CM-F03: the Overview's Choose Recipients opens the draft with its chooser open.
  const { recipients } = await searchParams;
  return <Composer id={id} chooseRecipients={recipients === '1'} />;
}
