import { PageHeader } from '@firmivra/ui';
import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Reports: Firms' };

export default function AdminReportsFirmsPage() {
  return <PageHeader title="Reports & Analytics" />;
}
