import { PageHeader } from '@firmivra/ui';
import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Communication templates' };

export default function AdminCommunicationsTemplatesPage() {
  return <PageHeader title="Templates" />;
}
