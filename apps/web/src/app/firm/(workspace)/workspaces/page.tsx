import type { Metadata } from 'next';
import { WorkspacesScreen } from './_components/workspaces-screen';

export const metadata: Metadata = { title: 'Workspaces' };

export default function WorkspacesPage() {
  return <WorkspacesScreen />;
}
