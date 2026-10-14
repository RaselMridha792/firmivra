import { PageHeader } from '@firmivra/ui';
import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Staff account created' };

export default function TeamIdCreatedPage() {
  return <PageHeader title="Staff Account Created Successfully!" />;
}
