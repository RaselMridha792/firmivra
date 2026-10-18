import { PageHeader } from '@firmivra/ui';
import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Create template' };

export default function AdminCommunicationsTemplatesNewPage() {
  return <PageHeader title="Create Template" />;
}
