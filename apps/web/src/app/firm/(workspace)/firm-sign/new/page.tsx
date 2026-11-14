import type { Metadata } from 'next';
import { NewRequest } from './_components/new-request';

export const metadata: Metadata = { title: 'New signature request' };

export default async function NewSignatureRequestPage({
  searchParams,
}: {
  searchParams: Promise<{
    clientId?: string;
    templateId?: string;
    documentId?: string;
    engagementId?: string;
  }>;
}) {
  // Send for Signature on a client record opens this page with the client chosen, Use template
  // with the template chosen.
  // A tax return's Signatures (Review 2, TX-F03) also names its service (the engagement).
  const { clientId, templateId, documentId, engagementId } = await searchParams;
  return (
    <NewRequest
      clientId={typeof clientId === 'string' ? clientId : undefined}
      templateId={typeof templateId === 'string' ? templateId : undefined}
      documentId={typeof documentId === 'string' ? documentId : undefined}
      engagementId={typeof engagementId === 'string' ? engagementId : undefined}
    />
  );
}
