import { PageHeader } from '@firmivra/ui';
import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Reports: Users' };

export default function AdminReportsUsersPage() {
  return <PageHeader title="Reports & Analytics" />;
}
