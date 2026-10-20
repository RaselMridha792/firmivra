import type { Metadata } from 'next';
import { CommunicationsInbox } from './_components/communications-inbox';

export const metadata: Metadata = { title: 'Communications' };

export default function AdminCommunicationsPage() {
  return <CommunicationsInbox />;
}
