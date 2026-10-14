import { PageHeader } from '@firmivra/ui';
import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Activity & login history' };

export default function TeamActivityPage() {
  return <PageHeader title="Activity & Login History" />;
}
