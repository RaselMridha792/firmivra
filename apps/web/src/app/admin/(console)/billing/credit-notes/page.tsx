import { PageHeader } from '@firmivra/ui';
import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Credit notes' };

export default function AdminBillingCreditNotesPage() {
  return <PageHeader title="Credit Notes" />;
}
