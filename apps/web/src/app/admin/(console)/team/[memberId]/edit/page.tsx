import { PageHeader } from '@firmivra/ui';
import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Edit team member' };

export default function AdminTeamMemberIdEditPage() {
  return <PageHeader title="Edit Team Member" />;
}
