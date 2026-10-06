import type { Metadata } from 'next';
import { PagePlaceholder } from '../../../../../../components/page-placeholder';

export const metadata: Metadata = { title: 'Messages and Notes' };

export default function MessagesAndNotesPage() {
  return (
    <PagePlaceholder
      title="Messages and Notes"
      ticket="N09"
      owner="Nahid"
      mockup="client-portal/Messages and notes.png"
    />
  );
}
