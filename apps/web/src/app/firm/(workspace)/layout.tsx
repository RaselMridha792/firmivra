import type { ReactNode } from 'react';
import { WorkspaceProvider } from '../../../components/workspace-context';
import { WorkspaceShell } from '../../../components/workspace-shell';
export default function Layout({ children }: { children: ReactNode }) {
  return (
    <WorkspaceProvider site="firm">
      <WorkspaceShell>{children}</WorkspaceShell>
    </WorkspaceProvider>
  );
}
