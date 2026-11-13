import type { Metadata } from 'next';
import { ClientServicesScreen } from '../_components/client-tab-screens';

export const metadata: Metadata = { title: 'Client services' };

/** Octavia's E4: the client's services and the way into each. */
export default function ClientServicesPage() {
  return <ClientServicesScreen />;
}
