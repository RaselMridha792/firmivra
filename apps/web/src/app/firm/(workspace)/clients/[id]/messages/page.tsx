import type { Metadata } from 'next';
import { PagePlaceholder } from '../../../../../../components/page-placeholder';

export const metadata: Metadata = { title: 'Client messages' };

export default function ClientMessagesPage() {
  return (
    <PagePlaceholder
      title="Client messages"
      ticket="F10"
      owner="Fahad"
      mockup="client-portal/Messages and notes.png (for style)"
    />
  );
}
