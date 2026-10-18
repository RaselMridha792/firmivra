import { PageHeader } from '@firmivra/ui';
import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Add team member' };

export default function AdminTeamNewPage() {
  return <PageHeader title="Add Team Member" />;
}
