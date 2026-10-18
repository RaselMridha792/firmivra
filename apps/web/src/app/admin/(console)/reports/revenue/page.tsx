import { PageHeader } from '@firmivra/ui';
import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Reports: Revenue' };

export default function AdminReportsRevenuePage() {
  return <PageHeader title="Reports & Analytics" />;
}
