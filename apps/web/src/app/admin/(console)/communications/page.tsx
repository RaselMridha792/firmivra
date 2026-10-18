import { PageHeader } from '@firmivra/ui';
import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Communications' };

export default function AdminCommunicationsPage() {
  return <PageHeader title="Communications" />;
}
