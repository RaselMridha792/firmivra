import type { Metadata } from 'next';
import { HistoryTab } from '../_components/history-tab';

export const metadata: Metadata = { title: 'Staff security: Login history' };

export default async function TeamIdSecurityHistoryPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <HistoryTab id={id} />;
}
