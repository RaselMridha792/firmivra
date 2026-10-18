import { PageHeader } from '@firmivra/ui';
import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Team' };

export default function AdminTeamPage() {
  return <PageHeader title="Team" />;
}
