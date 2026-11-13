import type { Metadata } from 'next';
import { ClientIntakesScreen } from '../_components/client-tab-screens';

export const metadata: Metadata = { title: 'Client intake forms' };

/** Octavia's E4: the client's intake forms. */
export default function ClientIntakesPage() {
  return <ClientIntakesScreen />;
}
