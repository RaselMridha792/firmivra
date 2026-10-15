import type { Metadata } from 'next';
import { WorkspaceScreen } from '../_components/workspace-screen';

export const metadata: Metadata = { title: 'Workspace' };

export default async function WorkspacePage({
  params,
}: {
  params: Promise<{ engagementId: string }>;
}) {
  const { engagementId } = await params;
  return <WorkspaceScreen engagementId={engagementId} />;
}
