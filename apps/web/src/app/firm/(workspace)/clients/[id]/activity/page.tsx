import type { Metadata } from 'next';
import { ClientActivityScreen } from './_components/client-activity-screen';

export const metadata: Metadata = { title: 'Client activity' };

/** MSG-F16: the client's Activity tab, their own timeline. */
export default function ClientActivityPage() {
  return <ClientActivityScreen />;
}
