import { PageHeader } from '@firmivra/ui';
import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Custom report builder' };

export default function ReportsBuilderPage() {
  return <PageHeader title="Custom Report Builder" />;
}
