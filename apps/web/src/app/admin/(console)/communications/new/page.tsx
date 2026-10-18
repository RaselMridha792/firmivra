import { PageHeader } from '@firmivra/ui';
import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'New message' };

export default function AdminCommunicationsNewPage() {
  return <PageHeader title="New Message" />;
}
