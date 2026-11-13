import type { Metadata } from 'next';
import { ClientNotesScreen } from '../_components/client-tab-screens';

export const metadata: Metadata = { title: 'Client notes' };

/** Octavia's E4: the firm's internal notes on the client. */
export default function ClientNotesPage() {
  return <ClientNotesScreen />;
}
