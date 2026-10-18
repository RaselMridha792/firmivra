import { PageHeader } from '@firmivra/ui';
import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Create credit note' };

export default function AdminBillingCreditNotesNewPage() {
  return <PageHeader title="Create Credit Note" />;
}
