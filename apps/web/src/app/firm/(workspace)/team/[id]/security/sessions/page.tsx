import type { Metadata } from 'next';
import { SessionsTab } from '../_components/sessions-tab';

export const metadata: Metadata = { title: 'Staff security: Active sessions' };

export default async function TeamIdSecuritySessionsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <SessionsTab id={id} />;
}
