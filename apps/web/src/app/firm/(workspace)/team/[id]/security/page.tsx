import { PageHeader } from '@firmivra/ui';
import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Staff security: Account overview' };

export default function TeamIdSecurityPage() {
  return <PageHeader title="Staff Account Access & Security" />;
}
