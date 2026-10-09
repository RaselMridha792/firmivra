import type { Metadata } from 'next';
import { NewRequest } from './_components/new-request';

export const metadata: Metadata = { title: 'New signature request' };

export default async function NewSignatureRequestPage({
  searchParams,
}: {
  searchParams: Promise<{ clientId?: string; templateId?: string }>;
}) {
  // Send for Signature on a client record opens this page with the client chosen, Use template
  // with the template chosen.
  const { clientId, templateId } = await searchParams;
  return (
    <NewRequest
      clientId={typeof clientId === 'string' ? clientId : undefined}
      templateId={typeof templateId === 'string' ? templateId : undefined}
    />
  );
}
