import { PageHeader } from '@firmivra/ui';
import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Saved reports' };

export default function AdminReportsSavedPage() {
  return <PageHeader title="Saved Reports" />;
}
