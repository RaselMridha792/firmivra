import type { Metadata } from 'next';
import { Services } from '../../../../../features/services';

export const metadata: Metadata = { title: 'Workspace' };

export default async function WorkspacePage({
  params,
}: {
  params: Promise<{ engagementId: string }>;
}) {
  const { engagementId } = await params;
  return <Services id={engagementId} />;
}
