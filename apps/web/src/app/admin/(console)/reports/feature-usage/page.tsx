import { PageHeader } from '@firmivra/ui';
import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Reports: Feature Usage' };

export default function AdminReportsFeatureUsagePage() {
  return <PageHeader title="Reports & Analytics" />;
}
