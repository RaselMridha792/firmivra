import { PageHeader } from '@firmivra/ui';
import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Staff security: Active sessions' };

export default function TeamIdSecuritySessionsPage() {
  return <PageHeader title="Staff Account Access & Security" />;
}
