import type { Metadata } from 'next';
import { ClientTasksScreen } from '../_components/client-tab-screens';

export const metadata: Metadata = { title: 'Client tasks' };

/** Octavia's E4: the client's open tasks. */
export default function ClientTasksPage() {
  return <ClientTasksScreen />;
}
