import type { Metadata } from 'next';
import { SecurityOverview } from './_components/security-overview';

export const metadata: Metadata = { title: 'Staff security: Account overview' };

export default async function TeamIdSecurityPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <SecurityOverview id={id} />;
}
